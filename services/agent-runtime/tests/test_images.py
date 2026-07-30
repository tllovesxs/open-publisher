import base64

import pytest

import open_publisher_runtime.application.images as image_module
import open_publisher_runtime.infrastructure.providers as provider_module
from open_publisher_runtime.application.artifacts import ArtifactService
from open_publisher_runtime.application.model_access import ImageGenerationResponse
from open_publisher_runtime.infrastructure.repository import SqlAlchemyRuntimeRepository


class StaticImageProvider:
    def __init__(self, response: ImageGenerationResponse) -> None:
        self.response = response

    @property
    def name(self) -> str:
        return self.response.provider

    def generate(self, request):
        return self.response


def test_image_endpoint_requires_sidecar_bearer_token(client) -> None:
    original = client.headers.pop("Authorization")
    try:
        response = client.post(
            "/api/v1/images/generate",
            json={"prompt": "cover", "size": "1024x1024"},
        )
        assert response.status_code == 401
    finally:
        client.headers["Authorization"] = original


def test_authenticated_mock_image_generation_stores_public_artifact_without_network(
    client, monkeypatch
) -> None:
    def reject_network(*args, **kwargs):
        raise AssertionError("mock image generation attempted a network request")

    monkeypatch.setattr(provider_module.httpx, "post", reject_network)
    response = client.post(
        "/api/v1/images/generate",
        json={
            "prompt": "简洁封面 <script>alert(1)</script> & 安全测试",
            "size": "512x512",
        },
    )
    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["provider"] == "mock"
    assert payload["model"] == "deterministic-svg-v1"
    assert payload["mocked"] is True
    assert payload["remote_urls_ignored"] == 0
    assert len(payload["artifacts"]) == 1
    artifact = payload["artifacts"][0]
    assert artifact["kind"] == "image.generated"
    assert artifact["media_type"] == "image/svg+xml"
    assert artifact["metadata_json"]["requested_size"] == "512x512"
    assert "prompt_hash" in artifact["metadata_json"]
    assert "storage_path" not in artifact
    assert "secret" not in response.text.casefold()

    with client.app.state.container.database.session() as session:
        repository = SqlAlchemyRuntimeRepository(session)
        artifacts = ArtifactService(repository, client.app.state.container.blob_store)
        svg = artifacts.read_text(artifact["id"])
    assert "<script>" not in svg
    assert "&lt;script&gt;" in svg
    assert "&amp;" in svg


@pytest.mark.parametrize(
    "payload",
    [
        {"prompt": "   ", "size": "1024x1024"},
        {"prompt": "cover", "size": "999x999"},
        {"prompt": "x" * 4001, "size": "1024x1024"},
        {"prompt": "cover", "size": "1024x1024", "model": "x" * 201},
    ],
)
def test_image_request_limits_are_validated_before_provider_call(client, payload) -> None:
    response = client.post("/api/v1/images/generate", json=payload)
    assert response.status_code == 422


def test_image_provider_output_count_and_decoded_size_are_bounded(
    client, monkeypatch
) -> None:
    encoded_png = base64.b64encode(b"\x89PNG\r\n\x1a\npayload").decode()
    client.app.state.container.model_access.image_provider = StaticImageProvider(
        ImageGenerationResponse(
            provider="test",
            model="test-image",
            images_base64=[encoded_png] * 5,
        )
    )
    too_many = client.post(
        "/api/v1/images/generate",
        json={"prompt": "cover", "size": "1024x1024"},
    )
    assert too_many.status_code == 409

    monkeypatch.setattr(image_module, "MAX_GENERATED_IMAGE_BYTES", 8)
    client.app.state.container.model_access.image_provider = StaticImageProvider(
        ImageGenerationResponse(
            provider="test",
            model="test-image",
            images_base64=[encoded_png],
        )
    )
    oversized = client.post(
        "/api/v1/images/generate",
        json={"prompt": "cover", "size": "1024x1024"},
    )
    assert oversized.status_code == 409
    assert not any(
        path.is_file() for path in client.app.state.container.blob_store.root.rglob("*")
    )


def test_remote_image_urls_are_reported_but_never_downloaded(client, monkeypatch) -> None:
    def reject_network(*args, **kwargs):
        raise AssertionError("remote image URL was downloaded")

    monkeypatch.setattr(provider_module.httpx, "get", reject_network)
    monkeypatch.setattr(provider_module.httpx, "stream", reject_network)
    client.app.state.container.model_access.image_provider = StaticImageProvider(
        ImageGenerationResponse(
            provider="remote-test",
            model="url-only",
            urls=["https://example.invalid/generated.png"],
            mocked=False,
        )
    )
    response = client.post(
        "/api/v1/images/generate",
        json={"prompt": "cover", "size": "1024x1024"},
    )
    assert response.status_code == 201, response.text
    assert response.json() == {
        "provider": "remote-test",
        "model": "url-only",
        "mocked": False,
        "artifacts": [],
        "remote_urls_ignored": 1,
    }
    assert not any(
        path.is_file() for path in client.app.state.container.blob_store.root.rglob("*")
    )


def test_non_mock_svg_and_invalid_base64_are_rejected_before_writes(client) -> None:
    remote_svg = base64.b64encode(b"<svg xmlns='http://www.w3.org/2000/svg'></svg>").decode()
    for encoded in (remote_svg, "not-valid-base64!!!"):
        client.app.state.container.model_access.image_provider = StaticImageProvider(
            ImageGenerationResponse(
                provider="remote-test",
                model="unsafe-output",
                images_base64=[encoded],
                mocked=False,
            )
        )
        response = client.post(
            "/api/v1/images/generate",
            json={"prompt": "cover", "size": "1024x1024"},
        )
        assert response.status_code == 409
    assert not any(
        path.is_file() for path in client.app.state.container.blob_store.root.rglob("*")
    )
