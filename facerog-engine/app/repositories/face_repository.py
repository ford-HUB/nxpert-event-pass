"""Enrolled people, kept in memory. The backend is the source of truth; see backend_gallery."""

import threading
from collections.abc import Iterable

from app.core.exceptions import FaceNotFoundError
from app.models.face_record import FaceRecord


class FaceRepository:
    """Holds the `FaceRecord`s of the current gallery."""

    def __init__(self) -> None:
        self._records: dict[str, FaceRecord] = {}
        self._lock = threading.Lock()

    def replace_records(self, records: Iterable[FaceRecord]) -> None:
        new_records = {record.person_id: record for record in records}
        with self._lock:
            self._records = new_records

    def get_record(self, person_id: str) -> FaceRecord:
        with self._lock:
            record = self._records.get(person_id)
        if record is None:
            raise FaceNotFoundError(f"No enrolled person with id '{person_id}'.")
        return record

    def find_record(self, person_id: str) -> FaceRecord | None:
        with self._lock:
            return self._records.get(person_id)

    def list_records(self) -> list[FaceRecord]:
        with self._lock:
            return sorted(self._records.values(), key=lambda r: r.name.lower())
