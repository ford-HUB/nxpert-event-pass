from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import ServiceContainer
from app.core.config import Settings
from app.main import create_app
from tests.conftest import FakeGallerySource, encode_png, gallery_person, make_face_image


@pytest.fixture
def client(settings: Settings, container: ServiceContainer) -> Iterator[TestClient]:
    app = create_app(settings, container_factory=lambda _: container)
    with TestClient(app) as test_client:
        yield test_client


def test_health_reports_enrolled_people(client: TestClient) -> None:
    body = client.get("/api/v1/health").json()
    assert body["status"] == "ok"
    assert body["gallery_event_id"] == 1
    assert body["enrolled_people"] == 1


def test_recognize_returns_name_and_photo_for_enrolled_face(client: TestClient) -> None:
    response = client.post(
        "/api/v1/recognize", files={"image": ("face.png", encode_png(make_face_image("red")), "image/png")}
    )
    assert response.status_code == 200
    face = response.json()["faces"][0]
    assert face["is_match"] is True
    assert face["person"]["name"] == "Red Person"
    photo = client.get(face["person"]["photo_url"])
    assert photo.status_code == 200
    assert photo.headers["content-type"].startswith("image/")


def test_recognize_unknown_face_has_no_person(client: TestClient) -> None:
    response = client.post(
        "/api/v1/recognize", files={"image": ("face.png", encode_png(make_face_image("blue")), "image/png")}
    )
    face = response.json()["faces"][0]
    assert face["is_match"] is False
    assert face["person"] is None


def test_recognize_rejects_non_image(client: TestClient) -> None:
    response = client.post("/api/v1/recognize", files={"image": ("notes.txt", b"hello", "text/plain")})
    assert response.status_code == 400


def test_reload_switches_gallery_to_another_event(
    client: TestClient, gallery_source: FakeGallerySource
) -> None:
    gallery_source.people_by_event[2] = [gallery_person("u2", "blue"), gallery_person("u1", "red")]

    summary = client.post("/api/v1/faces/reload?event_id=2").json()

    assert (summary["event_id"], summary["person_count"]) == (2, 2)
    body = client.get("/api/v1/faces").json()
    assert body["event_id"] == 2
    assert [face["name"] for face in body["faces"]] == ["Blue Person", "Red Person"]


def test_faces_cannot_be_uploaded(client: TestClient) -> None:
    files = {"image": ("blue.png", encode_png(make_face_image("blue")), "image/png")}
    assert client.post("/api/v1/faces", data={"name": "Blue"}, files=files).status_code == 405
    assert client.delete("/api/v1/faces/u1").status_code == 405


def test_unknown_face_photo_returns_404(client: TestClient) -> None:
    assert client.get("/api/v1/faces/nobody/photo").status_code == 404


def test_tracks_endpoint_when_stream_stopped(client: TestClient) -> None:
    body = client.get("/api/v1/stream/tracks").json()
    assert body["is_running"] is False
    assert body["tracks"] == []


def test_dashboard_is_served(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert "Faces in view" in response.text
