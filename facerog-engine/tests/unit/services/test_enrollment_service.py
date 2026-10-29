import pytest

from app.api.dependencies import ServiceContainer
from app.core.exceptions import NoGalleryEventError
from app.repositories.backend_gallery import GalleryPerson
from tests.conftest import FakeGallerySource, gallery_person


def test_sync_gallery_builds_four_templates_per_photo(container: ServiceContainer) -> None:
    summary = container.enrollment_service.sync_gallery(1)
    assert (summary.event_id, summary.person_count, summary.template_count) == (1, 1, 4)
    record = container.enrollment_service.get_face("u1")
    assert record.name == "Red Person"
    assert record.photo_media_type == "image/png"


def test_sync_without_event_raises(container: ServiceContainer) -> None:
    with pytest.raises(NoGalleryEventError):
        container.enrollment_service.sync_gallery()


def test_resync_replaces_gallery_with_current_registrants(
    container: ServiceContainer, gallery_source: FakeGallerySource
) -> None:
    service = container.enrollment_service
    service.sync_gallery(1)
    gallery_source.people_by_event[1] = [gallery_person("g-token", "blue")]

    summary = service.sync_gallery()

    assert summary.event_id == 1
    assert [face.person_id for face in service.list_faces()] == ["g-token"]


def test_photo_without_face_is_skipped(
    container: ServiceContainer, gallery_source: FakeGallerySource
) -> None:
    gallery_source.people_by_event[2] = [GalleryPerson("u9", "Nobody", b"not an image", "image/png")]

    summary = container.enrollment_service.sync_gallery(2)

    assert summary.person_count == 0
    assert summary.skipped_people == ("Nobody",)
