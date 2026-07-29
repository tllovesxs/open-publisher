from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Settings:
    data_dir: Path
    database_url: str | None = None
    artifact_dir: Path | None = None
    api_host: str = "127.0.0.1"
    api_port: int = 8765

    def __post_init__(self) -> None:
        data_dir = Path(self.data_dir).resolve()
        object.__setattr__(self, "data_dir", data_dir)
        if self.database_url is None:
            database_path = (data_dir / "open-publisher.db").as_posix()
            object.__setattr__(self, "database_url", f"sqlite:///{database_path}")
        if self.artifact_dir is None:
            object.__setattr__(self, "artifact_dir", data_dir / "artifacts")

    @classmethod
    def from_env(cls) -> Settings:
        default_data_dir = Path.cwd() / ".local" / "agent-runtime"
        data_dir = Path(os.getenv("OPEN_PUBLISHER_DATA_DIR", default_data_dir))
        database_url = os.getenv("OPEN_PUBLISHER_DATABASE_URL")
        artifact_dir_env = os.getenv("OPEN_PUBLISHER_ARTIFACT_DIR")
        artifact_dir = Path(artifact_dir_env) if artifact_dir_env else None
        host = os.getenv("OPEN_PUBLISHER_API_HOST", "127.0.0.1")
        port = int(os.getenv("OPEN_PUBLISHER_API_PORT", "8765"))
        return cls(
            data_dir=data_dir,
            database_url=database_url,
            artifact_dir=artifact_dir,
            api_host=host,
            api_port=port,
        )

    def ensure_directories(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        assert self.artifact_dir is not None
        self.artifact_dir.mkdir(parents=True, exist_ok=True)

