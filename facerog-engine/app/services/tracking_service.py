import logging
import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass

import cv2
import numpy as np

from app.core.exceptions import StreamUnavailableError, TrackNotFoundError
from app.ml.detector import DetectedFace
from app.ml.face_analyzer import FaceAnalyzer
from app.ml.tracker import ByteTracker, Track, TrackerConfig
from app.services.recognition_service import Identification, RecognitionService
from app.services.track_state import (
    DetectionMode,
    RecognitionEvent,
    ScanMode,
    TrackingSnapshot,
    TrackState,
    TrackStatus,
    TrackView,
)
from app.utils import drawing
from app.utils.image import encode_jpeg, resize_to_width
from app.utils.video_stream import FrameSource

logger = logging.getLogger(__name__)

IDLE_WAIT_SECONDS = 0.005
FPS_SMOOTHING = 0.9
MAX_EVENTS = 50
# QR decoding is cheaper than face recognition but not free; every other frame is plenty.
QR_INTERVAL_FRAMES = 2
MAX_QR_TEXT_LENGTH = 200


@dataclass(frozen=True)
class TrackingConfig:
    frame_width: int
    jpeg_quality: int
    tracker: TrackerConfig
    trajectory_length: int
    embedding_history: int
    recognition_interval_frames: int
    reverify_interval_frames: int
    angled_face_threshold_degrees: float
    zoom_size_pixels: int
    detection_mode: DetectionMode = DetectionMode.STEADY
    steady_frames: int = 3
    steady_max_speed: float = 0.75
    mirror_video: bool = True


