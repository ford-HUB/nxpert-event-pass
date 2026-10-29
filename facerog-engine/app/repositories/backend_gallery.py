"""Registrant photos from the Event Registration API: the engine's only source of known faces.

The backend owns enrollment (members and guests upload their photo when they register), so the
engine never stores faces itself. It asks the backend for an event's registrants and builds its
gallery from the photos in the response.
"""

import base64
import binascii
import logging
from dataclasses import dataclass
from typing import Protocol

import httpx

from app.core.exceptions import (
    BackendNotConfiguredError,
    BackendUnavailableError,
    GalleryEventNotFoundError,
)

logger = logging.getLogger(__name__)

KEY_HEADER = "X-Face-Engine-Key"


@dataclass(frozen=True)
class GalleryPerson:
    """One registrant. person_id is issued by the backend: "u{userId}" or "g{registration token}"."""

    person_id: str
    name: str
    photo: bytes
    photo_media_type: str


class GallerySource(Protocol):
    def fetch_people(self, event_id: int) -> list[GalleryPerson]: ...


class BackendGalleryClient:
    """Calls GET {base_url}/api/face-engine/events/{event_id}/gallery with the shared engine key."""

    def __init__(self, base_url: str, api_key: str, timeout_seconds: float) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout_seconds = timeout_seconds

    def fetch_people(self, event_id: int) -> list[GalleryPerson]:
        if not self._base_url or not self._api_key:
            raise BackendNotConfiguredError()
        url = f"{self._base_url}/api/face-engine/events/{event_id}/gallery"
        try:
            response = httpx.get(url, headers={KEY_HEADER: self._api_key}, timeout=self._timeout_seconds)
        except httpx.HTTPError as err:
            raise BackendUnavailableError(f"Could not reach the backend: {err}") from err
        if response.status_code == httpx.codes.NOT_FOUND:
            raise GalleryEventNotFoundError(
                f"Event {event_id} was not found, or the backend has no FaceEngine:ApiKey set."
            )
        if response.status_code in (httpx.codes.UNAUTHORIZED, httpx.codes.FORBIDDEN):
            raise BackendUnavailableError("The backend rejected the engine key (FRE_BACKEND_API_KEY).")
        if not response.is_success:
            raise BackendUnavailableError(f"The backend returned HTTP {response.status_code}.")
        return [person for item in response.json() if (person := _parse_person(item)) is not None]


def _parse_person(item: dict) -> GalleryPerson | None:
    person_id, name = item.get("personId"), item.get("name")
    decoded = parse_data_url(item.get("photo") or "")
    if not person_id or decoded is None:
        logger.warning("Skipping registrant %s: no usable photo in the backend response", person_id)
        return None
    photo, media_type = decoded
    return GalleryPerson(person_id=person_id, name=name or "Guest", photo=photo, photo_media_type=media_type)


def parse_data_url(value: str) -> tuple[bytes, str] | None:
    """'data:image/jpeg;base64,....' -> (bytes, 'image/jpeg'); None for anything else."""
    header, separator, payload = value.partition(",")
    if not separator or not header.startswith("data:image/") or not header.endswith(";base64"):
        return None
    try:
        data = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        return None
    return (data, header[len("data:") : -len(";base64")]) if data else None
