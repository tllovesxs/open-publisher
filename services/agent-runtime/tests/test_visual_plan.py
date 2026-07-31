from open_publisher_runtime.domain.policies import VisualAssetInstruction, VisualCompositionRequest
from open_publisher_runtime.workflows.visual_plan import (
    auto_image_count,
    plan_visual_composition,
)

MARKDOWN = """# 配图文章

开场说明。

## 背景

解释问题。

## 实践

说明执行方法。

## 总结

收束全文。
"""


def test_visual_plan_uses_selected_assets_then_generates_the_missing_slots() -> None:
    request = VisualCompositionRequest(
        mode="fixed",
        target_count=3,
        assets=[
            VisualAssetInstruction(
                id="media-1",
                alt="产品结构示意图",
                description="展示三个模块之间的数据流向。",
            )
        ],
    )

    plan = plan_visual_composition("not valid JSON", MARKDOWN, request)

    assert plan.target_count == 3
    assert plan.placements[0].asset_id == "media-1"
    assert plan.placements[0].generation_prompt is None
    assert [placement.after_heading for placement in plan.placements] == [
        "配图文章",
        "背景",
        "实践",
    ]
    assert all(
        placement.generation_prompt
        for placement in plan.placements[1:]
    )


def test_visual_plan_accepts_only_a_safe_model_plan() -> None:
    request = VisualCompositionRequest(
        mode="fixed",
        target_count=2,
        assets=[
            VisualAssetInstruction(
                id="media-1",
                alt="模块关系图",
                description="三层模块和双向连接。",
            )
        ],
    )
    model_text = """{
      "target_count": 2,
      "placements": [
        {
          "after_heading": "背景",
          "asset_id": "media-1",
          "alt": "模块关系图",
          "generation_prompt": null
        },
        {
          "after_heading": "实践",
          "asset_id": null,
          "alt": "实践流程配图",
          "generation_prompt": "展示可回滚的执行流程，不含文字和品牌。"
        }
      ]
    }"""

    plan = plan_visual_composition(model_text, MARKDOWN, request)

    assert plan.placements[0].after_heading == "背景"
    assert plan.placements[1].generation_prompt


def test_auto_visual_plan_scales_from_completed_markdown_length() -> None:
    assert auto_image_count("短文") == 1
    assert auto_image_count("字" * 1_500) == 2
    assert auto_image_count("字" * 3_000) == 3
    assert auto_image_count("字" * 4_000) == 4
