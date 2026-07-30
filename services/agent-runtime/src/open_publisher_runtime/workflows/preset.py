from __future__ import annotations

import difflib
from collections.abc import Sequence
from itertools import pairwise
from typing import Any, TypedDict

from pydantic import BaseModel, ConfigDict

from open_publisher_runtime.application.model_access import (
    ModelAccessLayer,
    TextGenerationRequest,
)
from open_publisher_runtime.domain.policies import OptionalWorkflowNodeId

try:
    from langgraph.graph import END, START, StateGraph
except ImportError:  # pragma: no cover - exercised when optional extra is not installed
    END = START = StateGraph = None

MODEL_NODE_IDS = (
    "research",
    "outline",
    "draft",
    "natural-style",
    "review",
    "risk",
    "visual",
)
OPTIONAL_NODE_IDS: tuple[OptionalWorkflowNodeId, ...] = (
    "research",
    "outline",
    "natural-style",
    "review",
    "visual",
)
REQUIRED_NODE_IDS = ("draft", "risk")


class PresetWorkflowInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    topic: str
    source_markdown: str


class PresetWorkflowOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    research_report: str
    outline: str
    raw_draft: str
    canonical_markdown: str
    natural_style_patch: str
    review_report: str
    risk_report: str
    visual_plan: str
    engine: str


class WorkflowState(TypedDict):
    title: str
    topic: str
    source_markdown: str
    research_report: str
    outline: str
    raw_draft: str
    canonical_markdown: str
    review_report: str
    risk_report: str
    visual_plan: str


