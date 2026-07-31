from __future__ import annotations

import base64
import binascii
import hashlib
from dataclasses import dataclass

from open_publisher_runtime.application.artifacts import ArtifactService
from open_publisher_runtime.application.model_access import (
    ImageGenerationRequest,
    ModelAccessLayer,
)
from open_publisher_runtime.domain.entities import Artifact

SUPPORTED_IMAGE_SIZES = frozenset(
    {
        "512x512",
        "768x768",
        "1024x1024",
        "1024x1536",
        "1536x1024",
    }
)
MAX_GENERATED_IMAGES = 4
MAX_IMAGE_PROMPT_CHARS = 4000
MAX_IMAGE_MODEL_CHARS = 200
MAX_GENERATED_IMAGE_BYTES = 10 * 1024 * 1024
MAX_GENERATED_TOTAL_BYTES = 30 * 1024 * 1024
MAX_GENERATED_IMAGE_BASE64_CHARS = ((MAX_GENERATED_IMAGE_BYTES + 2) // 3) * 4


@dataclass(frozen=True, slots=True)
class StoredImageGeneration:
    provider: str
    model: str
    mocked: bool
    artifacts: list[Artifact]
    remote_urls_ignored: int


class ImageGenerationService:
    def __init__(
        self,
        *,
        model_access: ModelAccessLayer,
        artifact_service: ArtifactService,
    ) -> None:
        self.model_access = model_access
        self.artifact_service = artifact_service

    @staticmethod
    def _detect_media_type(data: bytes) -> str:
        if data.startswith(b"\x89PNG\r\n\x1a\n"):
            return "image/png"
        if data.startswith(b"\xff\xd8\xff"):
            return "image/jpeg"
        if data.startswith((b"GIF87a", b"GIF89a")):
            return "image/gif"
        if len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
            return "image/webp"
        if len(data) >= 12 and data[4:8] == b"ftyp" and data[8:12] in {
            b"avif",
            b"avis",
        }:
            return "image/avif"
        raise ValueError("image provider returned an unsupported or untrusted image format")

    def generate(
        self,
        *,
        prompt: str,
        size: str,
        model: str | None = None,
    ) -> StoredImageGeneration:
        normalized_prompt = prompt.strip()
        if not normalized_prompt:
            raise ValueError("image prompt cannot be blank")
        if len(normalized_prompt) > MAX_IMAGE_PROMPT_CHARS:
            raise ValueError("image prompt exceeds the length limit")
        if model is not None and not 1 <= len(model.strip()) <= MAX_IMAGE_MODEL_CHARS:
            raise ValueError("image model name is blank or exceeds the length limit")
        if size not in SUPPORTED_IMAGE_SIZES:
            raise ValueError(f"unsupported image size: {size}")

        response = self.model_access.generate_image(
            ImageGenerationRequest(
                prompt=normalized_prompt,
                model=model.strip() if model else None,
                size=size,
            )
        )
        encoded_images = response.images_base64
        if len(encoded_images) > MAX_GENERATED_IMAGES:
            raise ValueError("image provider returned too many images")
        if not encoded_images and not response.urls:
            raise ValueError("image provider returned no image output")

        decoded_images: list[tuple[str, bytes]] = []
        total_bytes = 0
        for index, encoded in enumerate(encoded_images):
            if len(encoded) > MAX_GENERATED_IMAGE_BASE64_CHARS:
                raise ValueError(f"generated image {index} exceeds the encoded size limit")
            try:
                data = base64.b64decode(encoded, validate=True)
            except (binascii.Error, ValueError) as error:
                raise ValueError(f"generated image {index} is not valid base64") from error
            if len(data) > MAX_GENERATED_IMAGE_BYTES:
                raise ValueError(f"generated image {index} exceeds the decoded size limit")
            total_bytes += len(data)
            if total_bytes > MAX_GENERATED_TOTAL_BYTES:
                raise ValueError("generated images exceed the total decoded size limit")
            decoded_images.append(
                (
                    self._detect_media_type(data),
                    data,
                )
            )

        # Decode and validate every provider output before writing the first artifact.
        prompt_hash = hashlib.sha256(normalized_prompt.encode("utf-8")).hexdigest()
        artifacts = [
            self.artifact_service.put_bytes(
                kind="image.generated",
                media_type=media_type,
                data=data,
                metadata={
                    "provider": response.provider,
                    "model": response.model,
                    "mocked": response.mocked,
                    "prompt_hash": prompt_hash,
                    "requested_size": size,
                },
            )
            for media_type, data in decoded_images
        ]
        return StoredImageGeneration(
            provider=response.provider,
            model=response.model,
            mocked=response.mocked,
            artifacts=artifacts,
            remote_urls_ignored=len(response.urls),
        )
