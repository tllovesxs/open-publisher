from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from open_publisher_runtime.config import Settings
from open_publisher_runtime.infrastructure.providers import (
    MockImageProvider,
    MockTextProvider,
    OpenAICompatibleImageProvider,
    OpenAICompatibleTextProvider,
)
from open_publisher_runtime.main import (
    IMAGE_BASE_URL_ENV,
    IMAGE_MODEL_ENV,
    IMAGE_TRUSTED_HOSTS_ENV,
    LEGACY_SILICONFLOW_API_KEY_ENV,
    MODEL_API_KEY_ENV,
    MODEL_TIMEOUT_SECONDS_ENV,
    SILICONFLOW_BASE_URL,
    SILICONFLOW_IMAGE_MODEL,
    SILICONFLOW_TEXT_MODEL,
    TEXT_BASE_URL_ENV,
    TEXT_MODEL_ENV,
    create_app,
    model_access_from_env,
)

TEST_API_TOKEN = "test-open-publisher-sidecar-token-0001"


class _JsonResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, object]:
        return self.payload


def _settings(tmp_path) -> Settings:
    return Settings(
        data_dir=tmp_path / "runtime-data",
        api_token=TEST_API_TOKEN,
    )


def test_model_environment_defaults_to_mock_and_degrades_each_provider_independently() -> None:
    empty_access = model_access_from_env({})
    assert isinstance(empty_access.text_provider, MockTextProvider)
    assert isinstance(empty_access.image_provider, MockImageProvider)

    text_only_access = model_access_from_env(
        {
            MODEL_API_KEY_ENV: "test-only-key",
            TEXT_BASE_URL_ENV: "https://models.example/v1",
            TEXT_MODEL_ENV: "text-model",
        }
    )
    assert isinstance(text_only_access.text_provider, OpenAICompatibleTextProvider)
    assert isinstance(text_only_access.image_provider, MockImageProvider)


def test_generic_model_environment_configures_text_image_timeout_and_hosts() -> None:
    access = model_access_from_env(
        {
            MODEL_API_KEY_ENV: "test-only-key",
            TEXT_BASE_URL_ENV: "https://models.example/v1",
            TEXT_MODEL_ENV: "text-model",
            IMAGE_BASE_URL_ENV: "https://images.example/v1",
            IMAGE_MODEL_ENV: "image-model",
            IMAGE_TRUSTED_HOSTS_ENV: "cdn-a.example, cdn-b.example",
            MODEL_TIMEOUT_SECONDS_ENV: "45",
        }
    )

    assert isinstance(access.text_provider, OpenAICompatibleTextProvider)
    assert access.text_provider.base_url == "https://models.example/v1"
    assert access.text_provider.default_model == "text-model"
    assert access.text_provider.timeout_seconds == 45
    assert isinstance(access.image_provider, OpenAICompatibleImageProvider)
    assert access.image_provider.base_url == "https://images.example/v1"
    assert access.image_provider.default_model == "image-model"
    assert access.image_provider.timeout_seconds == 45
    assert access.image_provider.trusted_image_hosts == frozenset(
        {"cdn-a.example", "cdn-b.example"}
    )


def test_legacy_siliconflow_key_uses_compatible_defaults() -> None:
    access = model_access_from_env(
        {LEGACY_SILICONFLOW_API_KEY_ENV: "legacy-test-only-key"}
    )

    assert isinstance(access.text_provider, OpenAICompatibleTextProvider)
    assert access.text_provider.base_url == SILICONFLOW_BASE_URL
    assert access.text_provider.default_model == SILICONFLOW_TEXT_MODEL
    assert isinstance(access.image_provider, OpenAICompatibleImageProvider)
    assert access.image_provider.base_url == SILICONFLOW_BASE_URL
    assert access.image_provider.default_model == SILICONFLOW_IMAGE_MODEL
    assert access.image_provider.size_field == "image_size"
    assert access.image_provider.response_format is None
    assert access.image_provider.trusted_image_hosts == frozenset(
        {"s3.siliconflow.cn"}
    )


def test_model_connection_endpoint_reports_mock_without_external_calls(client) -> None:
    response = client.post("/api/v1/models/test", json={})

    assert response.status_code == 200
    assert response.json() == {
        "provider": "mock",
        "model": "deterministic-mock-v1",
        "mocked": True,
    }


def test_model_connection_endpoint_makes_one_bounded_call_and_returns_only_summary(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    secret = "endpoint-test-only-key"
    base_url = "https://models.example/v1"
    monkeypatch.setenv(MODEL_API_KEY_ENV, secret)
    monkeypatch.setenv(TEXT_BASE_URL_ENV, base_url)
    monkeypatch.setenv(TEXT_MODEL_ENV, "requested-model")
    observed: list[tuple[tuple[object, ...], dict[str, object]]] = []

    def post(*args: object, **kwargs: object) -> _JsonResponse:
        observed.append((args, kwargs))
        return _JsonResponse(
            {
                "model": "resolved-model",
                "choices": [{"message": {"content": "OK"}}],
                "usage": {"prompt_tokens": 4, "completion_tokens": 1},
            }
        )

    monkeypatch.setattr(httpx, "post", post)
    app = create_app(_settings(tmp_path))
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/models/test",
            headers={"Authorization": f"Bearer {TEST_API_TOKEN}"},
            json={},
        )

    assert response.status_code == 200
    assert response.json() == {
        "provider": "openai-compatible",
        "model": "resolved-model",
        "mocked": False,
    }
    assert len(observed) == 1
    args, kwargs = observed[0]
    assert args == (f"{base_url}/chat/completions",)
    assert kwargs["json"] == {
        "model": "requested-model",
        "messages": [{"role": "user", "content": "Reply with OK."}],
        "temperature": 0.0,
        "max_tokens": 8,
    }
    serialized_response = response.text
    assert secret not in serialized_response
    assert base_url not in serialized_response
    assert "Reply with OK." not in serialized_response


def test_model_connection_endpoint_sanitizes_upstream_errors(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    secret = "failure-test-only-key"
    monkeypatch.setenv(MODEL_API_KEY_ENV, secret)
    monkeypatch.setenv(TEXT_BASE_URL_ENV, "https://models.example/v1")
    monkeypatch.setenv(TEXT_MODEL_ENV, "text-model")

    def fail(*_args: object, **_kwargs: object) -> _JsonResponse:
        request = httpx.Request("POST", "https://models.example/v1/chat/completions")
        raise httpx.ConnectError(f"upstream rejected {secret}", request=request)

    monkeypatch.setattr(httpx, "post", fail)
    app = create_app(_settings(tmp_path))
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.post(
            "/api/v1/models/test",
            headers={"Authorization": f"Bearer {TEST_API_TOKEN}"},
            json={},
        )

    assert response.status_code == 502
    assert response.json() == {"detail": "model connection test failed"}
    assert secret not in response.text
