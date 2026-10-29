import logging
import sys
import threading
import time
from dataclasses import dataclass
from typing import Protocol

import cv2
import numpy as np

logger = logging.getLogger(__name__)

RECONNECT_DELAY_SECONDS = 2.0


class FrameSource(Protocol):
    def start(self) -> None: ...

    def stop(self) -> None: ...

    def read_latest(self) -> tuple[int, np.ndarray | None]: ...

    @property
    def is_open(self) -> bool: ...


def parse_video_source(source: str) -> int | str:
    """"0" -> webcam index 0; anything else is a file path or stream URL (rtsp://, http://)."""
    return int(source) if source.isdigit() else source


@dataclass(frozen=True)
class CaptureFormat:
    """What to ask a webcam for. 0 leaves that setting at the camera's default."""

    width: int = 0
    height: int = 0
    fps: float = 0.0
    mjpg: bool = True


def open_capture(
    source: int | str, capture_format: CaptureFormat | None = None
) -> cv2.VideoCapture:
    """Open a video source. Windows webcams use DirectShow first, because the default
    Media Foundation backend often fails with "can't grab frame" on laptop cameras."""
    if isinstance(source, int) and sys.platform == "win32":
        capture = cv2.VideoCapture(source, cv2.CAP_DSHOW)
        if not capture.isOpened():
            capture.release()
            capture = cv2.VideoCapture(source)
    else:
        capture = cv2.VideoCapture(source)
    if isinstance(source, int) and capture_format is not None and capture.isOpened():
        _request_format(capture, capture_format)
    return capture


def _request_format(capture: cv2.VideoCapture, capture_format: CaptureFormat) -> None:
    """Ask a webcam for its frame size and rate. Uncompressed video (the usual default) can't
    carry 720p much above 10 fps over USB 2, so most webcams only reach 30-60 fps in MJPG.
    The camera picks the nearest mode it supports; the result is logged."""
    if capture_format.mjpg:
        # Must come before the size: DirectShow picks the mode when the size is set.
        capture.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter.fourcc(*"MJPG"))
    if capture_format.width:
        capture.set(cv2.CAP_PROP_FRAME_WIDTH, capture_format.width)
    if capture_format.height:
        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, capture_format.height)
    if capture_format.fps:
        capture.set(cv2.CAP_PROP_FPS, capture_format.fps)
    logger.info(
        "Webcam mode: %dx%d at %.0f fps",
        capture.get(cv2.CAP_PROP_FRAME_WIDTH),
        capture.get(cv2.CAP_PROP_FRAME_HEIGHT),
        capture.get(cv2.CAP_PROP_FPS),
    )


class OpenCvVideoStream:
    """Reads frames on a background thread and keeps only the newest one.

    Dropping stale frames keeps latency low when inference is slower than the camera.
    Video files loop; cameras and streams reconnect after failures.
    """

    def __init__(self, source: str, capture_format: CaptureFormat | None = None) -> None:
        self._source = parse_video_source(source)
        self._capture_format = capture_format
        self._lock = threading.Lock()
        self._frame: np.ndarray | None = None
        self._frame_number = 0
        self._is_open = False
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def is_open(self) -> bool:
        return self._is_open

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="video-capture", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=3)

    def read_latest(self) -> tuple[int, np.ndarray | None]:
        """Return (frame number, frame). The number increases with every new frame."""
        with self._lock:
            return self._frame_number, self._frame

    def _run(self) -> None:
        while not self._stop_event.is_set():
            capture = open_capture(self._source, self._capture_format)
            if not capture.isOpened():
                logger.warning("Cannot open video source %r; retrying", self._source)
                self._is_open = False
                self._stop_event.wait(RECONNECT_DELAY_SECONDS)
                continue
            self._is_open = True
            logger.info("Video source %r opened", self._source)
            self._read_until_failure(capture)
            capture.release()
        self._is_open = False

    def _read_until_failure(self, capture: cv2.VideoCapture) -> None:
        is_file = isinstance(self._source, str) and "://" not in self._source
        frame_interval = 1.0 / (capture.get(cv2.CAP_PROP_FPS) or 30.0) if is_file else 0.0
        while not self._stop_event.is_set():
            has_frame, frame = capture.read()
            if not has_frame:
                if is_file:
                    capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                logger.warning("Video source %r stopped delivering frames", self._source)
                return
            with self._lock:
                self._frame = frame
                self._frame_number += 1
            if frame_interval:
                time.sleep(frame_interval)
