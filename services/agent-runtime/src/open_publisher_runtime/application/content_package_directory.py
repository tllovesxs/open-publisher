from __future__ import annotations

import base64
import binascii
import hashlib
import json
import os
import re
import shutil
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any
from uuid import uuid4

from open_publisher_runtime.domain.contracts import (
    MAX_CONTENT_PACKAGE_ASSET_BYTES,
    MAX_CONTENT_PACKAGE_ASSETS,
    MAX_CONTENT_PACKAGE_MARKDOWN_CHARS,
    MAX_CONTENT_PACKAGE_TOTAL_ASSET_BYTES,
    ContentPackageV1,
)

IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$")
WINDOWS_RESERVED_SEGMENT = re.compile(
    r"^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)",
    re.IGNORECASE,
)
FORBIDDEN_PATH_CHARACTERS = re.compile(r'[\\<>:"|?*\x00-\x1f\x7f]')
MAX_CONTENT_PACKAGE_MANIFEST_BYTES = 2 * 1024 * 1024
MAX_CONTENT_PACKAGE_MARKDOWN_BYTES = MAX_CONTENT_PACKAGE_MARKDOWN_CHARS * 4
MAX_CONTENT_PACKAGE_DIRECTORY_BYTES = (
    MAX_CONTENT_PACKAGE_TOTAL_ASSET_BYTES + MAX_CONTENT_PACKAGE_MARKDOWN_BYTES
)


@dataclass(frozen=True)
class ContentPackageDirectoryResult:
    root: Path
    manifest: dict[str, Any]


def _portable_path(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value)
    path = PurePosixPath(normalized)
    if (
        not normalized
        or normalized != value
        or normalized.startswith("/")
        or "//" in normalized
        or FORBIDDEN_PATH_CHARACTERS.search(normalized)
        or path.is_absolute()
        or path.as_posix() != normalized
    ):
        raise ValueError(f"ContentPackage path is not portable: {value!r}")
    for segment in path.parts:
        if (
            segment in {"", ".", ".."}
            or segment.endswith((".", " "))
            or WINDOWS_RESERVED_SEGMENT.match(segment)
        ):
            raise ValueError(f"ContentPackage path is not portable: {value!r}")
    return normalized


def _identifier(value: object, *, label: str) -> str:
    candidate = str(value or "")
    if not IDENTIFIER.fullmatch(candidate):
        raise ValueError(f"{label} is not a portable ContentPackage identifier")
    return candidate


def _file_stem(identifier: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]", "_", identifier).strip(" .")
    if not stem or WINDOWS_RESERVED_SEGMENT.match(stem):
        stem = f"item-{hashlib.sha256(identifier.encode()).hexdigest()[:16]}"
    return stem[:180]


def _source_app(value: object) -> str:
    candidate = unicodedata.normalize("NFC", str(value or ""))
    if (
        not candidate.strip()
        or len(candidate) > 200
        or candidate != value
        or any(unicodedata.category(character).startswith("C") for character in candidate)
    ):
        raise ValueError("source app is not a portable ContentPackage label")
    return candidate


def _derived_identifier(prefix: str, value: str) -> str:
    candidate = f"{prefix}:{value}"
    if len(candidate) > 200:
        candidate = f"{prefix}:{hashlib.sha256(value.encode()).hexdigest()}"
    return _identifier(candidate, label=f"{prefix} identifier")


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _contract_hash(data: bytes) -> str:
    return f"sha256:{_sha256(data)}"


