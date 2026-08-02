from __future__ import annotations

import base64
import copy
from collections.abc import Iterator

import httpx
import pytest

from open_publisher_runtime.application.model_access import (
    ImageGenerationRequest,
    TextGenerationRequest,
)
from open_publisher_runtime.infrastructure.providers import (
    OpenAICompatibleImageProvider,
    OpenAICompatibleTextProvider,
)


class _JsonResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self.payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, object]:
        return self.payload


class _StreamResponse:
    is_redirect = False

    def __init__(self, data: bytes) -> None:
        self.data = data

    def __enter__(self) -> _StreamResponse:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def raise_for_status(self) -> None:
        return None

    def iter_bytes(self) -> Iterator[bytes]:
        yield self.data[:3]
        yield self.data[3:]


class _TextStreamResponse:
    def __init__(self, lines: list[str]) -> None:
        self.lines = lines

    def __enter__(self) -> _TextStreamResponse:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def raise_for_status(self) -> None:
        return None

    def iter_lines(self) -> Iterator[str]:
        yield from self.lines


def _provider(**overrides: object) -> OpenAICompatibleImageProvider:
    options: dict[str, object] = {
        "base_url": "https://models.example/v1",
        "api_key": "not-a-real-secret",
        "default_model": "image-model",
    }
    options.update(overrides)
    return OpenAICompatibleImageProvider(**options)  # type: ignore[arg-type]


def test_text_provider_applies_bounded_output_tokens(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed: dict[str, object] = {}

    def post(*_args: object, **kwargs: object) -> _JsonResponse:
        observed.update(kwargs)
        return _JsonResponse(
            {
                "model": "text-model",
                "choices": [{"message": {"content": "generated"}}],
                "usage": {"prompt_tokens": 3, "completion_tokens": 1},
            }
        )

    monkeypatch.setattr(httpx, "post", post)
    provider = OpenAICompatibleTextProvider(
        base_url="https://models.example/v1",
        api_key="not-a-real-secret",
        default_model="text-model",
        max_output_tokens=900,
    )

    response = provider.generate(TextGenerationRequest(purpose="draft", prompt="write"))

    assert response.text == "generated"
    assert observed["json"] == {
        "model": "text-model",
        "messages": [{"role": "user", "content": "write"}],
        "temperature": 0.2,
        "max_tokens": 900,
    }


def test_text_provider_rejects_reserved_extra_request_fields() -> None:
    with pytest.raises(ValueError, match="reserved fields"):
        OpenAICompatibleTextProvider(
            base_url="https://models.example/v1",
            api_key="not-a-real-secret",
            default_model="text-model",
            extra_request_fields={"messages": []},
        )


def test_text_provider_streams_delta_content_and_rejects_empty_stream(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        httpx,
        "stream",
        lambda *_args, **_kwargs: _TextStreamResponse(
            [
                'data: {"model":"text-model","choices":[{"delta":{"content":"第一段"}}]}',
                'data: {"choices":[{"delta":{"content":"第二段"}}]}',
                "data: [DONE]",
            ]
        ),
    )
    provider = OpenAICompatibleTextProvider(
        base_url="https://models.example/v1",
        api_key="not-a-real-secret",
        default_model="text-model",
    )
    deltas: list[str] = []

    response = provider.generate_stream(
        TextGenerationRequest(purpose="draft", prompt="write"),
        deltas.append,
    )

    assert deltas == ["第一段", "第二段"]
    assert response.text == "第一段第二段"

    monkeypatch.setattr(
        httpx,
        "stream",
        lambda *_args, **_kwargs: _TextStreamResponse(["data: [DONE]"]),
    )
    with pytest.raises(RuntimeError, match="without article content"):
        provider.generate_stream(
            TextGenerationRequest(purpose="draft", prompt="write"),
            lambda _: None,
        )


def test_text_provider_observes_two_tool_rounds_then_streams_only_final_draft(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    responses = iter(
        [
            {
                "choices": [
                    {
                        "message": {
                            "tool_calls": [
                                {
                                    "id": "search-1",
                                    "type": "function",
                                    "function": {
                                        "name": "web_search",
                                        "arguments": '{"query":"Wandao GitHub"}',
                                    },
                                }
                            ]
                        }
                    }
                ]
            },
            {
                "choices": [
                    {
                        "message": {
                            "tool_calls": [
                                {
                                    "id": "repository-1",
                                    "type": "function",
                                    "function": {
                                        "name": "github_repository",
                                        "arguments": '{"repository":"example/wandao"}',
                                    },
                                }
                            ]
                        }
                    }
                ]
            },
        ]
    )
    post_payloads: list[dict[str, object]] = []
    stream_payloads: list[dict[str, object]] = []
    executed: list[tuple[str, dict[str, object]]] = []

    def post(*_args: object, **kwargs: object) -> _JsonResponse:
        payload = kwargs["json"]
        assert isinstance(payload, dict)
        post_payloads.append(copy.deepcopy(payload))
        return _JsonResponse(next(responses))

    def stream(*_args: object, **kwargs: object) -> _TextStreamResponse:
        payload = kwargs["json"]
        assert isinstance(payload, dict)
        stream_payloads.append(copy.deepcopy(payload))
        return _TextStreamResponse(
            [
                'data: {"choices":[{"delta":{"content":"# 最终文章"}}]}',
                'data: {"choices":[{"delta":{"content":"\\n\\n正文"}}]}',
                "data: [DONE]",
            ]
        )

    monkeypatch.setattr(httpx, "post", post)
    monkeypatch.setattr(httpx, "stream", stream)
    provider = OpenAICompatibleTextProvider(
        base_url="https://models.example/v1",
        api_key="not-a-real-secret",
        default_model="text-model",
    )
    deltas: list[str] = []
    response = provider.generate_with_tools_stream(
        TextGenerationRequest(purpose="draft", prompt="write"),
        tools=[
            {"type": "function", "function": {"name": "web_search"}},
            {"type": "function", "function": {"name": "github_repository"}},
        ],
        execute_tool=lambda name, arguments: (
            executed.append((name, arguments)) or '{"sources":[]}'
        ),
        on_delta=deltas.append,
        max_tool_calls=2,
    )

    assert executed == [
        ("web_search", {"query": "Wandao GitHub"}),
        ("github_repository", {"repository": "example/wandao"}),
    ]
    assert len(post_payloads) == 2
    assert all(payload["tool_choice"] == "auto" for payload in post_payloads)
    assert post_payloads[1]["messages"][-1] == {
        "role": "tool",
        "tool_call_id": "search-1",
        "content": '{"sources":[]}',
    }
    assert len(stream_payloads) == 1
    assert "tools" not in stream_payloads[0]
    assert stream_payloads[0]["messages"][-1]["role"] == "user"
    assert deltas == ["# 最终文章", "\n\n正文"]
    assert response.text == "# 最终文章\n\n正文"


def test_image_provider_accepts_siliconflow_shape_and_downloads_allowlisted_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    image = b"\x89PNG\r\n\x1a\npayload"
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *_args, **_kwargs: _JsonResponse(
            {
                "images": [{"url": "https://images.example/generated/result.png"}],
                "data": [{"url": "https://images.example/generated/result.png"}],
            }
        ),
    )
    monkeypatch.setattr(
        httpx,
        "stream",
        lambda *_args, **_kwargs: _StreamResponse(image),
    )

    response = _provider(trusted_image_hosts=frozenset({"images.example"})).generate(
        ImageGenerationRequest(prompt="cover")
    )

    assert response.urls == ["https://images.example/generated/result.png"]
    assert response.images_base64 == [base64.b64encode(image).decode("ascii")]


def test_image_provider_rejects_url_outside_explicit_allowlist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        httpx,
        "post",
        lambda *_args, **_kwargs: _JsonResponse(
            {"images": [{"url": "https://untrusted.example/generated/result.png"}]}
        ),
    )

    with pytest.raises(ValueError, match="trusted host allowlist"):
        _provider(trusted_image_hosts=frozenset({"images.example"})).generate(
            ImageGenerationRequest(prompt="cover")
        )


