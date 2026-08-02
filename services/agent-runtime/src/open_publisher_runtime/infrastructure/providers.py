from __future__ import annotations

import base64
import json
import os
import re
from collections.abc import Callable, Sequence
from typing import Any
from urllib.parse import urlparse

import httpx

from open_publisher_runtime.application.model_access import (
    ImageGenerationRequest,
    ImageGenerationResponse,
    TextGenerationRequest,
    TextGenerationResponse,
)


def _unique_strings(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))


class EnvironmentSecretResolver:
    def resolve(self, secret_ref: str) -> str:
        parsed = urlparse(secret_ref)
        if parsed.scheme == "mock":
            return "mock-not-a-secret"
        if parsed.scheme != "env":
            raise RuntimeError(
                "this standalone runtime resolves env:// only; Rust must broker other secret refs"
            )
        variable = (parsed.netloc + parsed.path).strip("/")
        if not variable:
            raise ValueError("env:// secret_ref must name an environment variable")
        value = os.getenv(variable)
        if not value:
            raise RuntimeError(f"secret reference {secret_ref!r} is unavailable")
        return value


class ModelProviderNotConfiguredError(RuntimeError):
    """Raised when a caller requests AI output without an enabled provider."""


class UnconfiguredTextProvider:
    @property
    def name(self) -> str:
        return "unconfigured"

    def generate(self, _request: TextGenerationRequest) -> TextGenerationResponse:
        raise ModelProviderNotConfiguredError(
            "text model is not configured; configure an OpenAI-compatible model or enable "
            "explicit local demo mode"
        )


class UnconfiguredImageProvider:
    @property
    def name(self) -> str:
        return "unconfigured"

    def generate(self, _request: ImageGenerationRequest) -> ImageGenerationResponse:
        raise ModelProviderNotConfiguredError(
            "image model is not configured; configure an OpenAI-compatible image model or "
            "enable explicit local demo mode"
        )


class MockTextProvider:
    @property
    def name(self) -> str:
        return "mock"

    def generate(self, request: TextGenerationRequest) -> TextGenerationResponse:
        title = str(request.context.get("title") or "未命名文章").strip()
        source = str(request.context.get("source_markdown") or "").strip()
        topic = str(request.context.get("topic") or title).strip()

        if request.purpose == "template-extraction":
            headings = [
                match.group(1)
                for line in source.splitlines()
                if (match := re.match(r"^(#{1,6})\\s+\\S", line))
            ]
            section_depths = [len(heading) for heading in headings[1:9]] or [2, 2, 2]
            sections = []
            for index, depth in enumerate(section_depths, start=1):
                sections.extend(
                    [
                        f"{'#' * depth} {{{{section_{index}_heading}}}}",
                        "",
                        f"{{{{section_{index}_content}}}}",
                        "",
                    ]
                )
            template = {
                "name": "文章结构模板",
                "description": "从原文层级提取的可复用 Markdown 结构。",
                "category": "自定义文章",
                "markdown": "\n".join(
                    [
                        "# {{title}}",
                        "",
                        "{{lead}}",
                        "",
                        *sections,
                        "## {{closing_heading}}",
                        "",
                        "{{closing}}",
                    ]
                ).strip(),
            }
            text = json.dumps(template, ensure_ascii=False)
        elif request.purpose == "batch-topic-plan":
            count = int(request.context.get("count") or 3)
            prompt = str(request.context.get("prompt") or topic)
            text = json.dumps(
                [
                    {
                        "title": f"{prompt[:48]}：第 {index} 个切入点",
                        "topic": f"{prompt}（切入点 {index}）",
                        "angle": "以一个明确功能或实践问题为中心展开。",
                        "key_points": ["问题与受众", "可执行做法", "边界与下一步"],
                    }
                    for index in range(1, count + 1)
                ],
                ensure_ascii=False,
            )
        elif request.purpose == "research":
            text = (
                "## 研究卡片\n\n"
                f"- 主题：{topic}\n"
                "- 已知素材：仅使用用户提供内容与可验证的通用方法\n"
                "- 事实边界：不补造统计数字、机构背书或人物引语\n"
                "- 写作角度：问题背景、实践路径、风险边界、下一步"
            )
        elif request.purpose == "outline":
            text = (
                f"# {title}：写作大纲\n\n"
                f"1. 为什么关注「{topic}」\n"
                "2. 核心观点与实践路径\n"
                "3. 风险、边界与下一步"
            )
        elif request.purpose == "draft":
            source_section = source if source else f"{topic} 是本文讨论的核心主题。"
            text = (
                f"# {title}\n\n"
                f"{source_section}\n\n"
                "## 核心观点\n\n"
                "先明确目标和约束，再将可验证的步骤拆分执行，并保留人工修订空间。\n\n"
                "## 实践建议\n\n"
                "从可回滚的最小闭环开始，记录每一步产物，最后再适配不同发布平台。"
            )
        elif request.purpose == "naturalize":
            naturalized = source.replace(
                "先明确目标和约束，再将可验证的步骤拆分执行，并保留人工修订空间。",
                "先把目标和边界说清楚，再逐步验证；关键判断仍留给作者确认。",
            ).replace(
                "从可回滚的最小闭环开始，记录每一步产物，最后再适配不同发布平台。",
                "可以先跑通一个可回滚的小闭环，留下过程产物，再逐个平台校准表达。",
            )
            if naturalized == source:
                naturalized = f"{source}\n\n> 本稿已完成自然表达整理，事实边界保持不变。"
            text = naturalized
        elif request.purpose == "editor-rewrite":
            source = str(request.context.get("source_markdown") or source).strip()
            instruction = str(request.context.get("instruction") or "").strip()
            if "精简" in instruction or "简洁" in instruction:
                text = re.sub(r"[ \t]{2,}", " ", source)
            elif "标题" in instruction and source.startswith("#"):
                text = source.replace("# ", "# ", 1)
            else:
                text = source
        elif request.purpose == "review":
            text = (
                "## 审核结果\n\n"
                "- 结构：通过\n"
                "- 事实：当前为演示内容，无外部事实声明\n"
                "- 合规：未发现演示规则中的硬错误\n"
                "- 建议：正式发布前由用户确认平台预览"
            )
        elif request.purpose == "risk":
            text = (
                "## 风险检查\n\n"
                "- 事实风险：未发现无来源的数字、引语或权威背书\n"
                "- 合规风险：未发现演示规则中的违禁表达\n"
                "- 平台风险：标题与正文仍需在发布预览中人工确认\n"
                "- 结论：低风险，可进入人工审核"
            )
        elif request.purpose == "visual":
            text = (
                "## 视觉计划\n\n"
                "- 封面：单一核心标题，留出平台裁切安全区\n"
                "- 配图 1：目标、约束、执行三段式流程图\n"
                "- 配图 2：风险检查清单卡片\n"
                "- 约束：不生成品牌标识、人物肖像或未经证实的数据图"
            )
        else:
            text = f"[mock:{request.purpose}] {request.prompt[:200]}"

        return TextGenerationResponse(
            text=text,
            provider=self.name,
            model=request.model or "deterministic-mock-v1",
            usage={"input_tokens": 0, "output_tokens": 0},
            mocked=True,
        )


