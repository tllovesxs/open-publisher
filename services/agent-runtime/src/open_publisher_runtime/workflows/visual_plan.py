from __future__ import annotations

import json
import re
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from open_publisher_runtime.domain.policies import VisualCompositionRequest

MAX_VISUAL_PLACEMENTS = 6
_HEADING_PATTERN = re.compile(r"^#{1,6}\s+(.+?)\s*$", re.MULTILINE)


class VisualPlacement(BaseModel):
    """One safe Markdown insertion instruction returned by the visual Agent."""

    model_config = ConfigDict(extra="forbid")

    after_heading: str | None = Field(default=None, max_length=180)
    asset_id: str | None = Field(default=None, max_length=100)
    alt: str = Field(min_length=1, max_length=180)
    generation_prompt: str | None = Field(default=None, max_length=2000)

    def model_post_init(self, __context: object) -> None:
        if self.asset_id is None and not (self.generation_prompt or "").strip():
            raise ValueError("a visual placement needs an asset_id or generation_prompt")
        if self.asset_id is not None and self.generation_prompt is not None:
            raise ValueError("a visual placement cannot select and generate an image together")


class VisualCompositionPlan(BaseModel):
    """A structured visual plan, separate from canonical Markdown."""

    model_config = ConfigDict(extra="forbid")

    target_count: int = Field(ge=0, le=MAX_VISUAL_PLACEMENTS)
    placements: list[VisualPlacement] = Field(max_length=MAX_VISUAL_PLACEMENTS)

    def model_post_init(self, __context: object) -> None:
        if len(self.placements) != self.target_count:
            raise ValueError("visual placement count must match target_count")


def auto_image_count(markdown: str) -> int:
    """Choose a conservative in-article image count from the completed draft."""

    characters = len(re.sub(r"\s+", "", markdown))
    if characters <= 900:
        return 1
    if characters <= 2_000:
        return 2
    if characters <= 3_800:
        return 3
    return 4


def target_image_count(markdown: str, request: VisualCompositionRequest) -> int:
    if request.mode == "none":
        return 0
    if request.mode == "fixed":
        return request.target_count
    return auto_image_count(markdown)


def _headings(markdown: str) -> list[str]:
    return [
        match.group(1).strip()
        for match in _HEADING_PATTERN.finditer(markdown)
        if match.group(1).strip()
    ]


def _heading_for_slot(headings: list[str], slot: int, total: int) -> str | None:
    if not headings:
        return None
    # Avoid placing every image beneath the first section when an article has structure.
    index = min((slot * len(headings)) // max(total, 1), len(headings) - 1)
    return headings[index]


def fallback_visual_plan(
    markdown: str,
    request: VisualCompositionRequest,
) -> VisualCompositionPlan:
    target_count = target_image_count(markdown, request)
    if target_count == 0:
        return VisualCompositionPlan(target_count=0, placements=[])

    headings = _headings(markdown)
    selected = list(request.assets[:target_count])
    placements: list[VisualPlacement] = []
    for index in range(target_count):
        heading = _heading_for_slot(headings, index, target_count)
        if index < len(selected):
            asset = selected[index]
            placements.append(
                VisualPlacement(
                    after_heading=heading,
                    asset_id=asset.id,
                    alt=asset.alt,
                )
            )
            continue
        section = heading or "文章核心观点"
        placements.append(
            VisualPlacement(
                after_heading=heading,
                alt=f"{section} 配图 {index + 1}",
                generation_prompt=(
                    f"为中文文章的小节“{section}”生成一张清晰、克制的信息型配图。"
                    "突出该小节的核心概念与关系，不包含品牌标识、人物肖像、可读文字、"
                    "水印或未经证实的数据。"
                ),
            )
        )
    return VisualCompositionPlan(target_count=target_count, placements=placements)


def _json_object_from_model_text(text: str) -> dict[str, Any]:
    candidate = text.strip()
    if candidate.startswith("```") and candidate.endswith("```"):
        candidate = candidate.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start < 0 or end < start:
        raise ValueError("visual Agent did not return a JSON object")
    payload = json.loads(candidate[start : end + 1])
    if not isinstance(payload, dict):
        raise ValueError("visual Agent JSON output must be an object")
    return payload


def _validate_model_plan(
    plan: VisualCompositionPlan,
    markdown: str,
    request: VisualCompositionRequest,
) -> VisualCompositionPlan:
    target_count = target_image_count(markdown, request)
    if plan.target_count != target_count or len(plan.placements) != target_count:
        raise ValueError("visual Agent returned an unexpected placement count")

    available_asset_ids = {asset.id for asset in request.assets}
    selected_asset_ids = [
        placement.asset_id
        for placement in plan.placements
        if placement.asset_id is not None
    ]
    expected_selected_count = min(target_count, len(request.assets))
    if (
        len(selected_asset_ids) != expected_selected_count
        or len(set(selected_asset_ids)) != len(selected_asset_ids)
        or any(asset_id not in available_asset_ids for asset_id in selected_asset_ids)
    ):
        raise ValueError("visual Agent did not use the selected assets safely")

    valid_headings = set(_headings(markdown))
    if any(
        placement.after_heading is not None
        and placement.after_heading not in valid_headings
        for placement in plan.placements
    ):
        raise ValueError("visual Agent selected a heading that is not in the article")
    return plan


def plan_visual_composition(
    model_text: str,
    markdown: str,
    request: VisualCompositionRequest,
) -> VisualCompositionPlan:
    """Use valid Agent JSON when available, otherwise create a safe deterministic plan."""

    if request.mode == "none":
        return fallback_visual_plan(markdown, request)
    try:
        candidate = VisualCompositionPlan.model_validate(
            _json_object_from_model_text(model_text)
        )
        return _validate_model_plan(candidate, markdown, request)
    except (ValidationError, ValueError, json.JSONDecodeError):
        return fallback_visual_plan(markdown, request)
