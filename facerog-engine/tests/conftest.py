import cv2
import numpy as np
import pytest

from app.api.dependencies import ServiceContainer, wire_services
from app.core.config import Settings
from app.ml.detector import DetectedFace
from app.ml.embedder import Embedding, l2_normalize
from app.ml.face_analyzer import FaceAnalyzer
from app.repositories.backend_gallery import GalleryPerson

EMBEDDING_DIMENSION = 512
FACE_COLORS = {"red": (0, 0, 255), "blue": (255, 0, 0), "green": (0, 255, 0)}


class FakeDetector:
    """Finds one face in the centre of any non-black image."""

    def detect(self, image: np.ndarray) -> list[DetectedFace]:
        if image.max() == 0:
            return []
        height, width = image.shape[:2]
        x1, y1, x2, y2 = width * 0.3, height * 0.3, width * 0.7, height * 0.7
        face_w, face_h = x2 - x1, y2 - y1
        landmarks = np.array(
            [
                [x1 + 0.3 * face_w, y1 + 0.4 * face_h],
                [x1 + 0.7 * face_w, y1 + 0.4 * face_h],
                [x1 + 0.5 * face_w, y1 + 0.6 * face_h],
                [x1 + 0.35 * face_w, y1 + 0.8 * face_h],
                [x1 + 0.65 * face_w, y1 + 0.8 * face_h],
            ],
            dtype=np.float32,
        )
        bbox = np.array([x1, y1, x2, y2], dtype=np.float32)
        return [DetectedFace(bbox=bbox, landmarks=landmarks, score=0.95)]


class FakeEmbedder:
    """Embeds a face as its mean BGR colour, so same-colour images are the same 'person'."""

    model_name = "fake_embedder"

    def embed_faces(self, aligned_faces: list[np.ndarray]) -> list[Embedding]:
        embeddings = []
        for face in aligned_faces:
            vector = np.zeros(EMBEDDING_DIMENSION, dtype=np.float32)
            vector[:3] = face.reshape(-1, 3).mean(axis=0) + 1.0
            embeddings.append(l2_normalize(vector))
        return embeddings


def make_face_image(color_name: str, size: int = 200) -> np.ndarray:
    return np.full((size, size, 3), FACE_COLORS[color_name], dtype=np.uint8)


def encode_png(image: np.ndarray) -> bytes:
    return cv2.imencode(".png", image)[1].tobytes()


def gallery_person(person_id: str, color_name: str) -> GalleryPerson:
    name = f"{color_name.title()} Person"
    return GalleryPerson(person_id, name, encode_png(make_face_image(color_name)), "image/png")


class FakeGallerySource:
    """Stands in for the backend: event_id -> that event's registrants."""

    def __init__(self, people_by_event: dict[int, list[GalleryPerson]]) -> None:
        self.people_by_event = people_by_event
        self.fetch_count = 0

    def fetch_people(self, event_id: int) -> list[GalleryPerson]:
        self.fetch_count += 1
        return list(self.people_by_event.get(event_id, []))


@pytest.fixture
def gallery_source() -> FakeGallerySource:
    """Event 1 has one registrant with a photo, 'Red Person' (u1)."""
    return FakeGallerySource({1: [gallery_person("u1", "red")]})


@pytest.fixture
def settings() -> Settings:
    # Continuous detection: most tests feed a frame or two and expect it identified right away.
    return Settings(
        backend_event_id=1,
        video_autostart=False,
        match_threshold=0.9,
        detection_mode="continuous",
        _env_file=None,
    )


@pytest.fixture
def face_analyzer() -> FaceAnalyzer:
    return FaceAnalyzer(FakeDetector(), FakeEmbedder(), min_face_size_pixels=10)


@pytest.fixture
def container(
    settings: Settings, face_analyzer: FaceAnalyzer, gallery_source: FakeGallerySource
) -> ServiceContainer:
    return wire_services(
        settings, face_analyzer, face_analyzer, gallery_source, execution_providers=("CPUExecutionProvider",)
    )
