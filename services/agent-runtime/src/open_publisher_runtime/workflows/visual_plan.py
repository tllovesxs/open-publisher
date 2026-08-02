"""Backward-compatible imports for the Baoyu visual planning workflow."""

from open_publisher_runtime.workflows.baoyu_article_illustrator import (
    VisualCompositionPlan,
    VisualPlacement,
    auto_image_count,
    fallback_visual_plan,
    plan_visual_composition,
    target_image_count,
)

__all__ = [
    "VisualCompositionPlan",
    "VisualPlacement",
    "auto_image_count",
    "fallback_visual_plan",
    "plan_visual_composition",
    "target_image_count",
]
