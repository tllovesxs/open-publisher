import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import type { WorkflowActivityEvent } from "../lib/desktopBridge";
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
    const windowOpen = vi.spyOn(window, "open").mockReturnValue(null);
    render(<WorkflowWorkspace snapshot={snapshot()} />);

    expect(screen.getByRole("tab", { name: /创作进度 2/ })).toBeVisible();
    expect(screen.getByText("正文正在流式写入")).toBeVisible();
    expect(screen.queryByText(/This writer output remains/)).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: /参考资料 1/ }));
    const source = screen.getByRole("link", { name: "Open Publisher release notes" });
    expect(source).toHaveAttribute("href", "https://example.test/releases");
    fireEvent.click(source);
    expect(windowOpen).toHaveBeenCalledWith(
      "https://example.test/releases",
      "_blank",
      "noopener,noreferrer",
    );
    expect(screen.getByText("example.test")).toBeVisible();
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

  it("uses a compact current-task card when embedded in the AI sidebar", () => {
    const onCancel = vi.fn();
    render(
      <WorkflowWorkspace
        embedded
        onCancel={onCancel}
        progress={{ title: "正在撰写正文", detail: "写作 Agent 正在输出正文。", value: 42 }}
        snapshot={snapshot()}
      />,
    );

    expect(screen.getByRole("region", { name: "当前 AI 任务" })).toHaveTextContent("当前任务");
    expect(screen.getByText("正在撰写正文")).toBeVisible();
    expect(screen.queryByText("AI 创作动态")).toBeNull();
    expect(screen.queryByRole("tab", { name: /创作进度/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "停止生成" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("keeps the article panel usable when a persisted activity event is malformed", () => {
    render(
      <WorkflowWorkspace
        embedded
        snapshot={{
          ...snapshot(),
          events: [{ id: "legacy-event", eventType: "run.node_output_delta", nodeId: "draft", createdAt: "invalid", draftDelta: { legacy: true } }] as unknown as WorkflowActivityEvent[],
          updatedAt: Number.NaN,
        }}
      />,
    );

    expect(screen.getByRole("region", { name: "当前 AI 任务" })).toBeVisible();
  });

  it("keeps rendering an activity event when its persisted timestamp is invalid", () => {
    render(
      <WorkflowWorkspace
        snapshot={snapshot({
          events: [{
            id: "legacy-started",
            eventType: "run.node_started",
            nodeId: "reference-safety",
            createdAt: "not-a-date",
          }],
        })}
      />,
    );

    expect(screen.getAllByText("资料核验正在处理")).toHaveLength(2);
    expect(screen.getByText("刚刚")).toBeVisible();
  });
});
