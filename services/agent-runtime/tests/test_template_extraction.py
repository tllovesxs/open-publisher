from __future__ import annotations

import json

from open_publisher_runtime.application.model_access import (
    TextGenerationResponse,
)


class StaticTextProvider:
    def __init__(self, text: str) -> None:
        self.text = text

    @property
    def name(self) -> str:
        return "test"

    def generate(self, request):
        return TextGenerationResponse(
            text=self.text,
            provider=self.name,
            model="template-test-model",
            mocked=False,
        )


def test_template_extraction_creates_reference_analysis_without_echoing_source(client) -> None:
    source = (
        "# Wandao 体积下降 42%\n\n"
        "https://example.invalid/release\n\n"
        "## 改动\n\n具体版本与数字。\n\n"
        "## 使用建议\n\n具体示例。"
    )

    response = client.post("/api/v1/templates/extract", json={"source_markdown": source})

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["provider"] == "mock"
    assert payload["mocked"] is True
    assert "{{title}}" in payload["markdown"]
    assert payload["style_profile"]["tone"] == "专业、清晰"
    assert "title" in payload["variables"]
    assert "Wandao" not in payload["markdown"]
    assert "example.invalid" not in payload["markdown"]
    assert "source_markdown" not in payload
    assert payload["analysis_version"] == "reference-template.v1"
    assert payload["source_fingerprint"].startswith("sha256:")
    assert set(payload) == {
        "name",
        "description",
        "category",
        "markdown",
        "style_profile",
        "structure_profile",
        "layout_profile",
        "fixed_blocks",
        "variables",
        "usage_instructions",
        "analysis_version",
        "source_fingerprint",
        "provider",
        "model",
        "mocked",
    }


def test_template_extraction_sanitizes_concrete_links_from_model_output(client) -> None:
    client.app.state.container.model_access.text_provider = StaticTextProvider(
        json.dumps(
            {
                "name": "不安全模板",
                "description": "包含不该保留的链接。",
                "category": "测试",
                "markdown": "# {{title}}\n\n[原文](https://example.invalid/private)",
                "style_profile": {},
                "structure_profile": {},
                "layout_profile": {},
                "fixed_blocks": [],
                "variables": ["title"],
                "usage_instructions": "",
            },
            ensure_ascii=False,
        )
    )

    response = client.post(
        "/api/v1/templates/extract",
        json={"source_markdown": "# 原文\n\n不能保留链接"},
    )

    assert response.status_code == 200, response.text
    assert "{{reference_url}}" in response.json()["markdown"]
    assert "example.invalid" not in response.text


def test_template_extraction_replaces_a_repeated_source_title(client) -> None:
    client.app.state.container.model_access.text_provider = StaticTextProvider(
        json.dumps(
            {
                "name": "产品更新模板",
                "description": "可复用的更新结构。",
                "category": "测试",
                "markdown": "# Wandao 体积下降 42%\n\n{{lead}}",
                "style_profile": {},
                "structure_profile": {},
                "layout_profile": {},
                "fixed_blocks": [],
                "variables": ["lead"],
                "usage_instructions": "",
            },
            ensure_ascii=False,
        )
    )

    response = client.post(
        "/api/v1/templates/extract",
        json={"source_markdown": "# Wandao 体积下降 42%\n\n文章正文"},
    )

    assert response.status_code == 200, response.text
    assert "Wandao" not in response.text


def test_template_extraction_keeps_analysis_when_metadata_mentions_source_title(client) -> None:
    client.app.state.container.model_access.text_provider = StaticTextProvider(
        json.dumps(
            {
                "name": "Wandao 更新文章写法",
                "description": "复用 Wandao 发布说明的递进式讲解节奏。",
                "category": "产品更新",
                "markdown": (
                    "# {{title}}\n\n{{lead}}\n\n> {{key_claim}}\n\n## {{feature_heading}}"
                    "\n\n{{feature_detail}}\n\n{{closing}}"
                ),
                "style_profile": {"tone": "坦诚、技术化", "pacing": "先问题后改动"},
                "structure_profile": {"section_pattern": "痛点、能力、使用建议"},
                "layout_profile": {"use_blockquotes": True},
                "fixed_blocks": [],
                "variables": [
                    "title",
                    "lead",
                    "key_claim",
                    "feature_heading",
                    "feature_detail",
                    "closing",
                ],
                "usage_instructions": "替换事实和观点，保留由痛点到行动建议的推进。",
            },
            ensure_ascii=False,
        )
    )

    response = client.post(
        "/api/v1/templates/extract",
        json={"source_markdown": "# Wandao 体积下降 42%\n\n## 改动\n\n文章正文"},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["name"] == "Wandao 更新文章写法"
    assert payload["style_profile"]["tone"] == "坦诚、技术化"
    assert "{{key_claim}}" in payload["markdown"]


def test_template_extraction_adds_title_slot_without_discarding_model_structure(client) -> None:
    client.app.state.container.model_access.text_provider = StaticTextProvider(
        json.dumps(
            {
                "name": "递进说明模板",
                "description": "保留问题、转折和建议的节奏。",
                "category": "说明文",
                "markdown": "# 具体标题\n\n问题说明\n\n## 具体章节\n\n解决方案与行动建议",
                "style_profile": {"tone": "直接"},
                "structure_profile": {"section_pattern": "问题到方案"},
                "layout_profile": {},
                "fixed_blocks": [],
                "variables": [],
                "usage_instructions": "按相同顺序填写新主题。",
            },
            ensure_ascii=False,
        )
    )

    response = client.post(
        "/api/v1/templates/extract",
        json={"source_markdown": "# 原始标题\n\n正文"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["markdown"].startswith("# {{title}}")
    assert "## 具体章节" in response.json()["markdown"]


def test_template_extraction_validates_source_before_calling_model(client) -> None:
    response = client.post("/api/v1/templates/extract", json={"source_markdown": "  "})
    assert response.status_code == 422

    oversized = client.post(
        "/api/v1/templates/extract",
        json={"source_markdown": "x" * 60_001},
    )
    assert oversized.status_code == 422
