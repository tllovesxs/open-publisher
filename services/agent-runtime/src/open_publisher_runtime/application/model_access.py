from __future__ import annotations

from collections.abc import Callable
from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, Field


class TextGenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    purpose: str
    prompt: str
    model: str | None = None
    context: dict[str, Any] = Field(default_factory=dict)
    temperature: float = Field(default=0.2, ge=0, le=2)
    max_output_tokens: int | None = Field(default=None, ge=1, le=32_768)


class TextGenerationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str
    provider: str
    model: str
    usage: dict[str, int] = Field(default_factory=dict)
    mocked: bool = False


class ImageGenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str
    model: str | None = None
    size: str = "1024x1024"


class ImageGenerationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: str
    model: str
    urls: list[str] = Field(default_factory=list)
    images_base64: list[str] = Field(default_factory=list)
    mocked: bool = False


class TextProvider(Protocol):
    @property
    def name(self) -> str: ...

    def generate(self, request: TextGenerationRequest) -> TextGenerationResponse: ...


class StreamingTextProvider(Protocol):
    def generate_stream(
        self,
        request: TextGenerationRequest,
        on_delta: Callable[[str], None],
    ) -> TextGenerationResponse: ...


class ImageProvider(Protocol):
    @property
    def name(self) -> str: ...

    def generate(self, request: ImageGenerationRequest) -> ImageGenerationResponse: ...


class SecretResolver(Protocol):
    def resolve(self, secret_ref: str) -> str: ...


class ModelAccessLayer:
    """In-process model gateway; it is not a network proxy."""

    def __init__(
        self,
        *,
        text_provider: TextProvider,
        image_provider: ImageProvider,
    ) -> None:
        self.text_provider = text_provider
        self.image_provider = image_provider

    def generate_text(self, request: TextGenerationRequest) -> TextGenerationResponse:
        return self.text_provider.generate(request)

    def generate_text_stream(
        self,
        request: TextGenerationRequest,
        on_delta: Callable[[str], None],
    ) -> TextGenerationResponse:
        """Use provider SSE when available; preserve a deterministic fallback."""

        stream = getattr(self.text_provider, "generate_stream", None)
        if callable(stream):
            return stream(request, on_delta)
        response = self.generate_text(request)
        if response.text:
            on_delta(response.text)
        return response

    def generate_image(self, request: ImageGenerationRequest) -> ImageGenerationResponse:
        return self.image_provider.generate(request)