class MockImageProvider:
    @property
    def name(self) -> str:
        return "mock"

    def generate(self, request: ImageGenerationRequest) -> ImageGenerationResponse:
        # Keep the development provider on the same safe raster path as production.
        # The 1x1 PNG intentionally carries no prompt-derived content.
        png_base64 = (
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/"
            "ScLZ8QAAAABJRU5ErkJggg=="
        )
        return ImageGenerationResponse(
            provider=self.name,
            model=request.model or "deterministic-png-v1",
            images_base64=[png_base64],
            mocked=True,
        )


class OpenAICompatibleTextProvider:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        default_model: str,
        timeout_seconds: float = 60,
        max_output_tokens: int | None = None,
        extra_request_fields: dict[str, Any] | None = None,
    ) -> None:
        if max_output_tokens is not None and not 1 <= max_output_tokens <= 32_768:
            raise ValueError("text output token limit must be between 1 and 32768")
        reserved_fields = {"model", "messages", "temperature", "max_tokens"}
        extra_fields = dict(extra_request_fields or {})
        if reserved_fields.intersection(extra_fields):
            raise ValueError("extra text request fields cannot replace reserved fields")
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.default_model = default_model
        self.timeout_seconds = timeout_seconds
        self.max_output_tokens = max_output_tokens
        self.extra_request_fields = extra_fields

    @property
    def name(self) -> str:
        return "openai-compatible"

    def generate(self, request: TextGenerationRequest) -> TextGenerationResponse:
        request_payload = {
            "model": request.model or self.default_model,
            "messages": [{"role": "user", "content": request.prompt}],
            "temperature": request.temperature,
            **self.extra_request_fields,
        }
        output_limit = request.max_output_tokens or self.max_output_tokens
        if output_limit is not None:
            request_payload["max_tokens"] = output_limit
        response = httpx.post(
            f"{self.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json=request_payload,
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        usage = payload.get("usage") or {}
        return TextGenerationResponse(
            text=payload["choices"][0]["message"]["content"],
            provider=self.name,
            model=payload.get("model") or request.model or self.default_model,
            usage={
                "input_tokens": int(usage.get("prompt_tokens", 0)),
                "output_tokens": int(usage.get("completion_tokens", 0)),
            },
        )

    def generate_stream(
        self,
        request: TextGenerationRequest,
        on_delta: Callable[[str], None],
    ) -> TextGenerationResponse:
        """Read the OpenAI-compatible SSE response without exposing it to the UI."""

        return self._stream_messages(
            request,
            messages=[{"role": "user", "content": request.prompt}],
            on_delta=on_delta,
        )

    def generate_with_tools_stream(
        self,
        request: TextGenerationRequest,
        *,
        tools: Sequence[dict[str, object]],
        execute_tool: Callable[[str, dict[str, Any]], str],
        on_delta: Callable[[str], None],
        max_tool_calls: int,
    ) -> TextGenerationResponse:
        """Run one bounded tool round, then stream the final writer response."""

        if not tools or max_tool_calls < 1:
            return self.generate_stream(request, on_delta)
        messages: list[dict[str, Any]] = [{"role": "user", "content": request.prompt}]
        request_payload: dict[str, Any] = {
            "model": request.model or self.default_model,
            "messages": messages,
            "temperature": request.temperature,
            "tools": list(tools),
            "tool_choice": "auto",
            **self.extra_request_fields,
        }
        output_limit = request.max_output_tokens or self.max_output_tokens
        if output_limit is not None:
            request_payload["max_tokens"] = output_limit
        response = httpx.post(
            f"{self.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json=request_payload,
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        choices = payload.get("choices")
        choice = choices[0] if isinstance(choices, list) and choices else {}
        message = choice.get("message") if isinstance(choice, dict) else None
        if not isinstance(message, dict):
            return self._stream_messages(request, messages=messages, on_delta=on_delta)
        tool_calls = message.get("tool_calls")
        if not isinstance(tool_calls, list) or not tool_calls:
            content = message.get("content")
            if isinstance(content, str) and content.strip():
                on_delta(content)
                usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
                return TextGenerationResponse(
                    text=content,
                    provider=self.name,
                    model=str(payload.get("model") or request.model or self.default_model),
                    usage={
                        "input_tokens": int(usage.get("prompt_tokens", 0)),
                        "output_tokens": int(usage.get("completion_tokens", 0)),
                    },
                )
            return self._stream_messages(request, messages=messages, on_delta=on_delta)
        if len(tool_calls) > max_tool_calls:
            raise RuntimeError(f"writer requested more than {max_tool_calls} web tool calls")

        assistant_message: dict[str, Any] = {
            "role": "assistant",
            "content": message.get("content"),
            "tool_calls": tool_calls,
        }
        messages.append(assistant_message)
        for call in tool_calls:
            if not isinstance(call, dict):
                raise RuntimeError("writer returned an invalid web tool call")
            call_id = call.get("id")
            function = call.get("function")
            if not isinstance(call_id, str) or not isinstance(function, dict):
                raise RuntimeError("writer returned an invalid web tool call")
            name = function.get("name")
            arguments = function.get("arguments")
            if not isinstance(name, str) or not isinstance(arguments, str):
                raise RuntimeError("writer returned an invalid web tool call")
            try:
                parsed_arguments = json.loads(arguments)
            except json.JSONDecodeError as error:
                raise RuntimeError("writer returned invalid JSON tool arguments") from error
            if not isinstance(parsed_arguments, dict):
                raise RuntimeError("writer returned invalid JSON tool arguments")
            result = execute_tool(name, parsed_arguments)
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": result[:24_000],
                }
            )
        return self._stream_messages(request, messages=messages, on_delta=on_delta)

    def _stream_messages(
        self,
        request: TextGenerationRequest,
        *,
        messages: list[dict[str, Any]],
        on_delta: Callable[[str], None],
    ) -> TextGenerationResponse:
        """Read an SSE completion for either a direct or tool-assisted writer turn."""

        request_payload = {
            "model": request.model or self.default_model,
            "messages": messages,
            "temperature": request.temperature,
            "stream": True,
            **self.extra_request_fields,
        }
        output_limit = request.max_output_tokens or self.max_output_tokens
        if output_limit is not None:
            request_payload["max_tokens"] = output_limit

        text_parts: list[str] = []
        response_model = request.model or self.default_model
        usage: dict[str, int] = {}
        with httpx.stream(
            "POST",
            f"{self.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json=request_payload,
            timeout=self.timeout_seconds,
        ) as response:
            response.raise_for_status()
            for line in response.iter_lines():
                if not line or not line.startswith("data:"):
                    continue
                payload_text = line[5:].strip()
                if payload_text == "[DONE]":
                    break
                try:
                    payload = json.loads(payload_text)
                except json.JSONDecodeError:
                    continue
                if isinstance(payload.get("model"), str):
                    response_model = payload["model"]
                usage_payload = payload.get("usage")
                if isinstance(usage_payload, dict):
                    usage = {
                        "input_tokens": int(usage_payload.get("prompt_tokens", 0)),
                        "output_tokens": int(usage_payload.get("completion_tokens", 0)),
                    }
                choices = payload.get("choices")
                if not isinstance(choices, list) or not choices:
                    continue
                choice = choices[0] if isinstance(choices[0], dict) else {}
                delta = choice.get("delta")
                content = delta.get("content") if isinstance(delta, dict) else None
                if not isinstance(content, str):
                    # Some compatible providers send a complete message even
                    # when the request asked for a stream. Treat it as one
                    # visible block instead of leaving the editor empty.
                    message = choice.get("message")
                    content = message.get("content") if isinstance(message, dict) else None
                if isinstance(content, str) and content:
                    text_parts.append(content)
                    on_delta(content)
        if not text_parts:
            raise RuntimeError("model stream completed without article content")
        return TextGenerationResponse(
            text="".join(text_parts),
            provider=self.name,
            model=response_model,
            usage=usage,
        )


