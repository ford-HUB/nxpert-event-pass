import logging
import threading
from dataclasses import dataclass
from datetime import UTC, datetime

from app.core.exceptions import InvalidImageError, NoGalleryEventError
from app.ml.embedder import Embedding
from app.ml.face_analyzer import FaceAnalyzer
from app.models.face_record import FaceRecord
from app.repositories.backend_gallery import GalleryPerson, GallerySource
from app.repositories.face_repository import FaceRepository
from app.repositories.vector_index import InMemoryVectorIndex
from app.utils.image import decode_image

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class EnrollmentSummary:
    event_id: int
    person_count: int
    template_count: int
    skipped_people: tuple[str, ...]


class EnrollmentService:
    """Builds the gallery of known people from an event's registrants in the backend."""

    def __init__(
        self,
        analyzer: FaceAnalyzer,
        repository: FaceRepository,
        vector_index: InMemoryVectorIndex,
        gallery_source: GallerySource,
    ) -> None:
        self._analyzer = analyzer
        self._repository = repository
        self._vector_index = vector_index
        self._gallery_source = gallery_source
        self._sync_lock = threading.Lock()
        self._event_id: int | None = None
        # person_id -> (photo, templates), so a re-sync only embeds new or changed photos.
        self._templates: dict[str, tuple[bytes, list[Embedding]]] = {}

    @property
    def event_id(self) -> int | None:
        """The event whose registrants make up the gallery; None until the first sync."""
        return self._event_id

    def sync_gallery(self, event_id: int | None = None) -> EnrollmentSummary:
        """Replace the gallery with the event's registrants. None re-syncs the current event.

        The previous gallery stays in use if the backend can't be reached.
        """
        event_id = event_id if event_id is not None else self._event_id
        if event_id is None:
            raise NoGalleryEventError()
        with self._sync_lock:
            people = self._gallery_source.fetch_people(event_id)
            templates: dict[str, tuple[bytes, list[Embedding]]] = {}
            records: list[FaceRecord] = []
            skipped: list[str] = []
            for person in people:
                embeddings = self._templates_for(person)
                if not embeddings:
                    skipped.append(person.name)
                    continue
                templates[person.person_id] = (person.photo, embeddings)
                records.append(self._record_for(person, len(embeddings)))
            self._repository.replace_records(records)
            self._vector_index.replace({pid: embeddings for pid, (_, embeddings) in templates.items()})
            self._templates = templates
            self._event_id = event_id
        summary = EnrollmentSummary(
            event_id, len(records), sum(r.template_count for r in records), tuple(skipped)
        )
        logger.info(
            "Gallery for event %d: %d people (%d templates, %d without a usable face)",
            event_id, summary.person_count, summary.template_count, len(skipped),
        )
        return summary

    def list_faces(self) -> list[FaceRecord]:
        return self._repository.list_records()

    def get_face(self, person_id: str) -> FaceRecord:
        return self._repository.get_record(person_id)

    def _templates_for(self, person: GalleryPerson) -> list[Embedding]:
        cached = self._templates.get(person.person_id)
        if cached is not None and cached[0] == person.photo:
            return cached[1]
        try:
            image = decode_image(person.photo)
        except InvalidImageError:
            logger.warning("Photo of %s could not be decoded", person.person_id)
            return []
        faces = self._analyzer.detect_faces(image)
        if not faces:
            logger.warning("No face found in the photo of %s", person.person_id)
            return []
        largest = max(faces, key=lambda face: face.area)
        return self._analyzer.embed_enrollment_templates(image, largest)

    def _record_for(self, person: GalleryPerson, template_count: int) -> FaceRecord:
        return FaceRecord(
            person_id=person.person_id,
            name=person.name,
            photo=person.photo,
            photo_media_type=person.photo_media_type,
            template_count=template_count,
            embedding_model=self._analyzer.embedding_model,
            enrolled_at=datetime.now(UTC),
        )
