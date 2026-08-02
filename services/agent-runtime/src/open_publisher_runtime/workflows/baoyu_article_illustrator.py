"""Baoyu Article Illustrator integration.

The bundled Baoyu resources remain the source of truth for the visual workflow.
This module deliberately keeps the model-facing artifacts in the Skill's native
Markdown form (``outline.md`` and ``selection.md``), then converts them into a
bounded application plan.  It never generates an image or mutates an article.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable
from dataclasses import dataclass
from importlib.resources import files
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from open_publisher_runtime.domain.policies import (
    VisualAssetInstruction,
    VisualCompositionRequest,
)

MAX_VISUAL_PLACEMENTS = 6
_VISUAL_TYPES = frozenset(
    {"infographic", "scene", "flowchart", "comparison", "framework", "timeline"}
)
_FIELD_PATTERN = re.compile(
    r"^\*\*(?P<name>Position|Purpose|Visual Content|Type Application|Filename|"
    r"位置|目的|视觉内容|类型应用|文件名)\*\*\s*[:：]\s*(?P<value>.+?)\s*$",
    re.IGNORECASE | re.MULTILINE,
)
_ILLUSTRATION_PATTERN = re.compile(
    r"^##\s*(?:Illustration|插图)\s*(?P<index>\d+)\s*$", re.IGNORECASE | re.MULTILINE
)
_SELECTION_PATTERN = re.compile(
    r"^##\s*(?:Illustration|插图)\s*(?P<index>\d+)\s*$", re.IGNORECASE | re.MULTILINE
)
_SOURCE_PATTERN = re.compile(
    r"^\*\*(?:Source|来源)\*\*\s*[:：]\s*(?P<value>.+?)\s*$",
    re.IGNORECASE | re.MULTILINE,
)
_REASON_PATTERN = re.compile(
    r"^\*\*(?:Reason|理由)\*\*\s*[:：]\s*(?P<value>.+?)\s*$",
    re.IGNORECASE | re.MULTILINE,
)
_METADATA_PATTERN = re.compile(r"^(?P<key>[a-z_]+)\s*:\s*(?P<value>.+?)\s*$", re.MULTILINE)


@dataclass(frozen=True, slots=True)
class MarkdownBlock:
    """A non-structural article paragraph with a stable source-revision anchor."""

    id: str
    ordinal: int
    heading: str | None
    text: str
    excerpt: str


class MaterialCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_id: str
    score: float = Field(ge=0, le=1)
    description: str = Field(min_length=1, max_length=900)


class VisualPromptFile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    placement_id: str
    path: str
    content: str = Field(min_length=1, max_length=12_000)


class VisualPlacement(BaseModel):
    """A reviewed, side-effect-free instruction for one paragraph illustration."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^illustration-[1-6]$")
    block_id: str | None = Field(default=None, max_length=100)
    anchor_excerpt: str | None = Field(default=None, max_length=240)
    after_heading: str | None = Field(default=None, max_length=180)
    purpose: str = Field(min_length=1, max_length=900)
    visual_content: str = Field(min_length=1, max_length=1_500)
    visual_type: str = Field(min_length=1, max_length=32)
    source: Literal["existing_asset", "generate", "needs_confirmation"]
    asset_id: str | None = Field(default=None, max_length=100)
    candidates: list[MaterialCandidate] = Field(default_factory=list, max_length=5)
    selection_reason: str = Field(min_length=1, max_length=900)
    alt: str = Field(min_length=1, max_length=180)
    generation_prompt: str | None = Field(default=None, max_length=4_000)
    prompt_file: str | None = Field(default=None, max_length=220)

    def model_post_init(self, __context: object) -> None:
        if self.source == "existing_asset" and not self.asset_id:
            raise ValueError("an existing asset placement needs an asset id")
        if self.source == "generate" and not self.generation_prompt:
            raise ValueError("a generated placement needs a saved prompt")
        if self.source != "generate" and self.generation_prompt is not None:
            raise ValueError("only generated placements can expose a generation prompt")
        if self.source == "generate" and not self.prompt_file:
            raise ValueError("a generated placement needs a prompt file path")


