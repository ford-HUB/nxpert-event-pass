import threading
import time
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from enum import StrEnum

from app.core.exceptions import CheckInNotFoundError
from app.services.recognition_service import FaceRecognition
from app.services.track_state import RecognitionEvent


class CheckInSource(StrEnum):
    CAMERA = "camera"
    PHOTO = "photo"
    QR = "qr"


class PhotoFaceStatus(StrEnum):
    CHECKED_IN = "checked_in"
    ALREADY_CHECKED_IN = "already_checked_in"
    NOT_REGISTERED = "not_registered"


@dataclass(frozen=True)
class CheckIn:
    """A matched participant. sequence increases by one per check-in, starting at 1.

    track_id is the live track that was identified; None for check-ins from an uploaded photo.
    """

    sequence: int
    person_id: str
    name: str
    similarity: float
    source: CheckInSource
    track_id: int | None
    checked_in_at: float


@dataclass(frozen=True)
class PhotoFaceCheckIn:
    """What happened to one face of an uploaded photo. check_in is set only for CHECKED_IN."""

    recognition: FaceRecognition
    status: PhotoFaceStatus
    check_in: CheckIn | None


class CheckInService:
    """Turns identifications into check-ins (queued for the TV): only matched people.

    Nobody is hidden for long: someone already checked in is queued again every time they
    come back, and the backend tells the TV they're "already checked in". Only repeats within
    repeat_seconds of the last sighting are dropped, so a face or a QR pass held in view (or a
    track that flickers) isn't queued over and over.

    The live camera checks people in only while TV mode is open, that is, while a TV has
    called `mark_display_active` within heartbeat_seconds. Several people identified in
    the same frame or photo are checked in together and returned together by
    `list_check_ins`, in the order they were recognized.
    """

    def __init__(
        self,
        repeat_seconds: float,
        heartbeat_seconds: float,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._repeat_seconds = repeat_seconds
        self._heartbeat_seconds = heartbeat_seconds
        self._clock = clock
        self._display_seen_at: float | None = None
        self._lock = threading.Lock()
        self._check_ins: list[CheckIn] = []
        self._last_seen_at: dict[str, float] = {}
        self._session_id = uuid.uuid4().hex
        self._next_sequence = 1

    @property
    def session_id(self) -> str:
        """Changes on every reset, so clients know sequence numbers started over."""
        return self._session_id

    @property
    def is_display_active(self) -> bool:
        """True while a TV has polled within heartbeat_seconds."""
        seen_at = self._display_seen_at
        return seen_at is not None and self._clock() - seen_at <= self._heartbeat_seconds

    def mark_display_active(self) -> None:
        """Record a TV heartbeat; the TV calls this on every poll."""
        self._display_seen_at = self._clock()

    def record_identification(self, event: RecognitionEvent) -> CheckIn | None:
        """Check the person in from the live camera.

        Returns None when TV mode is closed or the person was seen within repeat_seconds.
        """
        if not self.is_display_active:
            return None
        return self._check_in(
            event.person_id, event.name, event.similarity, CheckInSource.CAMERA, event.track_id
        )

    def record_qr_code(self, token: str) -> CheckIn | None:
        """Queue a QR pass seen by the live camera, as person "q{token}".

        The engine can't tell who the pass belongs to; the TV asks the backend, which
        validates the token. Same rules as faces: only while TV mode is open; a pass held in view
        is queued once, and again after it's been out of view for repeat_seconds.
        """
        if not self.is_display_active:
            return None
        return self._check_in(f"q{token}", "", 1.0, CheckInSource.QR, track_id=None)

    def record_photo(self, recognitions: Sequence[FaceRecognition]) -> list[PhotoFaceCheckIn]:
        """Check in every matched face of an uploaded photo, left to right.

        Unknown faces are reported but never checked in. A person who appears twice in the
        photo, or was seen within repeat_seconds, is reported as ALREADY_CHECKED_IN.
        """
        results = []
        seen_person_ids: set[str] = set()
        for recognition in sorted(recognitions, key=lambda r: float(r.detection.bbox[0])):
            person = recognition.identification.person
            if person is None:
                results.append(PhotoFaceCheckIn(recognition, PhotoFaceStatus.NOT_REGISTERED, None))
                continue
            check_in = None
            if person.person_id not in seen_person_ids:
                check_in = self._check_in(
                    person.person_id,
                    person.name,
                    recognition.identification.similarity,
                    CheckInSource.PHOTO,
                    track_id=None,
                )
            seen_person_ids.add(person.person_id)
            status = PhotoFaceStatus.CHECKED_IN if check_in else PhotoFaceStatus.ALREADY_CHECKED_IN
            results.append(PhotoFaceCheckIn(recognition, status, check_in))
        return results

    def list_check_ins(self, after_sequence: int = 0) -> list[CheckIn]:
        """Check-ins newer than after_sequence, oldest first. 0 returns all of them."""
        with self._lock:
            return [c for c in self._check_ins if c.sequence > after_sequence]

    def remove_check_in(self, sequence: int) -> None:
        """Undo one check-in, so the person can check in again right away."""
        with self._lock:
            check_in = next((c for c in self._check_ins if c.sequence == sequence), None)
            if check_in is None:
                raise CheckInNotFoundError(f"No check-in with sequence {sequence}.")
            self._check_ins.remove(check_in)
            self._last_seen_at.pop(check_in.person_id, None)

    def reset(self) -> None:
        """Start a new session: clear the queue and let everyone check in again."""
        with self._lock:
            self._check_ins.clear()
            self._last_seen_at.clear()
            self._session_id = uuid.uuid4().hex
            self._next_sequence = 1

    def _check_in(
        self,
        person_id: str,
        name: str,
        similarity: float,
        source: CheckInSource,
        track_id: int | None,
    ) -> CheckIn | None:
        now = self._clock()
        with self._lock:
            last = self._last_seen_at.get(person_id)
            # Every sighting counts, so something that stays in view never comes due again.
            self._last_seen_at[person_id] = now
            if last is not None and now - last < self._repeat_seconds:
                return None
            check_in = CheckIn(
                sequence=self._next_sequence,
                person_id=person_id,
                name=name,
                similarity=similarity,
                source=source,
                track_id=track_id,
                checked_in_at=now,
            )
            self._check_ins.append(check_in)
            self._next_sequence += 1
            return check_in
