from __future__ import annotations

import os
import secrets
from dataclasses import dataclass
from ipaddress import ip_address
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Settings:
    data_dir: Path
    database_url: str | None = None
    artifact_dir: Path | None = None
    api_host: str = "127.0.0.1"
    api_port: int = 8765
    api_token: str | None = None

    def __post_init__(self) -> None:
        data_dir = Path(self.data_dir).resolve()
        object.__setattr__(self, "data_dir", data_dir)
        if self.database_url is None:
            database_path = (data_dir / "open-publisher.db").as_posix()
            object.__setattr__(self, "database_url", f"sqlite:///{database_path}")
        if self.artifact_dir is None:
            object.__setattr__(self, "artifact_dir", data_dir / "artifacts")
        try:
            host_is_loopback = self.api_host.casefold() == "localhost" or ip_address(
                self.api_host
            ).is_loopback
        except ValueError:
            host_is_loopback = False
        if not host_is_loopback:
            raise ValueError("agent runtime API host must be a loopback address")
        if not 0 <= self.api_port <= 65535:
            raise ValueError("agent runtime API port must be between 0 and 65535")
        token = self.api_token or secrets.token_urlsafe(32)
        if len(token) < 32:
            raise ValueError("agent runtime API token must contain at least 32 characters")
        object.__setattr__(self, "api_token", token)

    @classmethod
    def from_env(cls) -> Settings:
        default_data_dir = Path.cwd() / ".local" / "agent-runtime"
        data_dir = Path(os.getenv("OPEN_PUBLISHER_DATA_DIR", default_data_dir))
        database_url = os.getenv("OPEN_PUBLISHER_DATABASE_URL")
        artifact_dir_env = os.getenv("OPEN_PUBLISHER_ARTIFACT_DIR")
        artifact_dir = Path(artifact_dir_env) if artifact_dir_env else None
        host = os.getenv("OPEN_PUBLISHER_API_HOST", "127.0.0.1")
        port = int(os.getenv("OPEN_PUBLISHER_API_PORT", "8765"))
        token = os.getenv("OPEN_PUBLISHER_API_TOKEN")
        return cls(
            data_dir=data_dir,
            database_url=database_url,
            artifact_dir=artifact_dir,
            api_host=host,
            api_port=port,
            api_token=token,
        )

    def ensure_directories(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        assert self.artifact_dir is not None
        self.artifact_dir.mkdir(parents=True, exist_ok=True)
