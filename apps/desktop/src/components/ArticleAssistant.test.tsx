import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArticleAssistant, type MarkdownSelection } from "./ArticleAssistant";

const selected: MarkdownSelection = { start: 4, end: 9, text: "原始段落。" };

function renderAssistant(overrides: Partial<React.ComponentProps<typeof ArticleAssistant>> = {}) {
  const onRewrite = vi.fn().mockResolvedValue({
    replacements: ["改写后的段落。"],
    summary: "已压缩重复表达，并保留原有结论。",
    provider: "mock",
    model: "deterministic-mock-v1",
    mocked: true,
  });
  const onApplyCandidate = vi.fn().mockResolvedValue({
    revisionId: "revision-rewrite-1",
    markdown: "改写后的段落。",
  });
  const onUndoLastRewrite = vi.fn().mockResolvedValue(undefined);
  const onRemoveSelection = vi.fn();
  const onComposeVisual = vi.fn().mockImplementation(async (_instruction, _conversation, onActivity) => {
    onActivity({
      title: "正在插入配图",
      detail: "视觉 Agent 正在匹配文章段落。",
      value: 64,
    });
    return { summary: "已按文章结构插入 2 张配图。" };
  });
  render(
    <ArticleAssistant
      articleId="article-test"
      canUndo={false}
      onApplyCandidate={onApplyCandidate}
      onClearSelections={vi.fn()}
      onRemoveSelection={onRemoveSelection}
      onRewrite={onRewrite}
      onComposeVisual={onComposeVisual}
      onUndoLastRewrite={onUndoLastRewrite}
      selections={[selected]}
      {...overrides}
    />,
  );
  return { onRewrite, onComposeVisual, onApplyCandidate, onUndoLastRewrite, onRemoveSelection };
}

