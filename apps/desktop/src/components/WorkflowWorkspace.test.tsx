import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { WorkflowWorkspace, type WorkflowWorkspaceSnapshot } from "./WorkflowWorkspace";

const createdAt = "2026-08-02T03:15:00.000Z";

function snapshot(overrides: Partial<WorkflowWorkspaceSnapshot> = {}): WorkflowWorkspaceSnapshot {
  return {
    runId: "run-workspace-1",
    status: "running",
    events: [
      {
        id: "draft-started",
        eventType: "run.node_started",
        nodeId: "draft",
        createdAt,
      },
      {
        id: "source-search",
        eventType: "run.node_tool_called",
        nodeId: "draft",
        createdAt,
        toolName: "web_search",
        toolQuery: "Open Publisher local-first writing",
        sources: [
          {
            sourceId: "source-1",
            title: "Open Publisher release notes",
            url: "https://example.test/releases",
            excerpt: "A bounded source excerpt shown without raw tool payloads.",
            publishedDate: "2026-08-01",
          },
        ],
      },
      {
        id: "draft-delta",
        eventType: "run.node_output_delta",
        nodeId: "draft",
        createdAt,
        draftDelta: "This writer output remains in the editor, not a timeline card.",
      },
    ],
    artifacts: [{ id: "artifact-outline-1", kind: "workflow.outline" }],
    visualPlan: null,
    updatedAt: new Date(createdAt).getTime(),
    ...overrides,
  };
}

describe("WorkflowWorkspace", () => {
  it("opens active work, aggregates reviewed sources, and keeps writer deltas out of the timeline", () => {
    render(<WorkflowWorkspace snapshot={snapshot()} />);

    expect(screen.getByRole("tab", { name: /过程 2/ })).toBeVisible();
    expect(screen.getByText("正文正在流式写入")).toBeVisible();
    expect(screen.queryByText(/This writer output remains/)).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /来源 1/ }));
    const source = screen.getByRole("link", { name: "Open Publisher release notes" });
    expect(source).toHaveAttribute("href", "https://example.test/releases");
    expect(screen.getByText("example.test")).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: /产物 1/ }));
    expect(screen.getByText("文章大纲")).toBeVisible();
  });

  it("shows a retry action for a failed run when the caller can retry", () => {
    const onRetry = vi.fn();
    render(
      <WorkflowWorkspace
        onRetry={onRetry}
        retryable
        snapshot={snapshot({ status: "failed", error: "The model connection timed out." })}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("The model connection timed out.");
    fireEvent.click(screen.getByRole("button", { name: "重试本次生成" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