class TrackingService:
    """Runs the live pipeline on a background thread.

    Per frame: detect faces (SCRFD) -> associate them with tracks (ByteTrack) ->
    run ArcFace only for tracks whose identity is unknown or due for re-verification.
    In STEADY detection mode a track is identified only once the person stands or moves a
    little; in CONTINUOUS mode right away, even while walking past.
    Publishes per-track zoom images, a JSON-friendly snapshot and the boxes to draw.

    The live video is encoded on its own thread from every camera frame, with the newest boxes
    drawn on, so it plays at the camera's rate even while recognition is slow.
    """

    def __init__(
        self,
        analyzer: FaceAnalyzer,
        recognition_service: RecognitionService,
        source_factory: Callable[[str], FrameSource],
        video_source: str,
        config: TrackingConfig,
        on_identified: Callable[[RecognitionEvent], object] | None = None,
        on_qr_code: Callable[[str], object] | None = None,
    ) -> None:
        self._analyzer = analyzer
        self._recognition_service = recognition_service
        self._on_identified = on_identified
        self._on_qr_code = on_qr_code
        self._scan_mode = ScanMode.FACE
        self._detection_mode = config.detection_mode
        self._qr_detector = cv2.QRCodeDetector()
        self._source_factory = source_factory
        self._video_source = video_source
        self._config = config
        self._source: FrameSource | None = None
        self._thread: threading.Thread | None = None
        self._preview_thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()
        # Signalled whenever a new video frame is published, so viewers get it right away.
        self._frame_ready = threading.Condition(self._lock)
        # start/stop arrive on concurrent request threads (a TV page reload sends stop + start).
        self._lifecycle_lock = threading.RLock()
        self._reset_pipeline()

    @property
    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def start(self, video_source: str | None = None) -> None:
        """Start (or restart with a new source) the capture and tracking threads."""
        with self._lifecycle_lock:
            self._start(video_source)

    def _start(self, video_source: str | None) -> None:
        if video_source is not None and video_source != self._video_source:
            self._stop()
            self._video_source = video_source
        if self.is_running:
            return
        # A worker that died still leaves its capture holding the webcam (DirectShow is exclusive),
        # which would block both this restart and the browser scanner. Release it first.
        self._stop()
        self._reset_pipeline()
        self._source = self._source_factory(self._video_source)
        self._source.start()
        # Each run owns its source and stop event, so a worker that outlives stop()'s join
        # timeout (e.g. a slow first frame) still exits instead of reading a cleared source.
        self._stop_event = threading.Event()
        self._thread = threading.Thread(
            target=self._run,
            args=(self._source, self._stop_event),
            name="face-tracking",
            daemon=True,
        )
        self._thread.start()
        self._preview_thread = threading.Thread(
            target=self._run_preview,
            args=(self._source, self._stop_event),
            name="video-preview",
            daemon=True,
        )
        self._preview_thread.start()
        logger.info("Tracking started on source %r", self._video_source)

    def stop(self) -> None:
        with self._lifecycle_lock:
            self._stop()

    def _stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5)
        if self._preview_thread:
            self._preview_thread.join(timeout=5)
        if self._source:
            self._source.stop()
        self._thread = None
        self._preview_thread = None
        self._source = None

    @property
    def scan_mode(self) -> ScanMode:
        return self._scan_mode

    def set_scan_mode(self, mode: ScanMode) -> None:
        """Switch between faces, QR passes or both. Takes effect on the next frame."""
        self._scan_mode = mode
        logger.info("Scan mode set to %s", mode.value)

    @property
    def detection_mode(self) -> DetectionMode:
        return self._detection_mode

    def set_detection_mode(self, mode: DetectionMode) -> None:
        """Identify faces only once steady, or continuously. Takes effect on the next frame."""
        self._detection_mode = mode
        logger.info("Detection mode set to %s", mode.value)

    def get_latest_jpeg(self) -> bytes:
        with self._lock:
            jpeg = self._latest_jpeg
        if jpeg is None:
            raise StreamUnavailableError("No frame has been processed yet.")
        return jpeg

    def wait_for_new_jpeg(self, previous: bytes | None, timeout_seconds: float) -> bytes | None:
        """Block until a video frame other than `previous` is published; None on timeout."""
        with self._frame_ready:
            self._frame_ready.wait_for(
                lambda: self._latest_jpeg is not None and self._latest_jpeg is not previous,
                timeout_seconds,
            )
            jpeg = self._latest_jpeg
        return None if jpeg is previous else jpeg

    def get_zoom_jpeg(self, track_id: int) -> bytes:
        with self._lock:
            jpeg = self._zoom_jpegs.get(track_id)
        if jpeg is None:
            raise TrackNotFoundError(f"No active track with id {track_id}.")
        return jpeg

    def get_snapshot(self) -> TrackingSnapshot:
        with self._lock:
            return TrackingSnapshot(
                is_running=self.is_running,
                is_source_open=bool(self._source and self._source.is_open),
                video_source=self._video_source,
                frame_index=self._frame_index,
                fps=round(self._fps, 1),
                frame_width=self._frame_size[0],
                frame_height=self._frame_size[1],
                match_threshold=self._recognition_service.match_threshold,
                tracks=self._track_views,
                scan_mode=self._scan_mode,
                detection_mode=self._detection_mode,
            )

    def get_events(self) -> list[RecognitionEvent]:
        with self._lock:
            return list(reversed(self._events))

    def process_frame(self, frame: np.ndarray) -> None:
        """Run one frame through the pipeline. Called by the worker thread (and by tests)."""
        started_at = time.perf_counter()
        frame = resize_to_width(frame, self._config.frame_width)
        mode = self._scan_mode
        self._frame_index += 1
        active_states: list[TrackState] = []
        if mode is not ScanMode.QR:
            detections = self._analyzer.detect_faces(frame)
            tracks = self._update_tracker(detections)
            active_states = self._observe_tracks(frame, tracks, detections)
            self._recognize_due_tracks(frame, active_states)
        self._forget_expired_tracks()
        if mode is not ScanMode.FACE and self._frame_index % QR_INTERVAL_FRAMES == 0:
            self._scan_qr(frame)
        self._publish(frame, active_states, time.perf_counter() - started_at)

    def _scan_qr(self, frame: np.ndarray) -> None:
        """Report a QR code in view to the listener (it applies its own cooldown)."""
        text, _, _ = self._qr_detector.detectAndDecode(frame)
        text = text.strip()
        if text and len(text) <= MAX_QR_TEXT_LENGTH and self._on_qr_code is not None:
            self._on_qr_code(text)

    def _reset_pipeline(self) -> None:
        self._tracker = ByteTracker(self._config.tracker)
        self._states: dict[int, TrackState] = {}
        self._frame_index = 0
        self._fps = 0.0
        self._frame_size = (0, 0)
        self._latest_jpeg: bytes | None = None
        self._overlay_boxes: tuple[tuple[np.ndarray, str, tuple[int, int, int]], ...] = ()
        self._overlay_insets: tuple[np.ndarray, ...] = ()
        self._zoom_jpegs: dict[int, bytes] = {}
        self._track_views: tuple[TrackView, ...] = ()
        self._events: deque[RecognitionEvent] = deque(maxlen=MAX_EVENTS)

    def _run(self, source: FrameSource, stop_event: threading.Event) -> None:
        last_frame_number = 0
        while not stop_event.is_set():
            frame_number, frame = source.read_latest()
            if frame is None or frame_number == last_frame_number:
                stop_event.wait(IDLE_WAIT_SECONDS)
                continue
            last_frame_number = frame_number
            try:
                self.process_frame(frame)
            except (ValueError, RuntimeError, cv2.error) as err:
                # Keep the stream alive through a single bad frame; log it for diagnosis.
                logger.exception("Frame %d failed: %s", frame_number, err)

    def _run_preview(self, source: FrameSource, stop_event: threading.Event) -> None:
        last_frame_number = 0
        while not stop_event.is_set():
            frame_number, frame = source.read_latest()
            if frame is None or frame_number == last_frame_number:
                stop_event.wait(IDLE_WAIT_SECONDS)
                continue
            last_frame_number = frame_number
            try:
                self._publish_preview(frame)
            except (ValueError, RuntimeError, cv2.error) as err:
                logger.exception("Preview frame %d failed: %s", frame_number, err)

    def _publish_preview(self, frame: np.ndarray) -> None:
        """Encode one camera frame for the live video with the newest boxes drawn on.

        The boxes come from the last frame inference finished, so they trail a moving face
        slightly; the video itself never waits for inference.
        """
        frame = resize_to_width(frame, self._config.frame_width)
        with self._lock:
            boxes, insets = self._overlay_boxes, self._overlay_insets
        # The capture thread shares its frame with inference: draw on a copy. Mirrored, people
        # see themselves move the way they move, like the scanner's selfie preview; the boxes are
        # mirrored to match, but their labels stay readable.
        mirror = self._config.mirror_video
        annotated = cv2.flip(frame, 1) if mirror else frame.copy()
        width = annotated.shape[1]
        for bbox, label, color in boxes:
            if mirror:
                x1, y1, x2, y2 = bbox
                bbox = np.array([width - x2, y1, width - x1, y2], dtype=np.float32)
            drawing.draw_track_box(annotated, bbox, label, color)
        drawing.draw_zoom_insets(annotated, list(insets))
        jpeg = encode_jpeg(annotated, self._config.jpeg_quality)
        with self._frame_ready:
            self._latest_jpeg = jpeg
            self._frame_ready.notify_all()

    def _update_tracker(self, detections: list[DetectedFace]) -> list[Track]:
        bboxes = np.array([face.bbox for face in detections], dtype=np.float32).reshape(-1, 4)
        scores = np.array([face.score for face in detections], dtype=np.float32)
        return self._tracker.update(bboxes, scores)

    def _observe_tracks(
        self, frame: np.ndarray, tracks: list[Track], detections: list[DetectedFace]
    ) -> list[TrackState]:
        active = []
        for track in tracks:
            state = self._states.get(track.track_id)
            if state is None:
                state = TrackState(
                    track.track_id,
                    self._config.trajectory_length,
                    self._config.embedding_history,
                    self._config.steady_frames,
                )
                self._states[track.track_id] = state
            state.observe(detections[track.detection_index], track.bbox, frame.shape, self._frame_index)
            active.append(state)
        return active

    def _recognize_due_tracks(self, frame: np.ndarray, states: list[TrackState]) -> None:
        wait_until_steady = self._detection_mode is DetectionMode.STEADY
        due = [
            state for state in states
            if state.detection is not None
            and state.detection.score >= self._config.tracker.high_threshold
            and (not wait_until_steady or state.is_steady(self._config.steady_max_speed))
            and state.is_recognition_due(
                self._frame_index,
                self._config.recognition_interval_frames,
                self._config.reverify_interval_frames,
            )
        ]
        if not due:
            return
        analyzed = self._analyzer.embed_detections(frame, [state.detection for state in due])
        for state, face in zip(due, analyzed, strict=True):
            weight = face.head_pose.frontal_score * face.detection.score
            track_embedding = state.add_embedding(face.embedding, weight)
            previous = state.identification
            current = self._recognition_service.identify_embedding(track_embedding)
            state.identification = _keep_established_identity(previous, current)
            state.last_recognized_frame = self._frame_index
            state.recognition_count += 1
            self._publish_identification(state, previous)

    def _publish_identification(self, state: TrackState, previous: Identification | None) -> None:
        """Log new identities, and report each track's match to the listener once.

        A face that stays in view is reported once; leaving and coming back starts a new track,
        so the person is reported (and shown) again. If the listener declines (TV closed), the
        track is offered again on its next re-check.
        """
        current = state.identification
        if current is None or current.person is None:
            return
        person = current.person
        event = RecognitionEvent(
            time.time(), state.track_id, person.person_id, person.name, current.similarity
        )
        is_same_person = previous is not None and previous.person is not None and (
            previous.person.person_id == person.person_id
        )
        if not is_same_person:
            with self._lock:
                self._events.append(event)
            logger.info(
                "Track %d identified as %s (%.3f)", state.track_id, person.person_id, current.similarity
            )
        if self._on_identified is not None and state.reported_person_id != person.person_id:
            if self._on_identified(event) is not None:
                state.reported_person_id = person.person_id

    def _forget_expired_tracks(self) -> None:
        horizon = self._config.tracker.buffer_frames
        expired = [tid for tid, s in self._states.items() if self._frame_index - s.last_seen_frame > horizon]
        for track_id in expired:
            del self._states[track_id]

    def _publish(self, frame: np.ndarray, states: list[TrackState], elapsed_seconds: float) -> None:
        zooms = {state.track_id: self._render_zoom(frame, state) for state in states}
        boxes = tuple(
            (s.bbox, _track_label(s, self._is_waiting_to_settle(s)), _track_color(s)) for s in states
        )
        angled_threshold = self._config.angled_face_threshold_degrees
        angled = tuple(zooms[s.track_id] for s in states if s.head_pose.is_angled(angled_threshold))
        zoom_jpegs = {track_id: encode_jpeg(zoom) for track_id, zoom in zooms.items()}
        views = tuple(self._to_view(state) for state in states)
        instant_fps = 1.0 / max(elapsed_seconds, 1e-6)
        with self._lock:
            self._overlay_boxes = boxes
            self._overlay_insets = angled
            self._zoom_jpegs = zoom_jpegs
            self._track_views = views
            self._frame_size = (frame.shape[1], frame.shape[0])
            self._fps = instant_fps if self._fps == 0 else FPS_SMOOTHING * self._fps + (1 - FPS_SMOOTHING) * instant_fps

    def _is_waiting_to_settle(self, state: TrackState) -> bool:
        """Steady mode and the person is still moving too fast to be identified."""
        return self._detection_mode is DetectionMode.STEADY and not state.is_steady(self._config.steady_max_speed)

    def _render_zoom(self, frame: np.ndarray, state: TrackState) -> np.ndarray:
        assert state.detection is not None
        pose = state.head_pose
        caption = f"#{state.track_id} yaw {pose.yaw_degrees:+.0f} pitch {pose.pitch_degrees:+.0f}"
        return drawing.render_zoom(
            frame, state.bbox, state.detection.landmarks, self._config.zoom_size_pixels, caption
        )

    def _to_view(self, state: TrackState) -> TrackView:
        x1, y1, x2, y2 = (float(v) for v in state.bbox)
        return TrackView(
            track_id=state.track_id,
            bbox=(x1, y1, x2, y2),
            detection_score=state.detection.score if state.detection else 0.0,
            head_pose=state.head_pose,
            is_angled=state.head_pose.is_angled(self._config.angled_face_threshold_degrees),
            status=state.status,
            identification=state.identification,
            trajectory=tuple(state.trajectory),
            seconds_tracked=time.time() - state.first_seen_at,
            recognition_count=state.recognition_count,
            is_steady=state.is_steady(self._config.steady_max_speed),
        )


def _keep_established_identity(
    previous: Identification | None, current: Identification
) -> Identification:
    """A matched track keeps its name through angled, dim or blurred frames.

    ByteTrack guarantees the track is still the same face, so a weaker re-check is not
    evidence of a different person. The name only changes if another enrolled person matches.
    """
    if previous is not None and previous.is_match and not current.is_match:
        return previous
    return current


def _track_label(state: TrackState, waiting_to_settle: bool) -> str:
    identification = state.identification
    if identification is None:
        return f"#{state.track_id} {'hold still...' if waiting_to_settle else 'identifying...'}"
    name = identification.person.name if identification.person else "Unknown"
    return f"#{state.track_id} {name} {identification.similarity:.2f}"


def _track_color(state: TrackState) -> tuple[int, int, int]:
    return {
        TrackStatus.MATCHED: drawing.MATCHED_COLOR,
        TrackStatus.UNKNOWN: drawing.UNKNOWN_COLOR,
        TrackStatus.IDENTIFYING: drawing.PENDING_COLOR,
    }[state.status]