describe("ArticleAssistant", () => {
  beforeEach(() => window.localStorage.clear());

  it("applies an AI rewrite directly and retains the article conversation", async () => {
    const { onRewrite, onApplyCandidate } = renderAssistant();

    fireEvent.change(screen.getByPlaceholderText("说明如何修改这些片段"), {
      target: { value: "表达更简洁" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用 AI 修改" }));

    await waitFor(() => expect(onApplyCandidate).toHaveBeenCalledTimes(1));
    expect(onApplyCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        replacements: ["改写后的段落。"],
        selections: [selected],
      }),
    );
    expect(onRewrite).toHaveBeenCalledWith(
      "表达更简洁",
      [selected],
      [],
      expect.stringMatching(/^rewrite-/),
    );
    expect(await screen.findByText(/已同步修改正文/)).toBeVisible();
    expect(window.localStorage.getItem("open-publisher.article-assistant.article-test")).toContain("表达更简洁");
  });

  it("shows selected fragments with a removable chip", () => {
    const { onRemoveSelection } = renderAssistant({
      selections: [selected, { start: 12, end: 16, text: "第二段内容" }],
    });

    expect(screen.getByText("2 个已选文本片段")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "移除已选片段 2" }));
    expect(onRemoveSelection).toHaveBeenCalledWith({
      start: 12,
      end: 16,
      text: "第二段内容",
    });
  });

  it("does not move focus away from an editor when text fragments become active", () => {
    const requestAnimationFrame = vi.spyOn(window, "requestAnimationFrame");
    const { rerender } = render(
      <>
        <textarea aria-label="Markdown 正文" />
        <ArticleAssistant
          articleId="focus-test"
          canUndo={false}
          onApplyCandidate={vi.fn()}
          onClearSelections={vi.fn()}
          onRemoveSelection={vi.fn()}
          onRewrite={vi.fn()}
          onComposeVisual={vi.fn()}
          onUndoLastRewrite={vi.fn()}
          selections={[]}
        />
      </>,
    );
    const editor = screen.getByLabelText("Markdown 正文");
    editor.focus();

    rerender(
      <>
        <textarea aria-label="Markdown 正文" />
        <ArticleAssistant
          articleId="focus-test"
          canUndo={false}
          onApplyCandidate={vi.fn()}
          onClearSelections={vi.fn()}
          onRemoveSelection={vi.fn()}
          onRewrite={vi.fn()}
          onComposeVisual={vi.fn()}
          onUndoLastRewrite={vi.fn()}
          selections={[{ start: 0, end: 4, text: "待修改文字" }]}
        />
      </>,
    );

    expect(editor).toHaveFocus();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    requestAnimationFrame.mockRestore();
  });

  it("keeps the active workflow controls inside the AI assistant", async () => {
    const onCancelWorkflow = vi.fn();
    renderAssistant({
      onCancelWorkflow,
      workflowRunning: true,
      workflowProgress: {
        title: "正在撰写正文",
        detail: "写作 Agent 正在输出正文。",
        value: 42,
      },
      workflowSnapshot: {
        runId: "run-article-assistant",
        status: "running",
        events: [{
          id: "research-completed",
          eventType: "run.node_completed",
          nodeId: "research",
          createdAt: "2026-08-04T12:00:00.000Z",
        }, {
          id: "research-degraded",
          eventType: "run.node_research_degraded",
          nodeId: "draft",
          createdAt: "2026-08-04T12:00:01.000Z",
        }],
        artifacts: [],
        visualPlan: null,
        updatedAt: Date.now(),
      },
    });

    expect(await screen.findByText("正在撰写正文")).toBeVisible();
    expect(screen.getByText("公开资料已完成")).toBeVisible();
    expect(screen.getByText("外部资料不可用，已按现有资料继续")).toBeVisible();
    expect(screen.getByLabelText("进度 42%")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "停止生成" }));
    expect(onCancelWorkflow).toHaveBeenCalledOnce();
  });

  it("does not render a cached running snapshot when no workflow is active", () => {
    renderAssistant({
      workflowRunning: false,
      workflowSnapshot: {
        runId: "stale-run",
        status: "running",
        events: [{
          id: "stale-queued",
          eventType: "run.queued",
          nodeId: null,
          createdAt: "2026-08-04T12:00:00.000Z",
        }],
        artifacts: [],
        visualPlan: null,
        updatedAt: Date.now() - 60_000,
      },
    });

    expect(screen.queryByText("正在准备本次创作")).not.toBeInTheDocument();
  });

  it("hides skipped implementation stages from the live activity", () => {
    renderAssistant({
      workflowRunning: true,
      workflowSnapshot: {
        runId: "active-run",
        status: "running",
        events: [
          {
            id: "research-skipped",
            eventType: "run.node_skipped",
            nodeId: "research",
            createdAt: "2026-08-04T12:00:00.000Z",
          },
          {
            id: "draft-started",
            eventType: "run.node_started",
            nodeId: "draft",
            createdAt: "2026-08-04T12:00:01.000Z",
          },
        ],
        artifacts: [],
        visualPlan: null,
        updatedAt: Date.now(),
      },
    });

    expect(screen.getByText("正在撰写正文")).toBeVisible();
    expect(screen.queryByText(/已跳过/)).not.toBeInTheDocument();
  });

  it("collapses completed creation activity into a process summary", () => {
    renderAssistant({
      workflowRunning: false,
      workflowSnapshot: {
        runId: "completed-run",
        status: "completed",
        events: [
          {
            id: "research-tool",
            eventType: "run.node_tool_called",
            nodeId: "research",
            toolName: "web_search",
            createdAt: "2026-08-04T12:00:00.000Z",
          },
          {
            id: "draft-completed",
            eventType: "run.node_completed",
            nodeId: "draft",
            createdAt: "2026-08-04T12:00:01.000Z",
          },
          {
            id: "review-skipped",
            eventType: "run.node_skipped",
            nodeId: "review",
            createdAt: "2026-08-04T12:00:02.000Z",
          },
        ],
        artifacts: [],
        visualPlan: null,
        updatedAt: Date.now(),
      },
    });

    expect(screen.getByText("创作过程")).toBeVisible();
    expect(screen.getByText("1 项完成 · 1 次资料读取")).toBeVisible();
    expect(screen.queryByText(/已跳过/)).not.toBeInTheDocument();
  });

  it("dispatches illustration requests to the visual Agent instead of rewriting text", async () => {
    const { onComposeVisual, onRewrite } = renderAssistant();

    fireEvent.change(screen.getByPlaceholderText("说明如何修改这些片段"), {
      target: { value: "给文章配两张插图，并插入合适的段落" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用 AI 修改" }));

    await waitFor(() => expect(onComposeVisual).toHaveBeenCalledOnce());
    expect(onComposeVisual).toHaveBeenCalledWith(
      "给文章配两张插图，并插入合适的段落",
      [],
      expect.any(Function),
      undefined,
      undefined,
      false,
      [selected],
    );
    expect(onRewrite).not.toHaveBeenCalled();
    expect(await screen.findByText("已按文章结构插入 2 张配图。")).toBeVisible();
  });

  it("anchors a one-image request to the selected paragraph instead of treating it as a text rewrite", async () => {
    const { onComposeVisual, onRewrite, onRemoveSelection } = renderAssistant();

    fireEvent.change(screen.getByPlaceholderText("说明如何修改这些片段"), {
      target: { value: "给这一段配一张图" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用 AI 修改" }));

    await waitFor(() => expect(onComposeVisual).toHaveBeenCalledOnce());
    expect(onComposeVisual).toHaveBeenCalledWith(
      "给这一段配一张图",
      [],
      expect.any(Function),
      undefined,
      undefined,
      false,
      [selected],
    );
    expect(onRewrite).not.toHaveBeenCalled();
    expect(onRemoveSelection).toHaveBeenCalledWith(selected);
  });

  it("treats an instruction that protects images as a text rewrite", async () => {
    const { onComposeVisual, onRewrite } = renderAssistant();

    fireEvent.change(screen.getByPlaceholderText("说明如何修改这些片段"), {
      target: { value: "把这一段写得更自然，但不要动图片" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用 AI 修改" }));

    await waitFor(() => expect(onRewrite).toHaveBeenCalledOnce());
    expect(onComposeVisual).not.toHaveBeenCalled();
  });

  it("rewrites text first and then refreshes images when both are requested", async () => {
    const { onComposeVisual, onRewrite, onApplyCandidate } = renderAssistant({
      selections: [],
    });
    onApplyCandidate.mockResolvedValue({
      revisionId: "revision-rewrite-2",
      markdown: "# 新正文\n\n内容已经重写。",
    });

    fireEvent.change(screen.getByPlaceholderText("说说你想怎么改"), {
      target: { value: "重写全文，并同步修改配图" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用 AI 修改" }));

    await waitFor(() => expect(onComposeVisual).toHaveBeenCalledOnce());
    expect(onRewrite).toHaveBeenCalledOnce();
    expect(onComposeVisual).toHaveBeenCalledWith(
      "重写全文，并同步修改配图",
      [],
      expect.any(Function),
      "# 新正文\n\n内容已经重写。",
      "revision-rewrite-2",
      true,
    );
  });

  it("renders a failed workflow as an inline activity card with retry details", () => {
    const onRetryWorkflow = vi.fn();
    renderAssistant({
      workflowFailure: {
        detail: "视觉模型请求超时",
        logs: [{
          id: "visual-timeout",
          timestamp: Date.now(),
          message: "已等待视觉模型 60 秒",
          tone: "error",
        }],
        retryable: true,
      },
      workflowRetryable: true,
      onRetryWorkflow,
    });

    expect(screen.getByText("本次工作流未完成")).toBeVisible();
    expect(screen.getByText("视觉模型请求超时")).toBeVisible();
    fireEvent.click(screen.getByText("查看执行记录"));
    expect(screen.getByText("已等待视觉模型 60 秒")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重试这次工作流" }));
    expect(onRetryWorkflow).toHaveBeenCalledOnce();
  });
});
