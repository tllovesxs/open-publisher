from __future__ import annotations

import os
import tempfile
from pathlib import Path


class FileSystemArtifactStore:
    """Content-addressed, atomic local blob storage."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _relative_path(self, content_hash: str) -> Path:
        if len(content_hash) != 64 or any(c not in "0123456789abcdef" for c in content_hash):
            raise ValueError("content_hash must be a lowercase SHA-256 digest")
        return Path("sha256") / content_hash[:2] / content_hash[2:4] / content_hash

    def _absolute_path(self, storage_path: str | Path) -> Path:
        path = (self.root / storage_path).resolve()
        if path != self.root and self.root not in path.parents:
            raise ValueError("artifact path escaped the configured root")
        return path

    def put(self, content_hash: str, data: bytes) -> str:
        relative_path = self._relative_path(content_hash)
        destination = self._absolute_path(relative_path)
        if destination.exists():
            return relative_path.as_posix()

        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary_name: str | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="wb",
                dir=destination.parent,
                prefix=f".{content_hash}.",
                delete=False,
            ) as temporary:
                temporary.write(data)
                temporary.flush()
                os.fsync(temporary.fileno())
                temporary_name = temporary.name
            os.replace(temporary_name, destination)
        finally:
            if temporary_name and os.path.exists(temporary_name):
                os.unlink(temporary_name)
        return relative_path.as_posix()

    def get(self, storage_path: str) -> bytes:
        return self._absolute_path(storage_path).read_bytes()

    def exists(self, storage_path: str) -> bool:
        return self._absolute_path(storage_path).is_file()