def test_image_provider_keeps_openai_base64_response_without_downloading(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    encoded = base64.b64encode(b"image").decode("ascii")
    observed: dict[str, object] = {}

    def post(*_args: object, **kwargs: object) -> _JsonResponse:
        observed.update(kwargs)
        return _JsonResponse({"data": [{"b64_json": encoded}]})

    monkeypatch.setattr(
        httpx,
        "post",
        post,
    )

    response = _provider().generate(ImageGenerationRequest(prompt="cover"))

    assert response.urls == []
    assert response.images_base64 == [encoded]
    assert observed["json"] == {
        "model": "image-model",
        "prompt": "cover",
        "size": "1024x1024",
        "response_format": "b64_json",
    }


def test_image_provider_can_use_siliconflow_request_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed: dict[str, object] = {}

    def post(*_args: object, **kwargs: object) -> _JsonResponse:
        observed.update(kwargs)
        return _JsonResponse({"images": []})

    monkeypatch.setattr(httpx, "post", post)

    _provider(
        size_field="image_size",
        response_format=None,
        extra_request_fields={"batch_size": 1, "num_inference_steps": 20},
    ).generate(ImageGenerationRequest(prompt="cover"))

    assert observed["json"] == {
        "model": "image-model",
        "prompt": "cover",
        "image_size": "1024x1024",
        "batch_size": 1,
        "num_inference_steps": 20,
    }


def test_image_provider_rejects_reserved_extra_request_fields() -> None:
    with pytest.raises(ValueError, match="reserved fields"):
        _provider(extra_request_fields={"prompt": "replace caller prompt"})
