from __future__ import annotations

import base64
import os
from urllib.parse import urlparse

import httpx

from open_publisher_runtime.application.model_access import (
    ImageGenerationRequest,
    ImageGenerationResponse,
    TextGenerationRequest,
    TextGenerationResponse,
)


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


class MockTextProvider:
    @property
    def name(self) -> str:
        return "mock"

    def generate(self, request: TextGenerationRequest) -> TextGenerationResponse:
        title = str(request.context.get("title") or "未命名文章").strip()
        source = str(request.context.get("source_markdown") or "").strip()
        topic = str(request.context.get("topic") or title).strip()

        if request.purpose == "outline":
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
        elif request.purpose == "review":
            text = (
                "## 审核结果\n\n"
                "- 结构：通过\n"
                "- 事实：当前为演示内容，无外部事实声明\n"
                "- 合规：未发现演示规则中的硬错误\n"
                "- 建议：正式发布前由用户确认平台预览"
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
        safe_prompt = request.prompt.replace("<", "&lt;").replace(">", "&gt;")[:120]
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">'
            '<rect width="100%" height="100%" fill="#172033"/>'
            '<text x="64" y="512" fill="#ffffff" font-size="32">'
            f"{safe_prompt}</text></svg>"
        )
        return ImageGenerationResponse(
            provider=self.name,
            model=request.model or "deterministic-svg-v1",
            images_base64=[base64.b64encode(svg.encode()).decode("ascii")],
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
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.default_model = default_model
        self.timeout_seconds = timeout_seconds

    @property
    def name(self) -> str:
        return "openai-compatible"

    def generate(self, request: TextGenerationRequest) -> TextGenerationResponse:
        response = httpx.post(
            f"{self.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={
                "model": request.model or self.default_model,
                "messages": [{"role": "user", "content": request.prompt}],
                "temperature": request.temperature,
            },
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


class OpenAICompatibleImageProvider:
    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        default_model: str,
        timeout_seconds: float = 120,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.default_model = default_model
        self.timeout_seconds = timeout_seconds

    @property
    def name(self) -> str:
        return "openai-compatible"

    def generate(self, request: ImageGenerationRequest) -> ImageGenerationResponse:
        response = httpx.post(
            f"{self.base_url}/images/generations",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={
                "model": request.model or self.default_model,
                "prompt": request.prompt,
                "size": request.size,
                "response_format": "b64_json",
            },
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        return ImageGenerationResponse(
            provider=self.name,
            model=request.model or self.default_model,
            urls=[item["url"] for item in payload.get("data", []) if item.get("url")],
            images_base64=[
                item["b64_json"] for item in payload.get("data", []) if item.get("b64_json")
            ],
        )

