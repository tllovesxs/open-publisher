from __future__ import annotations

import re
import secrets
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from pathlib import PurePosixPath
from typing import Annotated, Literal, Self
from uuid import uuid4

from pydantic import (
    AnyHttpUrl,
    BaseModel,
    ConfigDict,
    Field,
    field_serializer,
    field_validator,
    model_validator,
)

# Adapter IDs are discovered from the locally connected WechatSync extension.
# Keep the value constrained for path and protocol safety without maintaining a
# stale, product-specific allowlist in the Python runtime.
PlatformName = Annotated[
    str,
    Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9_-]{0,63}$"),
]
BrowserBodyFormat = Literal["markdown", "plain"]

MAX_BROWSER_TASK_TTL_SECONDS = 10 * 60
DEFAULT_BROWSER_TASK_TTL_SECONDS = 5 * 60
PAIRING_NONCE_PATTERN = r"^[A-Za-z0-9_-]{32,128}$"


class CapabilityState(StrEnum):
    AVAILABLE = "available"
    UNKNOWN = "unknown"
    NEEDS_CONFIGURATION = "needs_configuration"
    NEEDS_USER = "needs_user"
    UNAVAILABLE = "unavailable"
    UNSUPPORTED = "unsupported"


class AdapterRoute(StrEnum):
    OFFICIAL_API = "official_api"
    BROWSER_EXTENSION = "browser_extension"
    MANUAL_EXPORT = "manual_export"


class CapabilityName(StrEnum):
    CREATE_DRAFT = "create_draft"
    UPLOAD_MEDIA = "upload_media"
    FILL_BROWSER_DRAFT = "fill_browser_draft"
    MANUAL_EXPORT = "manual_export"


class CapabilityDetail(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    capability: CapabilityName
    state: CapabilityState
    reason: str = Field(min_length=1, max_length=500)


class CapabilityReport(BaseModel):
    """A local capability judgement. It is never evidence of a remote write."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    platform: PlatformName
    route: AdapterRoute
    state: CapabilityState
    reason: str = Field(min_length=1, max_length=1000)
    capabilities: tuple[CapabilityDetail, ...] = ()
    network_probe_performed: Literal[False] = False
    remote_write_performed: Literal[False] = False


class WeChatOfficialApiProbeInput(BaseModel):
    """Only opaque configuration references and user-attested capability flags."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    app_id: str | None = Field(default=None, min_length=3, max_length=128)
    secret_ref: str | None = Field(
        default=None,
        pattern=(
            r"^(?:stronghold|keyring|env|mock)://"
            r"[A-Za-z0-9_][A-Za-z0-9._:/-]{0,499}$"
        ),
    )
    account_verified: bool = False
    draft_api_enabled: bool | None = None
    media_upload_enabled: bool | None = None


_UNSAFE_WECHAT_HTML = re.compile(
    r"(?:<\s*(?:script|iframe|object|embed)\b|javascript\s*:|data\s*:\s*text/html|"
    r"(?:\s|/)on[a-z]+\s*=)",
    re.IGNORECASE,
)


class WeChatDraftArticle(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True, frozen=True)

    title: str = Field(min_length=1, max_length=64)
    content_html: str = Field(alias="content", min_length=1, max_length=2_000_000)
    thumb_media_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,256}$")
    author: str | None = Field(default=None, max_length=32)
    digest: str | None = Field(default=None, max_length=120)
    content_source_url: AnyHttpUrl | None = None
    need_open_comment: Literal[0, 1] = 0
    only_fans_can_comment: Literal[0, 1] = 0

    @field_validator("title", "content_html")
    @classmethod
    def reject_blank_or_active_content(cls, value: str, info: object) -> str:
        if not value.strip():
            raise ValueError("WeChat draft text cannot be blank")
        if getattr(info, "field_name", None) == "content_html" and _UNSAFE_WECHAT_HTML.search(
            value
        ):
            raise ValueError("WeChat draft HTML contains active content")
        return value

    @field_validator("content_source_url")
    @classmethod
    def require_https_source_url(cls, value: AnyHttpUrl | None) -> AnyHttpUrl | None:
        if value is not None and value.scheme != "https":
            raise ValueError("WeChat source URL must use HTTPS")
        return value


class WeChatDraftPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    articles: tuple[WeChatDraftArticle, ...] = Field(min_length=1, max_length=8)

    def to_api_payload(self) -> dict[str, object]:
        """Return body data only; authentication never belongs in the payload."""

        return self.model_dump(mode="json", by_alias=True, exclude_none=True)


class WeChatOfficialApiAdapter:
    """Offline-only WeChat API preparation; this class has no transport dependency."""

    @staticmethod
    def probe(inputs: WeChatOfficialApiProbeInput) -> CapabilityReport:
        missing: list[str] = []
        if inputs.app_id is None:
            missing.append("app_id")
        if inputs.secret_ref is None:
            missing.append("secret_ref")
        media_state = (
            CapabilityState.UNKNOWN
            if inputs.media_upload_enabled is None
            else (
                CapabilityState.AVAILABLE
                if inputs.media_upload_enabled
                else CapabilityState.UNAVAILABLE
            )
        )

        if missing:
            state = CapabilityState.NEEDS_CONFIGURATION
            reason = f"WeChat official API requires configured {', '.join(missing)}."
        elif not inputs.account_verified:
            state = CapabilityState.NEEDS_USER
            reason = "Confirm that the WeChat account is verified and owned by the user."
        elif inputs.draft_api_enabled is None:
            state = CapabilityState.UNKNOWN
            reason = "Draft API access has not been attested; no network probe was attempted."
        elif not inputs.draft_api_enabled:
            state = CapabilityState.UNAVAILABLE
            reason = "The configured account reports that the WeChat draft API is unavailable."
        else:
            state = CapabilityState.AVAILABLE
            reason = "Local configuration attests WeChat draft API access; no request was sent."

        return CapabilityReport(
            platform="wechat",
            route=AdapterRoute.OFFICIAL_API,
            state=state,
            reason=reason,
            capabilities=(
                CapabilityDetail(
                    capability=CapabilityName.CREATE_DRAFT,
                    state=state,
                    reason=reason,
                ),
                CapabilityDetail(
                    capability=CapabilityName.UPLOAD_MEDIA,
                    state=media_state,
                    reason="Media upload capability is based only on local configuration.",
                ),
            ),
        )

    @staticmethod
    def build_draft_payload(*articles: WeChatDraftArticle) -> WeChatDraftPayload:
        return WeChatDraftPayload(articles=articles)


