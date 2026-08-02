from __future__ import annotations

import re
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from open_publisher_runtime.application.platform_adapters import (
    AdapterRoute,
    BrowserDraftTaskFactory,
    CapabilityState,
    ManualExportPlanner,
    PlatformAdapterSelector,
    WeChatDraftArticle,
    WeChatOfficialApiAdapter,
    WeChatOfficialApiProbeInput,
    browser_extension_capability,
    manual_export_capability,
    unsupported_official_api_capability,
)


def _all_mapping_keys(value: object) -> list[str]:
    if isinstance(value, dict):
        return [
            *(str(key) for key in value),
            *(nested_key for nested in value.values() for nested_key in _all_mapping_keys(nested)),
        ]
    if isinstance(value, (list, tuple)):
        return [nested_key for nested in value for nested_key in _all_mapping_keys(nested)]
    return []


def test_wechat_probe_uses_only_local_opaque_configuration() -> None:
    report = WeChatOfficialApiAdapter.probe(
        WeChatOfficialApiProbeInput(
            app_id="wx-local-app",
            secret_ref="keyring://open-publisher/wechat-primary",
            account_verified=True,
            draft_api_enabled=True,
            media_upload_enabled=False,
        )
    )

    assert report.state is CapabilityState.AVAILABLE
    assert report.route is AdapterRoute.OFFICIAL_API
    assert report.network_probe_performed is False
    assert report.remote_write_performed is False
    serialized = report.model_dump(mode="json")
    assert "wechat-primary" not in str(serialized)
    assert not any(
        "secret" in key.casefold() or "cookie" in key.casefold()
        for key in _all_mapping_keys(serialized)
    )

    missing = WeChatOfficialApiAdapter.probe(WeChatOfficialApiProbeInput())
    assert missing.state is CapabilityState.NEEDS_CONFIGURATION
    assert missing.network_probe_performed is False

    unknown = WeChatOfficialApiAdapter.probe(
        WeChatOfficialApiProbeInput(
            app_id="wx-local-app",
            secret_ref="keyring://open-publisher/wechat-primary",
            account_verified=True,
        )
    )
    assert unknown.state is CapabilityState.UNKNOWN

    with pytest.raises(ValidationError):
        WeChatOfficialApiProbeInput.model_validate(
            {
                "app_id": "wx-local-app",
                "secret_ref": "keyring://open-publisher/wechat-primary",
                "app_secret": "plaintext-is-forbidden",
            }
        )


def test_wechat_draft_payload_is_body_only_and_rejects_active_html() -> None:
    payload = WeChatOfficialApiAdapter.build_draft_payload(
        WeChatDraftArticle(
            title="安全草稿",
            content_html="<p>正文内容</p>",
            thumb_media_id="media_opaque_123",
            author="作者",
            digest="摘要",
            content_source_url="https://example.com/source",
        )
    ).to_api_payload()

    assert payload == {
        "articles": [
            {
                "title": "安全草稿",
                "content": "<p>正文内容</p>",
                "thumb_media_id": "media_opaque_123",
                "author": "作者",
                "digest": "摘要",
                "content_source_url": "https://example.com/source",
                "need_open_comment": 0,
                "only_fans_can_comment": 0,
            }
        ]
    }
    assert not any(
        "secret" in key.casefold() or "token" in key.casefold() or "cookie" in key.casefold()
        for key in _all_mapping_keys(payload)
    )

    with pytest.raises(ValidationError):
        WeChatDraftArticle(
            title="不安全草稿",
            content_html="<script>alert('no')</script>",
            thumb_media_id="media_opaque_123",
        )

    with pytest.raises(ValidationError):
        WeChatDraftArticle(
            title="不安全来源",
            content_html="<p>正文</p>",
            thumb_media_id="media_opaque_123",
            content_source_url="http://example.com/source",
        )


@pytest.mark.parametrize("platform", ["wechat", "csdn", "toutiao", "zhihu", "xiaohongshu"])
def test_browser_task_matches_mv3_protocol_and_is_short_lived(platform: str) -> None:
    task = BrowserDraftTaskFactory.create(
        platform=platform,
        title="平台草稿",
        content="# 正文",
        nonce="abcdefghijklmnopqrstuvwxyzABCDEF",
        ttl_seconds=120,
        summary="摘要",
        tags=("开源", "智能体"),
    )
    wire = task.to_wire()

    assert wire["schemaVersion"] == "1.0"
    assert wire["platform"] == platform
    assert wire["action"] == "FILL_DRAFT"
    assert re.fullmatch(r"[A-Za-z0-9_-]{32,128}", str(wire["nonce"]))
    assert wire["safety"] == {
        "finalPublish": False,
        "requiresUserReview": True,
    }
    expires_at = datetime.fromisoformat(str(wire["expiresAt"]).replace("Z", "+00:00"))
    remaining = (expires_at - datetime.now(UTC)).total_seconds()
    assert 0 < remaining <= 10 * 60
    assert not any(
        "secret" in key.casefold() or "cookie" in key.casefold() for key in _all_mapping_keys(wire)
    )


