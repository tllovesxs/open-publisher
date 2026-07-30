from __future__ import annotations

import re
from ipaddress import ip_address
from typing import Any
from urllib.parse import parse_qsl, urlparse

from open_publisher_runtime.application.ports import RuntimeRepository
from open_publisher_runtime.domain.entities import ConnectionProfile

ALLOWED_SECRET_SCHEMES = {"env", "keyring", "mock", "stronghold"}
FORBIDDEN_NORMALIZED_KEYS = {
    "apikey",
    "accesstoken",
    "authorization",
    "clientsecret",
    "cookie",
    "credential",
    "credentials",
    "privatekey",
    "password",
    "refreshtoken",
    "secret",
    "secretref",
    "setcookie",
    "token",
}
AUTHORIZATION_VALUE = re.compile(r"^\s*(?:bearer|basic)\s+\S+", re.IGNORECASE)
ENV_REFERENCE_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
LIKELY_SECRET_VALUE = re.compile(
    r"(?:"
    r"\bsk-[A-Za-z0-9_-]{16,}\b"
    r"|\bAKIA[0-9A-Z]{16}\b"
    r"|\bgh[pousr]_[A-Za-z0-9]{24,}\b"
    r"|\bxox[baprs]-[A-Za-z0-9-]{16,}\b"
    r"|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"
    r"|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"
    r")",
    re.IGNORECASE,
)


def _normalized_key(value: object) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value).casefold())


def _is_sensitive_key(value: object) -> bool:
    normalized = _normalized_key(value)
    return normalized in FORBIDDEN_NORMALIZED_KEYS or normalized.endswith(
        (
            "accesstoken",
            "apikey",
            "authorization",
            "clientsecret",
            "cookie",
            "credential",
            "credentials",
            "password",
            "privatekey",
            "refreshtoken",
            "secretkey",
            "token",
        )
    )


def _validate_public_config(value: Any, *, path: str = "config") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if _is_sensitive_key(key):
                raise ValueError(f"connection {path}.{key} cannot contain credential material")
            _validate_public_config(child, path=f"{path}.{key}")
        return
    if isinstance(value, list):
        for index, child in enumerate(value):
            _validate_public_config(child, path=f"{path}[{index}]")
        return
    if isinstance(value, str):
        if AUTHORIZATION_VALUE.match(value):
            raise ValueError(f"connection {path} cannot contain an authorization value")
        if LIKELY_SECRET_VALUE.search(value):
            raise ValueError(f"connection {path} appears to contain credential material")


def _validate_secret_ref(secret_ref: str) -> str:
    parsed = urlparse(secret_ref)
    if parsed.scheme not in ALLOWED_SECRET_SCHEMES:
        raise ValueError("secret_ref must use stronghold://, keyring://, env://, or mock://")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("secret_ref cannot contain userinfo, query parameters, or fragments")
    reference_name = (parsed.netloc + parsed.path).strip("/")
    if not reference_name:
        raise ValueError("secret_ref must identify a secret broker entry")
    if "\\" in reference_name or ".." in reference_name.split("/"):
        raise ValueError("secret_ref cannot traverse secret broker paths")
    if parsed.scheme == "env" and not ENV_REFERENCE_NAME.fullmatch(reference_name):
        raise ValueError("env:// secret_ref must contain a valid environment variable name")
    return secret_ref


def _validate_base_url(base_url: str | None) -> str | None:
    if base_url is None:
        return None
    parsed = urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("base_url must be an absolute http(s) URL")
    if parsed.scheme == "http":
        try:
            host_is_loopback = parsed.hostname.casefold() == "localhost" or ip_address(
                parsed.hostname
            ).is_loopback
        except ValueError:
            host_is_loopback = False
        if not host_is_loopback:
            raise ValueError("base_url must use HTTPS except for literal loopback hosts")
    if parsed.username or parsed.password:
        raise ValueError("base_url cannot contain username or password")
    if parsed.fragment:
        raise ValueError("base_url cannot contain a fragment")
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        if _is_sensitive_key(key):
            raise ValueError("base_url query cannot contain credential parameters")
        if AUTHORIZATION_VALUE.match(value):
            raise ValueError("base_url query cannot contain authorization values")
    return base_url.rstrip("/")


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
        normalized_name = name.strip()
        normalized_provider = provider.strip().lower()
        if not normalized_name or not normalized_provider:
            raise ValueError("connection name and provider cannot be blank")
        _validate_public_config(config)
        profile = ConnectionProfile(
            name=normalized_name,
            provider=normalized_provider,
            secret_ref=_validate_secret_ref(secret_ref),
            base_url=_validate_base_url(base_url),
            config_json=config,
        )
        return self.repository.add_connection(profile)
