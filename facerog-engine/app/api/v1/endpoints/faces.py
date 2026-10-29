from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from app.api.dependencies import get_enrollment_service
from app.api.v1.presenters import present_face, present_summary
from app.schemas.face import EnrollmentSummaryResponse, FaceListResponse, FaceResponse
from app.services.enrollment_service import EnrollmentService

router = APIRouter(prefix="/faces", tags=["faces"])

EnrollmentDependency = Annotated[EnrollmentService, Depends(get_enrollment_service)]


@router.get("", response_model=FaceListResponse)
def list_faces(service: EnrollmentDependency) -> FaceListResponse:
    faces = [present_face(record) for record in service.list_faces()]
    return FaceListResponse(event_id=service.event_id, total=len(faces), faces=faces)


@router.post("/reload", response_model=EnrollmentSummaryResponse)
def reload_faces(
    service: EnrollmentDependency, event_id: Annotated[int | None, Query(ge=1)] = None
) -> EnrollmentSummaryResponse:
    """Rebuild the gallery from the event's registrants in the backend.

    Omit event_id to re-sync the current event (new registrations, changed photos).
    """
    return present_summary(service.sync_gallery(event_id))


@router.get("/{person_id}", response_model=FaceResponse)
def get_face(person_id: str, service: EnrollmentDependency) -> FaceResponse:
    return present_face(service.get_face(person_id))


@router.get("/{person_id}/photo")
def get_face_photo(person_id: str, service: EnrollmentDependency) -> Response:
    """The picture the person registered with in the backend."""
    record = service.get_face(person_id)
    return Response(record.photo, media_type=record.photo_media_type, headers={"Cache-Control": "no-store"})
