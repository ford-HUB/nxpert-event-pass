import time
from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from fastapi.responses import StreamingResponse

from app.api.dependencies import get_settings_dependency, get_tracking_service
from app.api.v1.presenters import present_event, present_snapshot
from app.core.config import Settings
from app.schemas.tracking import (
    DetectionModeRequest,
    RecognitionEventResponse,
    ScanModeRequest,
    StartStreamRequest,
    TrackingSnapshotResponse,
)
from app.services.track_state import DetectionMode, ScanMode
from app.services.tracking_service import TrackingService

router = APIRouter(prefix="/stream", tags=["stream"])

TrackingDependency = Annotated[TrackingService, Depends(get_tracking_service)]
MJPEG_BOUNDARY = "frame"
# How long a viewer waits for a frame before re-checking that tracking is still running.
FRAME_WAIT_SECONDS = 0.5
NO_CACHE_HEADERS = {"Cache-Control": "no-store"}


@router.get("/video")
def stream_video(
    service: TrackingDependency, settings: Annotated[Settings, Depends(get_settings_dependency)]
) -> StreamingResponse:
    """Annotated live video as MJPEG (use directly as an <img> src)."""
    return StreamingResponse(
        _mjpeg_frames(service, 1.0 / settings.stream_max_fps),
        media_type=f"multipart/x-mixed-replace; boundary={MJPEG_BOUNDARY}",
        headers=NO_CACHE_HEADERS,
    )


@router.get("/snapshot.jpg")
def get_frame(service: TrackingDependency) -> Response:
    return Response(service.get_latest_jpeg(), media_type="image/jpeg", headers=NO_CACHE_HEADERS)


@router.get("/tracks", response_model=TrackingSnapshotResponse)
def get_tracks(service: TrackingDependency) -> TrackingSnapshotResponse:
    """Active tracks with identity, similarity, head pose and trajectory."""
    return present_snapshot(service.get_snapshot())


@router.get("/tracks/{track_id}/zoom")
def get_track_zoom(track_id: int, service: TrackingDependency) -> Response:
    """Zoomed, upscaled crop of a tracked face with its landmark structure drawn on."""
    return Response(service.get_zoom_jpeg(track_id), media_type="image/jpeg", headers=NO_CACHE_HEADERS)


@router.get("/events", response_model=list[RecognitionEventResponse])
def get_events(service: TrackingDependency) -> list[RecognitionEventResponse]:
    """Most recent identifications, newest first."""
    return [present_event(event) for event in service.get_events()]


@router.post("/start", response_model=TrackingSnapshotResponse)
def start_stream(service: TrackingDependency, request: StartStreamRequest | None = None) -> TrackingSnapshotResponse:
    """Start tracking. Optionally switch source: webcam index ("0"), video file path or RTSP URL."""
    service.start(request.source if request else None)
    return present_snapshot(service.get_snapshot())


@router.post("/stop", response_model=TrackingSnapshotResponse)
def stop_stream(service: TrackingDependency) -> TrackingSnapshotResponse:
    service.stop()
    return present_snapshot(service.get_snapshot())


@router.post("/mode", response_model=TrackingSnapshotResponse)
def set_scan_mode(request: ScanModeRequest, service: TrackingDependency) -> TrackingSnapshotResponse:
    """Choose what the camera checks people in with: "face", "qr" (passes) or "auto" (both)."""
    service.set_scan_mode(ScanMode(request.mode))
    return present_snapshot(service.get_snapshot())


@router.post("/detection", response_model=TrackingSnapshotResponse)
def set_detection_mode(request: DetectionModeRequest, service: TrackingDependency) -> TrackingSnapshotResponse:
    """When faces are identified: "steady" (once the person stands or moves a little, not
    walking past) or "continuous" (right away, even while walking quickly)."""
    service.set_detection_mode(DetectionMode(request.mode))
    return present_snapshot(service.get_snapshot())


def _mjpeg_frames(service: TrackingService, frame_interval_seconds: float) -> Iterator[bytes]:
    """Send each new frame as soon as it is published, at most one per frame interval."""
    last_jpeg: bytes | None = None
    last_sent_at = 0.0
    while service.is_running:
        delay = last_sent_at + frame_interval_seconds - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        jpeg = service.wait_for_new_jpeg(last_jpeg, FRAME_WAIT_SECONDS)
        if jpeg is None:
            continue
        last_jpeg = jpeg
        last_sent_at = time.monotonic()
        yield (
            f"--{MJPEG_BOUNDARY}\r\nContent-Type: image/jpeg\r\n"
            f"Content-Length: {len(jpeg)}\r\n\r\n"
        ).encode() + jpeg + b"\r\n"
