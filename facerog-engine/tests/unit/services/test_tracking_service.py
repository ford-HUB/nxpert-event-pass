import time

import cv2
import numpy as np

from app.api.dependencies import ServiceContainer, _tracking_config, wire_services
from app.core.config import Settings
from app.ml.detector import DetectedFace
from app.ml.face_analyzer import FaceAnalyzer
from app.services.track_state import DetectionMode, TrackState, TrackStatus
from app.services.tracking_service import TrackingService
from tests.conftest import FakeDetector, FakeEmbedder, FakeGallerySource, make_face_image


def test_matched_track_keeps_name_when_recheck_is_weaker(
    settings: Settings, face_analyzer: FaceAnalyzer, gallery_source: FakeGallerySource
) -> None:
    eager_settings = settings.model_copy(
        update={"reverify_interval_frames": 1, "detection_mode": "continuous"}
    )
    container = wire_services(eager_settings, face_analyzer, face_analyzer, gallery_source)
    container.enrollment_service.sync_gallery(1)
    tracking = container.tracking_service
    tracking.process_frame(make_face_image("red", size=400))

    for _ in range(3):
        tracking.process_frame(make_face_image("green", size=400))

    track = tracking.get_snapshot().tracks[0]
    assert track.recognition_count == 4
    assert track.status == TrackStatus.MATCHED
    assert track.identification.person.name == "Red Person"


def test_process_frame_identifies_enrolled_face_and_reuses_identity(container: ServiceContainer) -> None:
    container.enrollment_service.sync_gallery(1)
    tracking = container.tracking_service

    for _ in range(4):
        tracking.process_frame(make_face_image("red", size=400))

    snapshot = tracking.get_snapshot()
    assert len(snapshot.tracks) == 1
    track = snapshot.tracks[0]
    assert track.status == TrackStatus.MATCHED
    assert track.identification.person.name == "Red Person"
    assert track.recognition_count == 1
    assert tracking.get_zoom_jpeg(track.track_id).startswith(b"\xff\xd8")
    assert [event.name for event in tracking.get_events()] == ["Red Person"]


def test_process_frame_unknown_face_is_marked_unknown(container: ServiceContainer) -> None:
    container.enrollment_service.sync_gallery(1)
    tracking = container.tracking_service

    for _ in range(3):
        tracking.process_frame(make_face_image("green", size=400))

    assert tracking.get_snapshot().tracks[0].status == TrackStatus.UNKNOWN
    assert tracking.get_events() == []


def _face_at(x: float, width: float = 100.0) -> tuple[DetectedFace, np.ndarray]:
    bbox = np.array([x, 100, x + width, 100 + width], dtype=np.float32)
    return DetectedFace(bbox=bbox, landmarks=np.zeros((5, 2), dtype=np.float32), score=0.9), bbox


def _observe_moving(state: TrackState, pixels_per_frame: float, fps: float = 20.0) -> None:
    for i in range(state.motion_window):
        detection, bbox = _face_at(100 + i * pixels_per_frame)
        state.observe(detection, bbox, (720, 1280, 3), i + 1, timestamp=i / fps)


def test_track_is_steady_when_standing_with_a_little_movement() -> None:
    state = TrackState(1, 10, 5, motion_window=3)
    _observe_moving(state, pixels_per_frame=1.5)  # 0.3 face widths per second
    assert state.is_steady(0.75)


def test_track_walking_past_is_not_steady() -> None:
    state = TrackState(1, 10, 5, motion_window=3)
    _observe_moving(state, pixels_per_frame=10)  # 2 face widths per second
    assert not state.is_steady(0.75)


def test_track_is_not_steady_until_motion_window_is_full() -> None:
    state = TrackState(1, 10, 5, motion_window=3)
    detection, bbox = _face_at(100)
    state.observe(detection, bbox, (720, 1280, 3), 1, timestamp=0.0)
    assert state.speed is None
    assert not state.is_steady(0.75)


def test_steady_mode_waits_for_the_face_to_settle(settings, face_analyzer, gallery_source) -> None:
    steady = settings.model_copy(update={"detection_mode": "steady", "steady_frames": 3})
    container = wire_services(steady, face_analyzer, face_analyzer, gallery_source)
    container.enrollment_service.sync_gallery(1)
    tracking = container.tracking_service

    for _ in range(2):
        tracking.process_frame(make_face_image("red", size=400))
    assert tracking.get_snapshot().tracks[0].status == TrackStatus.IDENTIFYING

    tracking.process_frame(make_face_image("red", size=400))
    assert tracking.get_snapshot().tracks[0].status == TrackStatus.MATCHED


def test_continuous_mode_identifies_on_the_first_frame(settings, face_analyzer, gallery_source) -> None:
    container = wire_services(settings, face_analyzer, face_analyzer, gallery_source)
    container.enrollment_service.sync_gallery(1)
    tracking = container.tracking_service
    tracking.set_detection_mode(DetectionMode.CONTINUOUS)

    tracking.process_frame(make_face_image("red", size=400))

    assert tracking.get_snapshot().tracks[0].status == TrackStatus.MATCHED
    assert tracking.get_snapshot().detection_mode == DetectionMode.CONTINUOUS


class _CountingSource:
    """A camera that always has a new frame: every read returns the next frame number."""

    is_open = True

    def __init__(self, _source: str) -> None:
        self._frame_number = 0
        self._frame = make_face_image("red", size=400)

    def start(self) -> None: ...

    def stop(self) -> None: ...

    def read_latest(self) -> tuple[int, np.ndarray]:
        self._frame_number += 1
        return self._frame_number, self._frame


class _SlowDetector(FakeDetector):
    def detect(self, image: np.ndarray) -> list[DetectedFace]:
        time.sleep(0.5)
        return super().detect(image)


def test_video_keeps_playing_while_inference_is_slow(
    settings: Settings, gallery_source: FakeGallerySource
) -> None:
    analyzer = FaceAnalyzer(_SlowDetector(), FakeEmbedder(), min_face_size_pixels=10)
    container = wire_services(settings, analyzer, analyzer, gallery_source)
    tracking = TrackingService(
        analyzer,
        container.recognition_service,
        source_factory=_CountingSource,
        video_source="0",
        config=_tracking_config(settings),
    )
    tracking.start()
    try:
        frames, previous = 0, None
        deadline = time.monotonic() + 0.3
        while time.monotonic() < deadline:
            jpeg = tracking.wait_for_new_jpeg(previous, timeout_seconds=0.3)
            if jpeg is not None:
                frames, previous = frames + 1, jpeg
        # The first detection is still running, yet the video has moved on many times.
        assert tracking.get_snapshot().frame_index <= 1
        assert frames >= 5
        assert previous is not None and previous.startswith(b"\xff\xd8")
    finally:
        tracking.stop()


def test_video_is_mirrored_for_display_only(container: ServiceContainer) -> None:
    tracking = container.tracking_service
    frame = np.zeros((200, 400, 3), dtype=np.uint8)
    frame[:, :100] = (0, 0, 255)  # red on the camera's left
    tracking._publish_preview(frame)
    shown = cv2.imdecode(np.frombuffer(tracking.get_latest_jpeg(), np.uint8), cv2.IMREAD_COLOR)
    assert shown[100, 350, 2] > 200 and shown[100, 50, 2] < 50  # shown on the right
    assert frame[100, 50, 2] == 255  # the camera frame itself is untouched
