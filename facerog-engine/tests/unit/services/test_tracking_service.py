import numpy as np

from app.api.dependencies import ServiceContainer, wire_services
from app.core.config import Settings
from app.ml.detector import DetectedFace
from app.ml.face_analyzer import FaceAnalyzer
from app.services.track_state import DetectionMode, TrackState, TrackStatus
from tests.conftest import FakeGallerySource, make_face_image


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