class PresetArticleWorkflow:
    required_model_calls = len(MODEL_NODE_IDS)

    def __init__(self, model_access: ModelAccessLayer) -> None:
        self.model_access = model_access

    @staticmethod
    def _normalize_disabled_node_ids(
        disabled_optional_node_ids: Sequence[OptionalWorkflowNodeId],
    ) -> tuple[OptionalWorkflowNodeId, ...]:
        disabled = tuple(disabled_optional_node_ids)
        if len(disabled) != len(set(disabled)):
            raise ValueError("disabled_optional_node_ids must not contain duplicates")
        unknown = set(disabled).difference(OPTIONAL_NODE_IDS)
        if unknown:
            formatted = ", ".join(sorted(unknown))
            raise ValueError(f"nodes are required or unknown and cannot be skipped: {formatted}")
        return disabled

    @classmethod
    def enabled_model_node_ids(
        cls,
        disabled_optional_node_ids: Sequence[OptionalWorkflowNodeId] = (),
    ) -> tuple[str, ...]:
        disabled = set(cls._normalize_disabled_node_ids(disabled_optional_node_ids))
        return tuple(node_id for node_id in MODEL_NODE_IDS if node_id not in disabled)

    @classmethod
    def required_model_calls_for(
        cls,
        disabled_optional_node_ids: Sequence[OptionalWorkflowNodeId] = (),
    ) -> int:
        return len(cls.enabled_model_node_ids(disabled_optional_node_ids))

    def _research(self, state: WorkflowState) -> dict[str, str]:
        response = self.model_access.generate_text(
            TextGenerationRequest(
                purpose="research",
                prompt=f"围绕「{state['topic']}」整理写作研究卡片，并标注事实边界。",
                context={
                    "title": state["title"],
                    "topic": state["topic"],
                    "source_markdown": state["source_markdown"],
                },
            )
        )
        return {"research_report": response.text}

    def _outline(self, state: WorkflowState) -> dict[str, str]:
        response = self.model_access.generate_text(
            TextGenerationRequest(
                purpose="outline",
                prompt=(
                    f"为《{state['title']}》生成结构化大纲。\n\n"
                    f"研究卡片：\n{state['research_report']}"
                ),
                context={
                    "title": state["title"],
                    "topic": state["topic"],
                    "source_markdown": state["source_markdown"],
                    "research_report": state["research_report"],
                },
            )
        )
        return {"outline": response.text}

    def _draft(self, state: WorkflowState) -> dict[str, str]:
        response = self.model_access.generate_text(
            TextGenerationRequest(
                purpose="draft",
                prompt=(
                    f"根据大纲生成 Markdown 正文。\n\n大纲：\n{state['outline']}\n\n"
                    f"素材：\n{state['source_markdown']}"
                ),
                context={
                    "title": state["title"],
                    "topic": state["topic"],
                    "source_markdown": state["source_markdown"],
                    "research_report": state["research_report"],
                    "outline": state["outline"],
                },
            )
        )
        return {"raw_draft": response.text}

    def _naturalize(self, state: WorkflowState) -> dict[str, str]:
        response = self.model_access.generate_text(
            TextGenerationRequest(
                purpose="naturalize",
                prompt=(
                    "在不改变事实和 Markdown 结构的前提下，让正文更自然、具体、克制。"
                    f"\n\n待处理正文：\n{state['raw_draft']}"
                ),
                context={
                    "title": state["title"],
                    "topic": state["topic"],
                    "source_markdown": state["raw_draft"],
                    "raw_draft": state["raw_draft"],
                },
            )
        )
        return {"canonical_markdown": response.text}

    def _review(self, state: WorkflowState) -> dict[str, str]:
        response = self.model_access.generate_text(
            TextGenerationRequest(
                purpose="review",
                prompt=f"审核以下文章并输出结构化结论：\n\n{state['canonical_markdown']}",
                context={
                    "title": state["title"],
                    "source_markdown": state["canonical_markdown"],
                },
            )
        )
        return {"review_report": response.text}

    def _risk(self, state: WorkflowState) -> dict[str, str]:
        response = self.model_access.generate_text(
            TextGenerationRequest(
                purpose="risk",
                prompt=f"只读检查以下文章的事实、合规与平台风险：\n\n{state['canonical_markdown']}",
                context={
                    "title": state["title"],
                    "source_markdown": state["canonical_markdown"],
                },
            )
        )
        return {"risk_report": response.text}

    def _visual(self, state: WorkflowState) -> dict[str, str]:
        response = self.model_access.generate_text(
            TextGenerationRequest(
                purpose="visual",
                prompt=f"只读规划以下文章的封面与正文配图：\n\n{state['canonical_markdown']}",
                context={
                    "title": state["title"],
                    "source_markdown": state["canonical_markdown"],
                },
            )
        )
        return {"visual_plan": response.text}

    def _run_sequential(self, initial: WorkflowState) -> WorkflowState:
        return self._run_sequential_customized(initial, ())

    def _run_sequential_customized(
        self,
        initial: WorkflowState,
        disabled_optional_node_ids: Sequence[OptionalWorkflowNodeId],
    ) -> WorkflowState:
        disabled = set(self._normalize_disabled_node_ids(disabled_optional_node_ids))
        if "research" not in disabled:
            initial.update(self._research(initial))
        if "outline" not in disabled:
            initial.update(self._outline(initial))
        initial.update(self._draft(initial))
        if "natural-style" in disabled:
            initial["canonical_markdown"] = initial["raw_draft"]
        else:
            initial.update(self._naturalize(initial))
        if "review" not in disabled:
            initial.update(self._review(initial))
        initial.update(self._risk(initial))
        if "visual" not in disabled:
            initial.update(self._visual(initial))
        return initial

    def _run_langgraph(
        self,
        initial: WorkflowState,
        disabled_optional_node_ids: Sequence[OptionalWorkflowNodeId],
        *,
        max_parallel: int,
    ) -> WorkflowState:
        assert StateGraph is not None and START is not None and END is not None
        disabled = set(self._normalize_disabled_node_ids(disabled_optional_node_ids))
        builder = StateGraph(WorkflowState)
        builder.add_node("draft", self._draft)
        builder.add_node("risk", self._risk)

        sequential_nodes: list[str] = []
        if "research" not in disabled:
            builder.add_node("research", self._research)
            sequential_nodes.append("research")
        if "outline" not in disabled:
            builder.add_node("outline", self._outline)
            sequential_nodes.append("outline")
        sequential_nodes.append("draft")
        if "natural-style" not in disabled:
            builder.add_node("natural-style", self._naturalize)
            sequential_nodes.append("natural-style")
        else:
            builder.add_node(
                "canonicalize-raw-draft",
                lambda state: {"canonical_markdown": state["raw_draft"]},
            )
            sequential_nodes.append("canonicalize-raw-draft")

        builder.add_edge(START, sequential_nodes[0])
        for source, target in pairwise(sequential_nodes):
            builder.add_edge(source, target)

        fanout_source = sequential_nodes[-1]
        fanout_nodes = ["risk"]
        if "review" not in disabled:
            builder.add_node("review", self._review)
            fanout_nodes.append("review")
        if "visual" not in disabled:
            builder.add_node("visual", self._visual)
            fanout_nodes.append("visual")
        for node_id in fanout_nodes:
            builder.add_edge(fanout_source, node_id)
            builder.add_edge(node_id, END)

        graph = builder.compile()
        return graph.invoke(initial, config={"max_concurrency": max_parallel})

    def run(
        self,
        workflow_input: PresetWorkflowInput,
        *,
        disabled_optional_node_ids: Sequence[OptionalWorkflowNodeId] = (),
        max_parallel: int = 4,
    ) -> PresetWorkflowOutput:
        disabled = self._normalize_disabled_node_ids(disabled_optional_node_ids)
        if not 1 <= max_parallel <= 8:
            raise ValueError("max_parallel must be between 1 and 8")
        initial: WorkflowState = {
            "title": workflow_input.title,
            "topic": workflow_input.topic,
            "source_markdown": workflow_input.source_markdown,
            "research_report": "",
            "outline": "",
            "raw_draft": "",
            "canonical_markdown": "",
            "review_report": "",
            "risk_report": "",
            "visual_plan": "",
        }
        if StateGraph is None:
            state = self._run_sequential_customized(initial, disabled)
            engine = "sequential-customized" if disabled else "sequential-fallback"
        else:
            state = self._run_langgraph(
                initial,
                disabled,
                max_parallel=max_parallel,
            )
            engine = "langgraph-customized" if disabled else "langgraph"
        natural_style_patch = "\n".join(
            difflib.unified_diff(
                state["raw_draft"].splitlines(),
                state["canonical_markdown"].splitlines(),
                fromfile="raw-draft.md",
                tofile="canonical-draft.md",
                lineterm="",
            )
        )
        return PresetWorkflowOutput(
            research_report=state["research_report"],
            outline=state["outline"],
            raw_draft=state["raw_draft"],
            canonical_markdown=state["canonical_markdown"],
            natural_style_patch=natural_style_patch,
            review_report=state["review_report"],
            risk_report=state["risk_report"],
            visual_plan=state["visual_plan"],
            engine=engine,
        )


