from __future__ import annotations

import hashlib
import json
from typing import Any

from open_publisher_runtime.application.ports import ArtifactBlobStore, RuntimeRepository
from open_publisher_runtime.domain.entities import Artifact


class ArtifactIntegrityError(RuntimeError):
    pass


class ArtifactService:
    def __init__(self, repository: RuntimeRepository, blob_store: ArtifactBlobStore) -> None:
        self.repository = repository
        self.blob_store = blob_store

    @staticmethod
    def digest(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    def put_bytes(
        self,
        *,
        kind: str,
        media_type: str,
        data: bytes,
        metadata: dict[str, Any] | None = None,
    ) -> Artifact:
        content_hash = self.digest(data)
        existing = self.repository.get_artifact_by_hash(content_hash)
        if existing:
            return existing
        storage_path = self.blob_store.put(content_hash, data)
        artifact = Artifact(
            kind=kind,
            media_type=media_type,
            content_hash=content_hash,
            size_bytes=len(data),
            storage_path=storage_path,
            metadata_json=metadata or {},
        )
        return self.repository.add_artifact(artifact)

    def put_text(
        self,
        *,
        kind: str,
        text: str,
        media_type: str = "text/plain; charset=utf-8",
        metadata: dict[str, Any] | None = None,
    ) -> Artifact:
        return self.put_bytes(
            kind=kind,
            media_type=media_type,
            data=text.encode("utf-8"),
            metadata=metadata,
        )

    def put_json(
        self,
        *,
        kind: str,
        value: Any,
        metadata: dict[str, Any] | None = None,
    ) -> Artifact:
        data = json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return self.put_bytes(
            kind=kind,
            media_type="application/json",
            data=data,
            metadata=metadata,
        )

    def read_bytes(self, artifact_id: str) -> bytes:
        artifact = self.repository.get_artifact(artifact_id)
        if artifact is None:
            raise LookupError(f"artifact {artifact_id} not found")
        data = self.blob_store.get(artifact.storage_path)
        if self.digest(data) != artifact.content_hash:
            raise ArtifactIntegrityError(f"artifact {artifact_id} failed SHA-256 verification")
        return data

    def read_text(self, artifact_id: str) -> str:
        return self.read_bytes(artifact_id).decode("utf-8")