class BrowserDraftBody(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    format: BrowserBodyFormat
    content: str = Field(min_length=1, max_length=1_000_000)

    @field_validator("content")
    @classmethod
    def reject_blank_body(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Browser draft body cannot be blank")
        return value


class BrowserDraftArticle(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    title: str = Field(min_length=1, max_length=500)
    body: BrowserDraftBody
    summary: str | None = Field(default=None, max_length=4000)
    tags: tuple[str, ...] = Field(default=(), max_length=100)

    @field_validator("title")
    @classmethod
    def reject_blank_title(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Browser draft title cannot be blank")
        return value

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        if len(values) != len(set(values)):
            raise ValueError("Browser draft tags must be unique")
        if any(not value or len(value) > 100 for value in values):
            raise ValueError("Browser draft tags must contain 1-100 characters")
        return values


class BrowserDraftSafety(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    final_publish: Literal[False] = Field(default=False, alias="finalPublish")
    requires_user_review: Literal[True] = Field(default=True, alias="requiresUserReview")


class BrowserDraftTask(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        populate_by_name=True,
        serialize_by_alias=True,
    )

    schema_version: Literal["1.0"] = Field(default="1.0", alias="schemaVersion")
    task_id: str = Field(
        alias="taskId",
        pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$",
    )
    nonce: str = Field(pattern=PAIRING_NONCE_PATTERN)
    expires_at: datetime = Field(alias="expiresAt")
    platform: PlatformName
    action: Literal["FILL_DRAFT"] = "FILL_DRAFT"
    expected_dom_version: str | None = Field(
        default=None,
        alias="expectedDomVersion",
        min_length=1,
        max_length=100,
    )
    article: BrowserDraftArticle
    safety: BrowserDraftSafety = Field(default_factory=BrowserDraftSafety)

    @field_validator("expires_at")
    @classmethod
    def validate_expiry(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("Browser task expiry must be timezone-aware")
        expires_at = value.astimezone(UTC)
        now = datetime.now(UTC)
        if expires_at <= now:
            raise ValueError("Browser task has expired")
        if expires_at > now + timedelta(seconds=MAX_BROWSER_TASK_TTL_SECONDS):
            raise ValueError("Browser task expiry exceeds ten minutes")
        return expires_at

    @field_serializer("expires_at", when_used="json")
    def serialize_expiry(self, value: datetime) -> str:
        return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    def to_wire(self) -> dict[str, object]:
        return self.model_dump(mode="json", by_alias=True, exclude_none=True)


class BrowserDraftTaskFactory:
    @staticmethod
    def create(
        *,
        platform: PlatformName,
        title: str,
        content: str,
        body_format: BrowserBodyFormat = "markdown",
        nonce: str | None = None,
        ttl_seconds: int = DEFAULT_BROWSER_TASK_TTL_SECONDS,
        summary: str | None = None,
        tags: Sequence[str] = (),
        expected_dom_version: str | None = None,
    ) -> BrowserDraftTask:
        if not 1 <= ttl_seconds <= MAX_BROWSER_TASK_TTL_SECONDS:
            raise ValueError("Browser task TTL must be between 1 and 600 seconds")
        return BrowserDraftTask(
            task_id=f"draft:{uuid4()}",
            nonce=nonce or secrets.token_urlsafe(32),
            expires_at=datetime.now(UTC) + timedelta(seconds=ttl_seconds),
            platform=platform,
            expected_dom_version=expected_dom_version,
            article=BrowserDraftArticle(
                title=title,
                body=BrowserDraftBody(format=body_format, content=content),
                summary=summary,
                tags=tuple(tags),
            ),
        )


def browser_extension_capability(
    platform: PlatformName,
    *,
    installed: bool,
    paired: bool,
    editor_supported: bool = True,
) -> CapabilityReport:
    if not installed:
        state = CapabilityState.NEEDS_CONFIGURATION
        reason = "Install and enable the reviewed browser extension."
    elif not paired:
        state = CapabilityState.NEEDS_USER
        reason = "Pair the browser extension with a short-lived nonce."
    elif not editor_supported:
        state = CapabilityState.UNAVAILABLE
        reason = "The current platform editor DOM version is unsupported."
    else:
        state = CapabilityState.AVAILABLE
        reason = "The paired extension can fill a draft; the user must review it."
    return CapabilityReport(
        platform=platform,
        route=AdapterRoute.BROWSER_EXTENSION,
        state=state,
        reason=reason,
        capabilities=(
            CapabilityDetail(
                capability=CapabilityName.FILL_BROWSER_DRAFT,
                state=state,
                reason=reason,
            ),
        ),
    )


def unsupported_official_api_capability(platform: PlatformName) -> CapabilityReport:
    return CapabilityReport(
        platform=platform,
        route=AdapterRoute.OFFICIAL_API,
        state=CapabilityState.UNSUPPORTED,
        reason=f"No reviewed official API adapter is available for {platform}.",
        capabilities=(
            CapabilityDetail(
                capability=CapabilityName.CREATE_DRAFT,
                state=CapabilityState.UNSUPPORTED,
                reason="The official API route is not implemented for this platform.",
            ),
        ),
    )


def manual_export_capability(platform: PlatformName) -> CapabilityReport:
    reason = "A local Markdown and asset export can be prepared without remote access."
    return CapabilityReport(
        platform=platform,
        route=AdapterRoute.MANUAL_EXPORT,
        state=CapabilityState.AVAILABLE,
        reason=reason,
        capabilities=(
            CapabilityDetail(
                capability=CapabilityName.MANUAL_EXPORT,
                state=CapabilityState.AVAILABLE,
                reason=reason,
            ),
        ),
    )


class RouteSelection(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    platform: PlatformName
    primary_route: AdapterRoute | None
    selected_route: AdapterRoute | None
    state: CapabilityState
    reason: str = Field(min_length=1, max_length=1000)
    available_fallbacks: tuple[AdapterRoute, ...] = ()
    requires_explicit_fallback: bool = False
    fallback_from: AdapterRoute | None = None
    explicit_fallback_used: bool = False


class PlatformAdapterSelector:
    ROUTE_PRIORITY = (
        AdapterRoute.OFFICIAL_API,
        AdapterRoute.BROWSER_EXTENSION,
        AdapterRoute.MANUAL_EXPORT,
    )

    @classmethod
    def select(
        cls,
        *,
        platform: PlatformName,
        reports: Sequence[CapabilityReport],
        requested_route: AdapterRoute | None = None,
        explicit_fallback_route: AdapterRoute | None = None,
    ) -> RouteSelection:
        report_by_route: dict[AdapterRoute, CapabilityReport] = {}
        for report in reports:
            if report.platform != platform:
                raise ValueError("Capability reports must match the selected platform")
            if report.route in report_by_route:
                raise ValueError(f"Duplicate capability report for {report.route}")
            report_by_route[report.route] = report

        applicable_routes = [
            route
            for route in cls.ROUTE_PRIORITY
            if (report := report_by_route.get(route)) is not None
            and report.state is not CapabilityState.UNSUPPORTED
        ]
        primary_route = requested_route or (applicable_routes[0] if applicable_routes else None)
        if primary_route is None:
            return RouteSelection(
                platform=platform,
                primary_route=None,
                selected_route=None,
                state=CapabilityState.UNSUPPORTED,
                reason="No platform route has a reviewed capability report.",
            )

        primary_report = report_by_route.get(primary_route)
        if primary_report is None:
            return RouteSelection(
                platform=platform,
                primary_route=primary_route,
                selected_route=None,
                state=CapabilityState.UNSUPPORTED,
                reason=f"The requested route {primary_route} has no capability report.",
            )

        primary_index = cls.ROUTE_PRIORITY.index(primary_route)
        available_fallbacks = tuple(
            route
            for route in cls.ROUTE_PRIORITY[primary_index + 1 :]
            if (report := report_by_route.get(route)) is not None
            and report.state is CapabilityState.AVAILABLE
        )

        if explicit_fallback_route is not None:
            fallback_index = cls.ROUTE_PRIORITY.index(explicit_fallback_route)
            if fallback_index <= primary_index:
                raise ValueError("An explicit fallback must have lower route priority")
            fallback_report = report_by_route.get(explicit_fallback_route)
            if fallback_report is None or fallback_report.state is not CapabilityState.AVAILABLE:
                return RouteSelection(
                    platform=platform,
                    primary_route=primary_route,
                    selected_route=None,
                    state=fallback_report.state
                    if fallback_report is not None
                    else CapabilityState.UNSUPPORTED,
                    reason=f"Explicit fallback {explicit_fallback_route} is not available.",
                    available_fallbacks=available_fallbacks,
                    requires_explicit_fallback=True,
                )
            return RouteSelection(
                platform=platform,
                primary_route=primary_route,
                selected_route=explicit_fallback_route,
                state=CapabilityState.AVAILABLE,
                reason=(
                    f"Using explicit fallback {explicit_fallback_route} because "
                    f"{primary_route} was not selected."
                ),
                available_fallbacks=available_fallbacks,
                fallback_from=primary_route,
                explicit_fallback_used=True,
            )

        if primary_report.state is CapabilityState.AVAILABLE:
            return RouteSelection(
                platform=platform,
                primary_route=primary_route,
                selected_route=primary_route,
                state=CapabilityState.AVAILABLE,
                reason=f"Selected highest-priority available route: {primary_route}.",
                available_fallbacks=available_fallbacks,
            )

        return RouteSelection(
            platform=platform,
            primary_route=primary_route,
            selected_route=None,
            state=primary_report.state,
            reason=(
                f"{primary_route} is {primary_report.state}; fallback was not selected "
                "without explicit caller intent."
            ),
            available_fallbacks=available_fallbacks,
            requires_explicit_fallback=bool(available_fallbacks),
        )


_FORBIDDEN_EXPORT_PATH = re.compile(r'[\\<>:"|?*\x00-\x1f\x7f]')
_WINDOWS_RESERVED_NAME = re.compile(
    r"^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)",
    re.IGNORECASE,
)


def _validate_relative_posix_path(value: str) -> str:
    lowered = value.casefold()
    if _FORBIDDEN_EXPORT_PATH.search(value) or any(
        encoded in lowered for encoded in ("%2e", "%2f", "%5c")
    ):
        raise ValueError("Export path contains unsafe characters")
    path = PurePosixPath(value)
    parts = path.parts
    if (
        not parts
        or path.is_absolute()
        or value != path.as_posix()
        or any(
            part in {"", ".", ".."}
            or part.endswith((".", " "))
            or _WINDOWS_RESERVED_NAME.match(part)
            for part in parts
        )
    ):
        raise ValueError("Export path must be a normalized relative POSIX path")
    return value


class ManualExportPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    platform: PlatformName
    route: Literal[AdapterRoute.MANUAL_EXPORT] = AdapterRoute.MANUAL_EXPORT
    markdown_path: str
    asset_paths: tuple[str, ...] = ()
    instructions: tuple[str, ...] = (
        "Open the Markdown file and the platform editor.",
        "Upload referenced assets from the asset directory.",
        "Review formatting and platform policy warnings.",
        "Save or publish manually in the platform UI.",
    )
    remote_write_performed: Literal[False] = False
    requires_user_review: Literal[True] = True

    @field_validator("markdown_path")
    @classmethod
    def validate_markdown_path(cls, value: str) -> str:
        normalized = _validate_relative_posix_path(value)
        if not normalized.casefold().endswith(".md"):
            raise ValueError("Manual export document must be Markdown")
        return normalized

    @field_validator("asset_paths")
    @classmethod
    def validate_asset_paths(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        normalized = tuple(_validate_relative_posix_path(value) for value in values)
        portable_keys = [value.casefold() for value in normalized]
        if len(portable_keys) != len(set(portable_keys)):
            raise ValueError("Manual export asset paths must be unique")
        return normalized

    @model_validator(mode="after")
    def keep_markdown_separate_from_assets(self) -> Self:
        if self.markdown_path.casefold() in {
            asset_path.casefold() for asset_path in self.asset_paths
        }:
            raise ValueError("Markdown path cannot also be an asset path")
        return self


class ManualExportPlanner:
    @staticmethod
    def build(
        *,
        platform: PlatformName,
        export_id: str,
        asset_names: Sequence[str] = (),
    ) -> ManualExportPlan:
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", export_id):
            raise ValueError("Manual export id must be a safe portable identifier")
        base = PurePosixPath("manual-export") / platform / export_id
        safe_asset_names = [_validate_relative_posix_path(name) for name in asset_names]
        return ManualExportPlan(
            platform=platform,
            markdown_path=(base / "article.md").as_posix(),
            asset_paths=tuple(
                (base / "assets" / asset_name).as_posix() for asset_name in safe_asset_names
            ),
        )
