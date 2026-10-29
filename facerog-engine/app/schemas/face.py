from datetime import datetime

from pydantic import BaseModel


class FaceResponse(BaseModel):
    person_id: str
    name: str
    photo_url: str
    template_count: int
    embedding_model: str
    enrolled_at: datetime


class FaceListResponse(BaseModel):
    event_id: int | None
    total: int
    faces: list[FaceResponse]


class EnrollmentSummaryResponse(BaseModel):
    event_id: int
    person_count: int
    template_count: int
    skipped_people: list[str]
