from __future__ import annotations

from datetime import datetime
from pathlib import PurePosixPath
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from open_publisher_runtime.domain.entities import new_id, utc_now

MAX_CONTENT_PACKAGE_ASSETS = 64
MAX_CONTENT_PACKAGE_MARKDOWN_CHARS = 2_000_000
MAX_CONTENT_PACKAGE_ASSET_BYTES = 20 * 1024 * 1024
MAX_CONTENT_PACKAGE_TOTAL_ASSET_BYTES = 100 * 1024 * 1024
MAX_CONTENT_PACKAGE_ASSET_BASE64_CHARS = ((MAX_CONTENT_PACKAGE_ASSET_BYTES + 2) // 3) * 4
SHA256_PATTERN = r"^[0-9a-f]{64}$"


class ContentPackageArticleV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=500)
    revision_number: int = Field(ge=1)
    canonical_markdown: str = Field(min_length=1, max_length=MAX_CONTENT_PACKAGE_MARKDOWN_CHARS)
    content_hash: str = Field(pattern=SHA256_PATTERN)

    @field_validator("title", "canonical_markdown")
    @classmethod
    def validate_non_blank_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("ContentPackage article text cannot be blank")
        return value


class ContentPackageAssetV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=1, max_length=512)
    kind: str = Field(min_length=1, max_length=100)
    media_type: str = Field(min_length=1, max_length=200)
    content_base64: str = Field(max_length=MAX_CONTENT_PACKAGE_ASSET_BASE64_CHARS)
    content_hash: str = Field(pattern=SHA256_PATTERN)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("path")
    @classmethod
    def validate_relative_path(cls, value: str) -> str:
        lowered = value.casefold()
        if (
            "\\" in value
            or "\x00" in value
            or any(encoded in lowered for encoded in ("%2e", "%2f", "%5c"))
        ):
            raise ValueError("asset path must use safe POSIX separators")
        path = PurePosixPath(value)
        parts = path.parts
        if (
            not parts
            or path.is_absolute()
            or value != path.as_posix()
            or any(part in {"", ".", ".."} for part in parts)
            or ":" in parts[0]
        ):
            raise ValueError("asset path must be a normalized relative POSIX path")
        return value


class ContentPackageV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["content-package.v1"] = "content-package.v1"
    package_id: str = Field(default_factory=new_id, min_length=1, max_length=200)
    source_app: str = Field(default="open-publisher", min_length=1, max_length=200)
    exported_at: datetime = Field(default_factory=utc_now)
    article: ContentPackageArticleV1
    assets: list[ContentPackageAssetV1] = Field(
        default_factory=list,
        max_length=MAX_CONTENT_PACKAGE_ASSETS,
    )
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_unique_asset_paths(self) -> Self:
        paths = [asset.path for asset in self.assets]
        if len(paths) != len(set(paths)):
            raise ValueError("ContentPackage asset paths must be unique")
        return self