class OpenAICompatibleImageProvider:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        default_model: str,
        timeout_seconds: float = 120,
        trusted_image_hosts: frozenset[str] = frozenset(),
        max_download_bytes: int = 10 * 1024 * 1024,
        size_field: str = "size",
        response_format: str | None = "b64_json",
        extra_request_fields: dict[str, Any] | None = None,
    ) -> None:
        if size_field not in {"size", "image_size"}:
            raise ValueError("image size field must be 'size' or 'image_size'")
        reserved_fields = {"model", "prompt", "size", "image_size", "response_format"}
        extra_fields = dict(extra_request_fields or {})
        if reserved_fields.intersection(extra_fields):
            raise ValueError("extra image request fields cannot replace reserved fields")
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.default_model = default_model
        self.timeout_seconds = timeout_seconds
        self.trusted_image_hosts = frozenset(
            host.strip().casefold() for host in trusted_image_hosts if host.strip()
        )
        self.max_download_bytes = max_download_bytes
        self.size_field = size_field
        self.response_format = response_format
        self.extra_request_fields = extra_fields

    @property
    def name(self) -> str:
        return "openai-compatible"

    def _download_trusted_image(self, url: str) -> str:
        parsed = urlparse(url)
        if (
            parsed.scheme != "https"
            or parsed.username is not None
            or parsed.password is not None
            or parsed.hostname is None
            or parsed.hostname.casefold() not in self.trusted_image_hosts
        ):
            raise ValueError("image provider returned a URL outside the trusted host allowlist")
        if parsed.port not in {None, 443}:
            raise ValueError("image provider returned a URL with an unsupported port")

        chunks: list[bytes] = []
        received = 0
        with httpx.stream(
            "GET",
            url,
            follow_redirects=False,
            timeout=self.timeout_seconds,
        ) as response:
            response.raise_for_status()
            if response.is_redirect:
                raise ValueError("trusted image download cannot follow redirects")
            for chunk in response.iter_bytes():
                received += len(chunk)
                if received > self.max_download_bytes:
                    raise ValueError("downloaded image exceeds the provider size limit")
                chunks.append(chunk)
        return base64.b64encode(b"".join(chunks)).decode("ascii")

    def generate(self, request: ImageGenerationRequest) -> ImageGenerationResponse:
        request_payload = {
            "model": request.model or self.default_model,
            "prompt": request.prompt,
            self.size_field: request.size,
            **self.extra_request_fields,
        }
        if self.response_format is not None:
            request_payload["response_format"] = self.response_format
        response = httpx.post(
            f"{self.base_url}/images/generations",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json=request_payload,
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        items = [
            item
            for collection in (payload.get("data", []), payload.get("images", []))
            if isinstance(collection, list)
            for item in collection
            if isinstance(item, dict)
        ]
        urls = _unique_strings([str(item["url"]) for item in items if item.get("url")])
        images_base64 = _unique_strings(
            [str(item["b64_json"]) for item in items if item.get("b64_json")]
        )
        if self.trusted_image_hosts:
            images_base64.extend(self._download_trusted_image(url) for url in urls)
            images_base64 = _unique_strings(images_base64)
        return ImageGenerationResponse(
            provider=self.name,
            model=request.model or self.default_model,
            urls=urls,
            images_base64=images_base64,
        )
