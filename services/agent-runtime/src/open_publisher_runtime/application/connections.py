from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from open_publisher_runtime.application.ports import RuntimeRepository
from open_publisher_runtime.domain.entities import ConnectionProfile

ALLOWED_SECRET_SCHEMES = {"env", "keyring", "mock", "stronghold"}
FORBIDDEN_CONFIG_KEYS = {
    "api_key",
    "apikey",
    "authorization",
    "cookie",
    "password",
    "secret",
    "token",
}


class ConnectionService:
    def __init__(self, repository: RuntimeRepository) -> None:
        self.repository = repository

    def create(
        self,
        *,
        name: str,
        provider: str,
        secret_ref: str,
        base_url: str | None,
        config: dict[str, Any],
    ) -> ConnectionProfile:
        parsed = urlparse(secret_ref)
        if parsed.scheme not in ALLOWED_SECRET_SCHEMES:
            raise ValueError(
                "secret_ref must use stronghold://, keyring://, env://, or mock://"
            )
        leaked_keys = {key.lower() for key in config} & FORBIDDEN_CONFIG_KEYS
        if leaked_keys:
            raise ValueError("connection config cannot contain plaintext credential fields")
        profile = ConnectionProfile(
            name=name.strip(),
            provider=provider.strip().lower(),
            secret_ref=secret_ref,
            base_url=base_url,
            config_json=config,
        )
        return self.repository.add_connection(profile)

