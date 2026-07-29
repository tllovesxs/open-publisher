from __future__ import annotations

from typing import Any, TypedDict

from pydantic import BaseModel, ConfigDict

from open_publisher_runtime.application.model_access import (
    ModelAccessLayer,
    TextGenerationRequest,
)

try:
    from langgraph.graph import END, START, StateGraph
except ImportError:  # pragma: no cover - exercised when optional extra is not installed
    END = START = StateGraph = None


class PresetWorkflowInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    topic: str
    source_markdown: str


class PresetWorkflowOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outline: str
    canonical_markdown: str
    review_report: str
    engine: str


class WorkflowState(TypedDict):
    title: str
    topic: str
    source_markdown: str
    outline: str
    canonical_markdown: str
    review_report: str


class PresetArticleWorkflow:
    def __init__(self, model_access: ModelAccessLayer) -> None:
        self.model_access = model_access

    def _outline(self, state: WorkflowState) -> dict[str, str]:
        response = self.model_access.generate_text(
            TextGenerationRequest(
                purpose="outline",
                prompt=f"为《{state['title']}》生成结构化大纲。",
                context={
                    "title": state["title"],
                    "topic": state["topic"],
                    "source_markdown": state["source_markdown"],
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

    def _run_sequential(self, initial: WorkflowState) -> WorkflowState:
        initial.update(self._outline(initial))
        initial.update(self._draft(initial))
        initial.update(self._review(initial))
        return initial

    def _run_langgraph(self, initial: WorkflowState) -> WorkflowState:
        assert StateGraph is not None and START is not None and END is not None
        builder = StateGraph(WorkflowState)
        builder.add_node("outline", self._outline)
        builder.add_node("draft", self._draft)
        builder.add_node("review", self._review)
        builder.add_edge(START, "outline")
        builder.add_edge("outline", "draft")
        builder.add_edge("draft", "review")
        builder.add_edge("review", END)
        graph = builder.compile()
        return graph.invoke(initial)

    def run(self, workflow_input: PresetWorkflowInput) -> PresetWorkflowOutput:
        initial: WorkflowState = {
            "title": workflow_input.title,
            "topic": workflow_input.topic,
            "source_markdown": workflow_input.source_markdown,
            "outline": "",
            "canonical_markdown": "",
            "review_report": "",
        }
        if StateGraph is None:
            state = self._run_sequential(initial)
            engine = "sequential-fallback"
        else:
            state = self._run_langgraph(initial)
            engine = "langgraph"
        return PresetWorkflowOutput(
            outline=state["outline"],
            canonical_markdown=state["canonical_markdown"],
            review_report=state["review_report"],
            engine=engine,
        )


def preset_definition() -> dict[str, Any]:
    return {
        "schema_version": "workflow.v1",
        "name": "mock-article",
        "nodes": [
            {"id": "outline", "type": "agent", "skippable": True},
            {"id": "draft", "type": "agent", "skippable": False},
            {"id": "review", "type": "review", "skippable": True},
            {"id": "approval", "type": "human_interrupt", "skippable": True},
        ],
        "edges": [
            ["outline", "draft"],
            ["draft", "review"],
            ["review", "approval"],
        ],
        "side_effects": "none",
    }

