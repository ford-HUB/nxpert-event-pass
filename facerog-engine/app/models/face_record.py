from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class FaceRecord:
    """An enrolled person, as registered in the backend.

    photo is the registered picture shown when this person is recognized.
    template_count is how many embeddings (the photo plus its augmented versions) are indexed.
    """

    person_id: str
    name: str
    photo: bytes
    photo_media_type: str
    template_count: int
    embedding_model: str
    enrolled_at: datetime
