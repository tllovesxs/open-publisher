from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient

from open_publisher_runtime.config import Settings
from open_publisher_runtime.main import (
    MODEL_API_KEY_ENV,
    TEXT_BASE_URL_ENV,
    TEXT_MODEL_ENV,
    create_app,
)

TEST_API_TOKEN = "test-open-publisher-sidecar-token-0001"


class _JsonResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, object]:
        return self.payload


class _StreamingResponse:
    def __init__(self, lines: list[str]) -> None:
        self.lines = lines

    def __enter__(self) -> _StreamingResponse:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def raise_for_status(self) -> None:
        return None

    def iter_lines(self) -> list[str]:
        return self.lines


def test_workflow_persists_openai_compatible_output_as_artifacts(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    base_url = "https://models.example/v1"
    monkeypatch.setenv(MODEL_API_KEY_ENV, "test-only-key")
    monkeypatch.setenv(TEXT_BASE_URL_ENV, base_url)
    monkeypatch.setenv(TEXT_MODEL_ENV, "remote-text-model")
    calls: list[dict[str, object]] = []

    def post(url: str, **kwargs: object) -> _JsonResponse:
        calls.append({"url": url, **kwargs})
        index = len(calls)
        return _JsonResponse(
            {
                "model": "remote-text-model",
                "choices": [{"message": {"content": f"remote-output-{index}"}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 4},
            }
        )

    def stream(method: str, url: str, **kwargs: object) -> _StreamingResponse:
        assert method == "POST"
        calls.append({"url": url, **kwargs})
        index = len(calls)
        return _StreamingResponse(
            [
                (
                    'data: {"model":"remote-text-model","choices":['
                    '{"delta":{"content":"remote-output-'
                    f'{index}'
                    '"}}]}'
                ),
                'data: {"usage":{"prompt_tokens":10,"completion_tokens":4},"choices":[]}',
                "data: [DONE]",
            ]
        )

    monkeypatch.setattr(httpx, "post", post)
    monkeypatch.setattr(httpx, "stream", stream)
    app = create_app(
        Settings(data_dir=tmp_path / "runtime-data", api_token=TEST_API_TOKEN)
    )
    with TestClient(app) as client:
        client.headers.update({"Authorization": f"Bearer {TEST_API_TOKEN}"})
        article = client.post(
            "/api/v1/articles",
            json={"title": "真实模型链路", "markdown": "# 初稿\n\n用户素材。"},
        ).json()
        workflow = client.get("/api/v1/workflows").json()[0]
        run = client.post(
            "/api/v1/runs",
            json={
                "workflow_id": workflow["id"],
                "article_id": article["article"]["id"],
                "revision_id": article["revision"]["id"],
                "policy": {
                    "disabled_optional_node_ids": [
                        "research",
                        "outline",
                        "natural-style",
                        "review",
                        "visual",
                    ],
                    "max_model_calls": 1,
                },
            },
        ).json()

        assert run["status"] == "completed"
        assert run["state_json"]["enabled_node_ids"] == ["draft"]
        assert client.get(
            f"/api/v1/articles/{article['article']['id']}"
        ).json()["latest_revision"]["markdown"] == "remote-output-1"

    assert [call["url"] for call in calls] == [f"{base_url}/chat/completions"]
    assert all(call["json"]["model"] == "remote-text-model" for call in calls)
    assert calls[0]["json"]["stream"] is True