def _timestamp(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValueError("ContentPackage exported_at must include a timezone")
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _canonical_manifest_payload(manifest_without_hash: dict[str, Any]) -> bytes:
    normalized = {
        **manifest_without_hash,
        "entries": sorted(
            manifest_without_hash["entries"],
            key=lambda entry: unicodedata.normalize("NFC", entry["path"]),
        ),
        "platformVariantIds": sorted(manifest_without_hash["platformVariantIds"]),
    }
    # This manifest domain contains strings and integers only, so compact sorted JSON
    # is equivalent to RFC 8785 JSON Canonicalization Scheme for these values.
    return json.dumps(
        normalized,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _manifest_with_hash(manifest_without_hash: dict[str, Any]) -> dict[str, Any]:
    return {
        **manifest_without_hash,
        "packageHash": _contract_hash(_canonical_manifest_payload(manifest_without_hash)),
    }


class ContentPackageDirectoryService:
    """Materialize and verify the portable directory form used by Wandao."""

    def materialize(
        self,
        package: ContentPackageV1,
        destination: Path,
    ) -> ContentPackageDirectoryResult:
        destination = destination.resolve()
        if destination.exists():
            raise FileExistsError("ContentPackage destination must not already exist")
        destination.parent.mkdir(parents=True, exist_ok=True)

        article_id = _identifier(
            package.metadata.get("article_id") or package.package_id,
            label="article id",
        )
        revision_id = _identifier(
            package.metadata.get("revision_id") or f"revision:{package.package_id}",
            label="article revision id",
        )
        package_id = _identifier(package.package_id, label="package id")
        source_app = _source_app(package.source_app)
        article_path = _portable_path(f"articles/{_file_stem(article_id)}.md")
        article_bytes = package.article.canonical_markdown.encode("utf-8")
        if _sha256(article_bytes) != package.article.content_hash:
            raise ValueError("ContentPackage canonical Markdown hash mismatch")

        files: dict[str, bytes] = {article_path: article_bytes}
        artifact_ids: dict[str, str] = {article_path: _derived_identifier("article", revision_id)}
        total_asset_bytes = 0
        for asset in package.assets:
            path = _portable_path(asset.path)
            portable_key = path.casefold()
            if any(existing.casefold() == portable_key for existing in files):
                raise ValueError(f"duplicate ContentPackage path: {path}")
            try:
                data = base64.b64decode(asset.content_base64, validate=True)
            except (binascii.Error, ValueError) as error:
                raise ValueError(f"invalid base64 for ContentPackage asset {path}") from error
            if _sha256(data) != asset.content_hash:
                raise ValueError(f"ContentPackage asset hash mismatch: {path}")
            if len(data) > MAX_CONTENT_PACKAGE_ASSET_BYTES:
                raise ValueError(f"ContentPackage asset exceeds size limit: {path}")
            total_asset_bytes += len(data)
            if total_asset_bytes > MAX_CONTENT_PACKAGE_TOTAL_ASSET_BYTES:
                raise ValueError("ContentPackage assets exceed the total size limit")
            files[path] = data
            explicit_artifact_id = asset.metadata.get("artifact_id")
            artifact_ids[path] = (
                _identifier(explicit_artifact_id, label=f"artifact id for {path}")
                if explicit_artifact_id
                else _derived_identifier("asset", asset.content_hash)
            )

        raw_variant_ids = package.metadata.get("platform_variant_ids", [])
        if not isinstance(raw_variant_ids, list):
            raise ValueError("platform_variant_ids must be a list")
        if len(artifact_ids) != len(set(artifact_ids.values())):
            raise ValueError("ContentPackage artifact ids must be unique")

        entries = [
            {
                "artifactId": artifact_ids[path],
                "path": path,
                "mediaType": (
                    "text/markdown; charset=utf-8"
                    if path == article_path
                    else next(asset.media_type for asset in package.assets if asset.path == path)
                ),
                "contentHash": _contract_hash(data),
                "sizeBytes": len(data),
            }
            for path, data in sorted(files.items())
        ]
        manifest_without_hash = {
            "schemaVersion": "1.0",
            "id": package_id,
            "sourceApp": source_app,
            "articleRevisionId": revision_id,
            "entries": entries,
            "platformVariantIds": sorted(
                {_identifier(value, label="platform variant id") for value in raw_variant_ids}
            ),
            "createdAt": _timestamp(package.exported_at),
        }
        manifest = _manifest_with_hash(manifest_without_hash)
        manifest_bytes = (
            json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        ).encode("utf-8")

        staging = destination.parent / f".{destination.name}.staging-{uuid4().hex}"
        try:
            staging.mkdir()
            for relative_path, data in files.items():
                target = staging.joinpath(*PurePosixPath(relative_path).parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
            (staging / "manifest.json").write_bytes(manifest_bytes)
            os.replace(staging, destination)
        except Exception:
            if staging.exists():
                shutil.rmtree(staging)
            raise

        return ContentPackageDirectoryResult(root=destination, manifest=manifest)

    def verify(self, root: Path) -> dict[str, Any]:
        if root.is_symlink():
            raise ValueError("ContentPackage root cannot be a symbolic link")
        resolved_root = root.resolve(strict=True)
        manifest_path = resolved_root / "manifest.json"
        if manifest_path.is_symlink() or not manifest_path.is_file():
            raise ValueError("ContentPackage manifest.json is missing or unsafe")
        if manifest_path.stat().st_size > MAX_CONTENT_PACKAGE_MANIFEST_BYTES:
            raise ValueError("ContentPackage manifest.json exceeds the size limit")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict):
            raise ValueError("ContentPackage manifest must be an object")

        expected_fields = {
            "schemaVersion",
            "id",
            "sourceApp",
            "articleRevisionId",
            "entries",
            "platformVariantIds",
            "packageHash",
            "createdAt",
        }
        if set(manifest) != expected_fields or manifest.get("schemaVersion") != "1.0":
            raise ValueError("ContentPackage manifest fields are invalid")
        _identifier(manifest.get("id"), label="package id")
        _source_app(manifest.get("sourceApp"))
        _identifier(manifest.get("articleRevisionId"), label="article revision id")
        entries = manifest.get("entries")
        variant_ids = manifest.get("platformVariantIds")
        if not isinstance(entries, list) or not entries or not isinstance(variant_ids, list):
            raise ValueError("ContentPackage manifest entries are invalid")
        if len(entries) > MAX_CONTENT_PACKAGE_ASSETS + 1:
            raise ValueError("ContentPackage manifest contains too many entries")
        if len(variant_ids) != len(set(variant_ids)):
            raise ValueError("ContentPackage platform variant ids must be unique")
        for variant_id in variant_ids:
            _identifier(variant_id, label="platform variant id")
        created_at = manifest.get("createdAt")
        if not isinstance(created_at, str):
            raise ValueError("ContentPackage createdAt must be an RFC 3339 timestamp")
        try:
            parsed_created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        except ValueError as error:
            raise ValueError("ContentPackage createdAt must be an RFC 3339 timestamp") from error
        if parsed_created_at.tzinfo is None:
            raise ValueError("ContentPackage createdAt must include a timezone")

        without_hash = {key: value for key, value in manifest.items() if key != "packageHash"}
        expected_hash = _manifest_with_hash(without_hash)["packageHash"]
        if manifest.get("packageHash") != expected_hash:
            raise ValueError("ContentPackage manifest hash mismatch")

        seen_paths: set[str] = set()
        seen_artifact_ids: set[str] = set()
        total_entry_bytes = 0
        total_asset_bytes = 0
        total_actual_entry_bytes = 0
        total_actual_asset_bytes = 0
        for entry in entries:
            if not isinstance(entry, dict) or set(entry) != {
                "artifactId",
                "path",
                "mediaType",
                "contentHash",
                "sizeBytes",
            }:
                raise ValueError("ContentPackage entry fields are invalid")
            artifact_id = _identifier(entry["artifactId"], label="artifact id")
            if artifact_id in seen_artifact_ids:
                raise ValueError(f"duplicate ContentPackage artifact id: {artifact_id}")
            seen_artifact_ids.add(artifact_id)
            if (
                not isinstance(entry["mediaType"], str)
                or not 3 <= len(entry["mediaType"]) <= 200
                or not isinstance(entry["sizeBytes"], int)
                or isinstance(entry["sizeBytes"], bool)
                or entry["sizeBytes"] < 0
                or not isinstance(entry["contentHash"], str)
                or not re.fullmatch(r"sha256:[a-f0-9]{64}", entry["contentHash"])
            ):
                raise ValueError("ContentPackage entry metadata is invalid")
            path = _portable_path(str(entry["path"]))
            is_canonical_markdown = (
                path.startswith("articles/")
                and entry["mediaType"] == "text/markdown; charset=utf-8"
            )
            entry_size_limit = (
                MAX_CONTENT_PACKAGE_MARKDOWN_BYTES
                if is_canonical_markdown
                else MAX_CONTENT_PACKAGE_ASSET_BYTES
            )
            if entry["sizeBytes"] > entry_size_limit:
                raise ValueError("ContentPackage entry exceeds the size limit")
            total_entry_bytes += entry["sizeBytes"]
            if total_entry_bytes > MAX_CONTENT_PACKAGE_DIRECTORY_BYTES:
                raise ValueError("ContentPackage entries exceed the total size limit")
            if not is_canonical_markdown:
                total_asset_bytes += entry["sizeBytes"]
                if total_asset_bytes > MAX_CONTENT_PACKAGE_TOTAL_ASSET_BYTES:
                    raise ValueError("ContentPackage assets exceed the total size limit")
            portable_key = path.casefold()
            if portable_key in seen_paths:
                raise ValueError(f"duplicate ContentPackage path: {path}")
            seen_paths.add(portable_key)
            target = resolved_root.joinpath(*PurePosixPath(path).parts)
            if target.is_symlink() or not target.is_file():
                raise ValueError(f"ContentPackage entry is missing or unsafe: {path}")
            resolved_target = target.resolve(strict=True)
            if not resolved_target.is_relative_to(resolved_root):
                raise ValueError(f"ContentPackage entry escapes its root: {path}")
            actual_size = target.stat().st_size
            if actual_size > entry_size_limit:
                raise ValueError(f"ContentPackage entry exceeds the size limit: {path}")
            total_actual_entry_bytes += actual_size
            if total_actual_entry_bytes > MAX_CONTENT_PACKAGE_DIRECTORY_BYTES:
                raise ValueError("ContentPackage entries exceed the actual total size limit")
            if not is_canonical_markdown:
                total_actual_asset_bytes += actual_size
                if total_actual_asset_bytes > MAX_CONTENT_PACKAGE_TOTAL_ASSET_BYTES:
                    raise ValueError("ContentPackage assets exceed the actual total size limit")
            if actual_size != entry["sizeBytes"]:
                raise ValueError(f"ContentPackage entry size mismatch: {path}")
            data = target.read_bytes()
            if len(data) != actual_size or _contract_hash(data) != entry["contentHash"]:
                raise ValueError(f"ContentPackage entry hash mismatch: {path}")

        return manifest
