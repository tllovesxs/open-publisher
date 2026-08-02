import hashlib

from open_publisher_runtime.domain.policies import (
    VisualAssetInstruction,
    VisualCompositionRequest,
)
from open_publisher_runtime.workflows.baoyu_article_illustrator import (
    build_plan_from_outline,
    markdown_blocks,
    read_baoyu_resource,
    read_baoyu_resource_bytes,
    select_material_sources,
)
from open_publisher_runtime.workflows.visual_plan import auto_image_count, plan_visual_composition

MARKDOWN = """# 配图文章

开场说明。

## 系统架构

采集、编排、发布三层通过可追踪的数据流协作，确保每一步都有明确的边界。

```python
never_target_this_code_block()
```

- 也不要把列表作为图片锚点

## 实践

从一个可回滚的发布流程开始，记录草稿、审核和最终发布的状态变化。
"""


def test_bundled_baoyu_skill_is_pinned_and_verbatim() -> None:
    skill = read_baoyu_resource("SKILL.md")
    revision = read_baoyu_resource("REVISION")

    assert "name: baoyu-article-illustrator" in skill
    assert "upstream_commit=6b7a2e417500561a5ecdd0b168332f4142584617" in revision
    assert hashlib.sha256(read_baoyu_resource_bytes("SKILL.md")).hexdigest() == (
        "5f99fc77bdf524fe0cfff36f17844ce6425ae2c45cb139836fe77727dcb65370"
    )


def test_block_index_uses_safe_paragraph_anchors() -> None:
    blocks = markdown_blocks(MARKDOWN)

    assert len(blocks) == 3
    assert blocks[1].heading == "系统架构"
    assert "采集、编排、发布三层" in blocks[1].excerpt
    assert all("code_block" not in block.text for block in blocks)
    assert all("列表" not in block.text for block in blocks)
    assert len({block.id for block in blocks}) == len(blocks)


def test_native_outline_selects_matching_material_once_and_saves_prompt_before_generation() -> None:
    request = VisualCompositionRequest(
        mode="fixed",
        target_count=2,
        assets=[
            VisualAssetInstruction(
                id="media-architecture",
                alt="三层产品架构图",
                description="采集、编排、发布三个模块之间有清晰的数据流向。",
            ),
            VisualAssetInstruction(
                id="media-unrelated",
                alt="海边照片",
                description="晴天的海岸风景。",
            ),
        ],
    )
    outline = """---
type: framework
density: balanced
style: sketch-notes
palette: macaron
image_count: 2
---

## Illustration 1
**Position**: 系统架构 / 采集、编排、发布三层通过可追踪的数据流协作
**Purpose**: 解释三层之间的数据流。
**Visual Content**: 采集、编排、发布三层模块和数据流向的框架图。
**Type Application**: 用框架图表达依赖关系。
**Filename**: 01-framework-data-flow.png

## Illustration 2
**Position**: 实践 / 从一个可回滚的发布流程开始
**Purpose**: 解释可回滚的执行步骤。
**Visual Content**: 草稿、审核、发布、回滚状态之间的流程图。
**Type Application**: 用流程图表达状态变化。
**Filename**: 02-flowchart-release-loop.png
"""

    plan = build_plan_from_outline(markdown=MARKDOWN, request=request, outline_markdown=outline)
    selection = """# Material selection

## Illustration 1
**Source**: existing_asset: media-architecture
**Reason**: 这张素材准确描述了三个模块和数据流向。

## Illustration 2
**Source**: generate
**Reason**: 现有素材没有表达发布流程和回滚状态。
"""

    selected = select_material_sources(plan=plan, request=request, selection_markdown=selection)

    assert selected.placements[0].block_id is not None
    assert selected.placements[0].source == "existing_asset"
    assert selected.placements[0].asset_id == "media-architecture"
    assert selected.placements[1].source == "generate"
    assert selected.placements[1].prompt_file
    assert len(selected.prompt_files) == 1
    assert selected.prompt_files[0].placement_id == "illustration-2"
    assert "ZONES:" in selected.prompt_files[0].content
    assert "STYLE:" in selected.prompt_files[0].content
    assert "ASPECT:" in selected.prompt_files[0].content


def test_visual_plan_requires_confirmation_unless_the_request_explicitly_skips_it() -> None:
    outline = """---
type: framework
density: balanced
style: sketch-notes
palette: macaron
image_count: 1
---

## Illustration 1
**Position**: 系统架构 / 采集、编排、发布三层通过可追踪的数据流协作
**Purpose**: 解释系统边界。
**Visual Content**: 三层系统的边界和数据流向。
**Type Application**: 用框架图表达模块关系。
**Filename**: 01-framework-boundaries.png
"""
    default_plan = build_plan_from_outline(
        markdown=MARKDOWN,
        request=VisualCompositionRequest(mode="fixed", target_count=1),
        outline_markdown=outline,
    )
    skipped_plan = build_plan_from_outline(
        markdown=MARKDOWN,
        request=VisualCompositionRequest(
            mode="fixed",
            target_count=1,
            skip_confirmation=True,
        ),
        outline_markdown=outline,
    )

    assert default_plan.needs_confirmation is True
    assert skipped_plan.needs_confirmation is False


def test_invalid_or_unrelated_material_selection_falls_back_to_generation_without_duplicates() -> (
    None
):
    request = VisualCompositionRequest(
        mode="fixed",
        target_count=2,
        assets=[
            VisualAssetInstruction(
                id="media-unrelated",
                alt="海边照片",
                description="晴天的海岸风景。",
            )
        ],
    )
    plan = plan_visual_composition("obsolete json output", MARKDOWN, request)

    assert [placement.source for placement in plan.placements] == ["generate", "generate"]
    assert len(plan.prompt_files) == 2
    assert len({item.path for item in plan.prompt_files}) == 2
    assert (
        plan.source_revision_hash
        != hashlib.sha256((MARKDOWN + "\n修改").encode("utf-8")).hexdigest()
    )


def test_auto_visual_plan_scales_from_completed_markdown_length() -> None:
    assert auto_image_count("短文") == 1
    assert auto_image_count("字" * 1_500) == 2
    assert auto_image_count("字" * 3_000) == 3
    assert auto_image_count("字" * 4_000) == 4