def test_browser_task_rejects_unsafe_nonce_and_ttl() -> None:
    generated = BrowserDraftTaskFactory.create(
        platform="csdn",
        title="草稿",
        content="正文",
    )
    assert re.fullmatch(r"[A-Za-z0-9_-]{32,128}", generated.nonce)

    with pytest.raises(ValidationError):
        BrowserDraftTaskFactory.create(
            platform="csdn",
            title="草稿",
            content="正文",
            nonce="too-short",
        )
    with pytest.raises(ValueError, match="TTL"):
        BrowserDraftTaskFactory.create(
            platform="csdn",
            title="草稿",
            content="正文",
            ttl_seconds=601,
        )


def test_router_never_silently_downgrades() -> None:
    official = WeChatOfficialApiAdapter.probe(
        WeChatOfficialApiProbeInput(
            app_id="wx-local-app",
            secret_ref="keyring://open-publisher/wechat-primary",
            account_verified=True,
            draft_api_enabled=False,
        )
    )
    browser = browser_extension_capability("wechat", installed=True, paired=True)
    manual = manual_export_capability("wechat")

    blocked = PlatformAdapterSelector.select(
        platform="wechat",
        reports=(official, browser, manual),
    )
    assert blocked.primary_route is AdapterRoute.OFFICIAL_API
    assert blocked.selected_route is None
    assert blocked.requires_explicit_fallback is True
    assert blocked.available_fallbacks == (
        AdapterRoute.BROWSER_EXTENSION,
        AdapterRoute.MANUAL_EXPORT,
    )

    explicit = PlatformAdapterSelector.select(
        platform="wechat",
        reports=(official, browser, manual),
        explicit_fallback_route=AdapterRoute.BROWSER_EXTENSION,
    )
    assert explicit.selected_route is AdapterRoute.BROWSER_EXTENSION
    assert explicit.explicit_fallback_used is True
    assert explicit.fallback_from is AdapterRoute.OFFICIAL_API
    assert "explicit fallback" in explicit.reason.casefold()

    available_official = WeChatOfficialApiAdapter.probe(
        WeChatOfficialApiProbeInput(
            app_id="wx-local-app",
            secret_ref="keyring://open-publisher/wechat-primary",
            account_verified=True,
            draft_api_enabled=True,
        )
    )
    highest_priority = PlatformAdapterSelector.select(
        platform="wechat",
        reports=(available_official, browser, manual),
    )
    assert highest_priority.selected_route is AdapterRoute.OFFICIAL_API


def test_router_priority_skips_routes_that_are_explicitly_unsupported() -> None:
    selection = PlatformAdapterSelector.select(
        platform="csdn",
        reports=(
            unsupported_official_api_capability("csdn"),
            browser_extension_capability("csdn", installed=True, paired=True),
            manual_export_capability("csdn"),
        ),
    )
    assert selection.primary_route is AdapterRoute.BROWSER_EXTENSION
    assert selection.selected_route is AdapterRoute.BROWSER_EXTENSION


def test_manual_export_plan_uses_relative_markdown_and_asset_paths() -> None:
    plan = ManualExportPlanner.build(
        platform="toutiao",
        export_id="article-001",
        asset_names=("cover.png", "inline/chart.svg"),
    )

    assert plan.markdown_path == "manual-export/toutiao/article-001/article.md"
    assert plan.asset_paths == (
        "manual-export/toutiao/article-001/assets/cover.png",
        "manual-export/toutiao/article-001/assets/inline/chart.svg",
    )
    assert all(not PurePath.startswith(("/", "\\")) for PurePath in plan.asset_paths)
    assert plan.remote_write_performed is False
    assert plan.requires_user_review is True

    with pytest.raises(ValueError):
        ManualExportPlanner.build(
            platform="toutiao",
            export_id="article-001",
            asset_names=("../secret.png",),
        )