def preset_definition() -> dict[str, Any]:
    return {
        "schema_version": "workflow.v1",
        "name": "mock-article",
        "nodes": [
            {
                "id": "research",
                "type": "agent",
                "required": False,
                "skippable": True,
                "default_enabled": True,
            },
            {
                "id": "outline",
                "type": "agent",
                "required": False,
                "skippable": True,
                "default_enabled": True,
            },
            {
                "id": "draft",
                "type": "agent",
                "required": True,
                "skippable": False,
                "default_enabled": True,
            },
            {
                "id": "natural-style",
                "type": "transform",
                "required": False,
                "skippable": True,
                "default_enabled": True,
            },
            {
                "id": "review",
                "type": "review",
                "mode": "read_only",
                "required": False,
                "skippable": True,
                "default_enabled": True,
            },
            {
                "id": "risk",
                "type": "risk_review",
                "mode": "read_only",
                "required": True,
                "skippable": False,
                "default_enabled": True,
            },
            {
                "id": "visual",
                "type": "visual_planning",
                "mode": "read_only",
                "required": False,
                "skippable": True,
                "default_enabled": True,
            },
            {
                "id": "approval",
                "type": "human_interrupt",
                "required": "by_policy",
                "skippable": True,
                "default_enabled": "by_policy",
            },
        ],
        "edges": [
            ["research", "outline"],
            ["outline", "draft"],
            ["draft", "natural-style"],
            ["natural-style", "review"],
            ["natural-style", "risk"],
            ["natural-style", "visual"],
            ["review", "approval"],
            ["risk", "approval"],
            ["visual", "approval"],
        ],
        "joins": [
            {
                "target": "approval",
                "strategy": "all_enabled",
                "branches": ["review", "risk", "visual"],
            }
        ],
        "required_model_calls": PresetArticleWorkflow.required_model_calls,
        "side_effects": "none",
    }
