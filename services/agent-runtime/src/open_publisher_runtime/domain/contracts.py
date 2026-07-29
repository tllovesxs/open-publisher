from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from open_publisher_runtime.domain.entities import new_id, utc_now


class ContentPackageArticleV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    revision_number: int = Field(ge=1)
    canonical_markdown: str
    content_hash: str


class ContentPackageAssetV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str
    kind: str
    media_type: str
    content_base64: str
    content_hash: str
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("path")
    @classmethod
    def validate_relative_path(cls, value: str) -> str:
        normalized = value.replace("\\", "/")
        if normalized.startswith("/") or ".." in normalized.split("/"):
            raise ValueError("asset path must be relative and cannot traverse directories")
        return normalized


class ContentPackageV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["content-package.v1"] = "content-package.v1"
    package_id: str = Field(default_factory=new_id)
    source_app: str = "open-publisher"
    exported_at: datetime = Field(default_factory=utc_now)
    article: ContentPackageArticleV1
    assets: list[ContentPackageAssetV1] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)