class VisualCompositionPlan(BaseModel):
    """Immutable visual planning artifacts tied to an article revision hash."""

    model_config = ConfigDict(extra="forbid")

    source_revision_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    target_count: int = Field(ge=0, le=MAX_VISUAL_PLACEMENTS)
    settings: dict[str, str] = Field(default_factory=dict)
    needs_confirmation: bool = True
    outline_markdown: str = Field(min_length=1, max_length=30_000)
    material_selection_markdown: str = Field(min_length=1, max_length=20_000)
    prompt_files: list[VisualPromptFile] = Field(
        default_factory=list, max_length=MAX_VISUAL_PLACEMENTS
    )
    placements: list[VisualPlacement] = Field(max_length=MAX_VISUAL_PLACEMENTS)

    def model_post_init(self, __context: object) -> None:
        if len(self.placements) != self.target_count:
            raise ValueError("visual placement count must match target_count")
        generated = [placement for placement in self.placements if placement.source == "generate"]
        if len(generated) != len(self.prompt_files):
            raise ValueError("every generated placement needs exactly one prompt artifact")
        if {item.placement_id for item in self.prompt_files} != {item.id for item in generated}:
            raise ValueError("prompt artifacts must match generated placements")


def auto_image_count(markdown: str) -> int:
    """Choose a conservative image count from a completed draft."""

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


def read_baoyu_resource(relative_path: str) -> str:
    """Read the pinned, verbatim upstream resource bundled with the runtime."""

    return read_baoyu_resource_bytes(relative_path).decode("utf-8")


def read_baoyu_resource_bytes(relative_path: str) -> bytes:
    """Read source bytes for integrity checks without newline normalization."""

    resource = files("open_publisher_runtime").joinpath(
        "resources", "baoyu-article-illustrator", relative_path
    )
    return resource.read_bytes()


def source_revision_hash(markdown: str) -> str:
    return hashlib.sha256(markdown.encode("utf-8")).hexdigest()


def _clean(value: str, limit: int) -> str:
    return " ".join(value.replace("\n", " ").split()).strip()[:limit]


def _slug(value: str, fallback: str) -> str:
    words = re.findall(r"[a-z0-9]+", value.lower())[:4]
    return "-".join(words) if words else fallback


def markdown_blocks(markdown: str) -> list[MarkdownBlock]:
    """Index paragraph-level anchors without ever targeting code, lists, or quotes."""

    lines = markdown.splitlines()
    blocks: list[MarkdownBlock] = []
    current_heading: str | None = None
    paragraph: list[str] = []
    in_fence = False

    def flush() -> None:
        nonlocal paragraph
        text = _clean("\n".join(paragraph), 2_000)
        paragraph = []
        if not text:
            return
        if text.startswith(("![](", "![", "|", "> ", "- ", "* ")):
            return
        ordinal = len(blocks) + 1
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]
        blocks.append(
            MarkdownBlock(
                id=f"block-{ordinal}-{digest}",
                ordinal=ordinal,
                heading=current_heading,
                text=text,
                excerpt=_clean(text, 220),
            )
        )

    for line in lines:
        if line.strip().startswith("```"):
            flush()
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        heading = re.match(r"^#{1,6}\s+(.+?)\s*$", line)
        if heading:
            flush()
            current_heading = _clean(heading.group(1), 180)
            continue
        if not line.strip():
            flush()
            continue
        if re.match(r"^(?:[-*+]\s+|\d+[.)]\s+|>\s*)", line):
            flush()
            continue
        paragraph.append(line)
    flush()
    return blocks


def _token_set(value: str) -> set[str]:
    normalized = value.lower()
    latin = re.findall(r"[a-z0-9]{2,}", normalized)
    cjk = re.findall(r"[\u4e00-\u9fff]", normalized)
    return set(latin + cjk)


