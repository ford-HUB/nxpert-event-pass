import base64

from app.repositories.backend_gallery import parse_data_url


def test_parse_data_url_decodes_image_payload() -> None:
    url = "data:image/jpeg;base64," + base64.b64encode(b"jpeg-bytes").decode()
    assert parse_data_url(url) == (b"jpeg-bytes", "image/jpeg")


def test_parse_data_url_rejects_non_image_and_plain_urls() -> None:
    assert parse_data_url("data:text/plain;base64,aGk=") is None
    assert parse_data_url("https://example.com/photo.jpg") is None
    assert parse_data_url("data:image/png;base64,***") is None