def _similarity(left: str, right: str) -> float:
    left_tokens, right_tokens = _token_set(left), _token_set(right)
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / len(left_tokens | right_tokens)


def rank_material_candidates(
    *,
    visual_content: str,
    purpose: str,
    assets: Iterable[VisualAssetInstruction],
    limit: int = 5,
) -> list[MaterialCandidate]:
    """Deterministic, inspectable lexical retrieval over author-provided metadata."""

    query = f"{visual_content}\n{purpose}"
    candidates = []
    for asset in assets:
        description = _clean(f"{asset.alt}\n{asset.description}", 900)
        candidates.append(
            MaterialCandidate(
                asset_id=asset.id,
                score=round(_similarity(query, description), 4),
                description=description,
            )
        )
    return sorted(candidates, key=lambda item: (-item.score, item.asset_id))[:limit]


def _settings(request: VisualCompositionRequest) -> dict[str, str]:
    return {
        "type": request.preferred_type,
        "density": request.density,
        "style": request.style,
        "palette": request.palette or "default",
        "asset_scope": request.asset_scope,
        "generation_batch_size": str(request.generation_batch_size),
        "image_backend": request.preferred_image_backend,
    }


def fallback_outline_markdown(markdown: str, request: VisualCompositionRequest) -> str:
    """Produce a valid native Baoyu outline if an LLM response is unavailable."""

    count = target_image_count(markdown, request)
    blocks = markdown_blocks(markdown)
    metadata = _settings(request)
    lines = [
        "---",
        *(f"{key}: {value}" for key, value in metadata.items()),
        f"image_count: {count}",
        "---",
        "",
    ]
    for index in range(count):
        if blocks:
            block = blocks[min((index * len(blocks)) // max(count, 1), len(blocks) - 1)]
            section = block.heading or "文章核心观点"
            position = f"{section} / {block.excerpt}"
            visual = (
                f"围绕“{block.excerpt}”解释关键概念、关系或执行步骤的{request.preferred_type}配图"
            )
        else:
            section = "文章核心观点"
            position = section
            visual = f"解释文章核心观点的{request.preferred_type}配图"
        slug = _slug(section, f"concept-{index + 1}")
        lines.extend(
            [
                f"## Illustration {index + 1}",
                f"**Position**: {position}",
                "**Purpose**: 帮助读者在阅读对应段落后快速理解核心关系。",
                f"**Visual Content**: {visual}",
                f"**Type Application**: 使用 {request.preferred_type} 的信息结构，避免装饰性画面。",
                f"**Filename**: {index + 1:02d}-{request.preferred_type}-{slug}.png",
                "",
            ]
        )
    return "\n".join(lines).strip() + "\n"


def _outline_sections(outline_markdown: str) -> list[tuple[int, str]]:
    matches = list(_ILLUSTRATION_PATTERN.finditer(outline_markdown))
    sections: list[tuple[int, str]] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(outline_markdown)
        sections.append((int(match.group("index")), outline_markdown[match.start() : end]))
    return sections


def _metadata(outline_markdown: str) -> dict[str, str]:
    frontmatter = re.match(r"^---\s*\n(?P<body>.*?)\n---\s*", outline_markdown, re.DOTALL)
    if not frontmatter:
        return {}
    return {
        match.group("key").lower(): _clean(match.group("value").strip("\"'"), 80)
        for match in _METADATA_PATTERN.finditer(frontmatter.group("body"))
    }


def _fields(section: str) -> dict[str, str]:
    aliases = {
        "position": "position",
        "位置": "position",
        "purpose": "purpose",
        "目的": "purpose",
        "visual content": "visual_content",
        "视觉内容": "visual_content",
        "type application": "type_application",
        "类型应用": "type_application",
        "filename": "filename",
        "文件名": "filename",
    }
    result: dict[str, str] = {}
    for match in _FIELD_PATTERN.finditer(section):
        result[aliases[match.group("name").lower()]] = _clean(match.group("value"), 1_500)
    return result


def _block_for_position(
    *,
    position: str,
    visual_content: str,
    blocks: list[MarkdownBlock],
    used_block_ids: set[str],
) -> MarkdownBlock | None:
    available = [block for block in blocks if block.id not in used_block_ids]
    if not available:
        return None
    scored = [
        (
            _similarity(f"{position}\n{visual_content}", f"{block.heading or ''}\n{block.text}"),
            -block.ordinal,
            block,
        )
        for block in available
    ]
    # A named section is a strong and explainable signal, even for Chinese text.
    named = [item for item in scored if item[2].heading and item[2].heading in position]
    return max(named or scored, key=lambda item: (item[0], item[1]))[2]


def _prompt_text(
    *,
    placement: VisualPlacement,
    settings: dict[str, str],
    filename: str,
) -> str:
    style = settings["style"]
    palette = settings["palette"]
    try:
        style_rules = _clean(read_baoyu_resource(f"references/styles/{style}.md"), 1_700)
    except (FileNotFoundError, OSError):
        style_rules = "Use the selected visual style consistently across the full illustration."
    palette_rules = "Use the style default colors."
    if palette != "default":
        try:
            palette_rules = _clean(read_baoyu_resource(f"references/palettes/{palette}.md"), 900)
        except (FileNotFoundError, OSError):
            palette_rules = "Use the selected palette consistently."
    label_anchor = placement.anchor_excerpt or placement.after_heading or "核心观点"
    return (
        "---\n"
        f"illustration_id: {placement.id}\n"
        f"type: {placement.visual_type}\n"
        f"style: {style}\n"
        f"palette: {palette}\n"
        "aspect_ratio: 3:2\n"
        f"output_file: {filename}\n"
        "---\n\n"
        f"# {placement.alt}\n\n"
        f"LAYOUT: Create a clear 3:2 {placement.visual_type} composition "
        "for the paragraph anchor.\n"
        f"ZONES: {placement.visual_content}\n"
        "LABELS: Prefer no in-image text. If a label is indispensable, use only "
        f"exact article terms: {label_anchor}\n"
        f"COLORS: {palette_rules}\n"
        f"STYLE: {style_rules}\n"
        "ASPECT: 3:2 landscape.\n\n"
        "Do not include brand marks, watermarks, portraits, fabricated metrics, "
        "or decorative text. When image text would be ambiguous, omit it rather "
        "than attempting to repair a bitmap later.\n"
    )


def _selection_fallback(
    plan: VisualCompositionPlan,
    assets: list[VisualAssetInstruction],
) -> str:
    assets_by_id = {asset.id: asset for asset in assets}
    lines = ["# Material selection", ""]
    used_assets: set[str] = set()
    for placement in plan.placements:
        selectable = [
            candidate for candidate in placement.candidates if candidate.asset_id not in used_assets
        ]
        candidate = selectable[0] if selectable else None
        if candidate and candidate.score >= 0.12 and candidate.asset_id in assets_by_id:
            source = f"existing_asset: {candidate.asset_id}"
            reason = f"素材描述与该视觉目标的匹配分为 {candidate.score:.2f}。"
            used_assets.add(candidate.asset_id)
        else:
            source = "generate"
            reason = "没有足够匹配且未重复使用的作者素材，需要生成新图片。"
        lines.extend(
            [
                f"## Illustration {placement.id.rsplit('-', 1)[-1]}",
                f"**Source**: {source}",
                f"**Reason**: {reason}",
                "",
            ]
        )
    return "\n".join(lines).strip() + "\n"


def material_selection_prompt(plan: VisualCompositionPlan) -> str:
    """Native Markdown selection stage, deliberately not a custom JSON contract."""

    choices = []
    for placement in plan.placements:
        candidates = (
            "\n".join(
                f"- {candidate.asset_id} | score {candidate.score:.2f} | {candidate.description}"
                for candidate in placement.candidates
            )
            or "- No suitable supplied material candidates"
        )
        choices.append(
            f"## Illustration {placement.id.rsplit('-', 1)[-1]}\n"
            f"Visual need: {placement.visual_content}\n"
            f"Anchor: {placement.anchor_excerpt or placement.after_heading or 'unresolved'}\n"
            f"Candidates:\n{candidates}"
        )
    return (
        "Follow the Baoyu Article Illustrator workflow. The native outline is already fixed. "
        "Choose the material source for every illustration. A supplied image may be "
        "used at most once; "
        "choose generate when a candidate does not meaningfully serve the visual need. "
        "Return Markdown only, with exactly this shape for every item: `## Illustration N`, "
        "`**Source**: existing_asset: asset-id` or `**Source**: generate`, and `**Reason**: ...`. "
        "Do not output JSON and do not modify the article.\n\n"
        f"# Outline\n\n{plan.outline_markdown}\n\n# Candidate retrieval\n\n"
        + "\n\n".join(choices)
    )


def _selection_values(selection_markdown: str) -> dict[int, tuple[str, str]]:
    values: dict[int, tuple[str, str]] = {}
    matches = list(_SELECTION_PATTERN.finditer(selection_markdown))
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(selection_markdown)
        section = selection_markdown[match.start() : end]
        source = _SOURCE_PATTERN.search(section)
        reason = _REASON_PATTERN.search(section)
        if source:
            values[int(match.group("index"))] = (
                _clean(source.group("value"), 160),
                _clean(reason.group("value") if reason else "视觉 Agent 未提供理由。", 900),
            )
    return values


def build_plan_from_outline(
    *,
    markdown: str,
    request: VisualCompositionRequest,
    outline_markdown: str,
    revision_hash: str | None = None,
) -> VisualCompositionPlan:
    """Parse the upstream outline grammar and attach deterministic retrieval evidence."""

    expected_count = target_image_count(markdown, request)
    sections = _outline_sections(outline_markdown)
    if len(sections) != expected_count:
        outline_markdown = fallback_outline_markdown(markdown, request)
        sections = _outline_sections(outline_markdown)
    metadata = _metadata(outline_markdown)
    settings = _settings(request)
    settings.update(
        {
            key: value
            for key, value in metadata.items()
            if key in {"type", "density", "style", "palette"}
        }
    )
    visual_type = settings["type"] if settings["type"] in _VISUAL_TYPES else request.preferred_type
    blocks = markdown_blocks(markdown)
    used_blocks: set[str] = set()
    placements: list[VisualPlacement] = []
    for ordinal, section in sections:
        fields = _fields(section)
        position = fields.get("position", "文章核心观点")
        visual_content = fields.get("visual_content", f"解释文章核心观点的{visual_type}配图")
        purpose = fields.get("purpose", "帮助读者理解对应段落的关键关系。")
        block = _block_for_position(
            position=position,
            visual_content=visual_content,
            blocks=blocks,
            used_block_ids=used_blocks,
        )
        if block:
            used_blocks.add(block.id)
        filename = (
            fields.get("filename")
            or f"{ordinal:02d}-{visual_type}-{_slug(position, f'concept-{ordinal}')}.png"
        )
        placement = VisualPlacement(
            id=f"illustration-{ordinal}",
            block_id=block.id if block else None,
            anchor_excerpt=block.excerpt if block else None,
            after_heading=block.heading if block else None,
            purpose=purpose,
            visual_content=visual_content,
            visual_type=visual_type,
            source="needs_confirmation",
            candidates=rank_material_candidates(
                visual_content=visual_content,
                purpose=purpose,
                assets=request.assets if request.asset_scope != "none" else [],
            ),
            selection_reason=(
                "已定位到稳定段落锚点，等待素材来源确认。"
                if block
                else "大纲位置未能映射到安全段落锚点，需要在确认页指定位置。"
            ),
            alt=_clean(visual_content, 180) or f"正文配图 {ordinal}",
        )
        placements.append(
            placement.model_copy(update={"prompt_file": None, "generation_prompt": None})
        )
        # Filename comes from the source outline and is used after source selection.
        placements[-1] = placements[-1].model_copy(
            update={"selection_reason": placements[-1].selection_reason + f" 输出文件：{filename}"}
        )
    draft_plan = VisualCompositionPlan(
        source_revision_hash=revision_hash or source_revision_hash(markdown),
        target_count=expected_count,
        settings=settings,
        needs_confirmation=not request.skip_confirmation,
        outline_markdown=outline_markdown,
        material_selection_markdown="# Material selection\n\n等待视觉 Agent 选择素材来源。\n",
        prompt_files=[],
        placements=placements,
    )
    return draft_plan


def select_material_sources(
    *,
    plan: VisualCompositionPlan,
    request: VisualCompositionRequest,
    selection_markdown: str | None,
) -> VisualCompositionPlan:
    """Apply a reviewed Markdown material decision and prepare every prompt before I/O."""

    assets_by_id = {asset.id: asset for asset in request.assets}
    if not selection_markdown or not _selection_values(selection_markdown):
        selection_markdown = _selection_fallback(plan, request.assets)
    values = _selection_values(selection_markdown)
    used_assets: set[str] = set()
    prompts: list[VisualPromptFile] = []
    final: list[VisualPlacement] = []
    for ordinal, placement in enumerate(plan.placements, start=1):
        requested_source, reason = values.get(
            ordinal, ("generate", "未返回有效素材选择，使用安全生成回退。")
        )
        chosen_id: str | None = None
        if requested_source.lower().startswith("existing_asset"):
            _, _, candidate_id = requested_source.partition(":")
            candidate_id = candidate_id.strip()
            allowed = {candidate.asset_id for candidate in placement.candidates}
            if (
                candidate_id in assets_by_id
                and candidate_id in allowed
                and candidate_id not in used_assets
            ):
                chosen_id = candidate_id
        if chosen_id:
            used_assets.add(chosen_id)
            final.append(
                placement.model_copy(
                    update={
                        "source": "existing_asset",
                        "asset_id": chosen_id,
                        "selection_reason": reason,
                        "generation_prompt": None,
                        "prompt_file": None,
                    }
                )
            )
            continue
        slug = _slug(placement.after_heading or placement.alt, f"concept-{ordinal}")
        filename = f"{ordinal:02d}-{placement.visual_type}-{slug}.png"
        prompt_path = f"prompts/{ordinal:02d}-{placement.visual_type}-{slug}.md"
        prepared = placement.model_copy(
            update={
                "source": "generate",
                "asset_id": None,
                "selection_reason": reason,
                "prompt_file": prompt_path,
            }
        )
        prompt = _prompt_text(placement=prepared, settings=plan.settings, filename=filename)
        prepared = prepared.model_copy(update={"generation_prompt": prompt})
        prompts.append(VisualPromptFile(placement_id=prepared.id, path=prompt_path, content=prompt))
        final.append(prepared)
    return plan.model_copy(
        update={
            "material_selection_markdown": selection_markdown,
            "prompt_files": prompts,
            "placements": final,
        }
    )


def plan_visual_composition(
    _model_text: str,
    markdown: str,
    request: VisualCompositionRequest,
) -> VisualCompositionPlan:
    """Compatibility entry point used by existing callers and focused tests.

    The former JSON-only model output is intentionally ignored. New callers pass
    a native Baoyu outline to :func:`build_plan_from_outline` instead.
    """

    plan = build_plan_from_outline(
        markdown=markdown,
        request=request,
        outline_markdown=fallback_outline_markdown(markdown, request),
    )
    return select_material_sources(plan=plan, request=request, selection_markdown=None)


def fallback_visual_plan(markdown: str, request: VisualCompositionRequest) -> VisualCompositionPlan:
    return plan_visual_composition("", markdown, request)
