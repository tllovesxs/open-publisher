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
  const onApplyCandidate = vi.fn().mockResolvedValue(undefined);
  const onUndoLastRewrite = vi.fn().mockResolvedValue(undefined);
  const onRemoveSelection = vi.fn();
  render(
    <ArticleAssistant
      articleId="article-test"
      canUndo={false}
      onApplyCandidate={onApplyCandidate}
      onClearSelections={vi.fn()}
      onRemoveSelection={onRemoveSelection}
      onRewrite={onRewrite}
      onUndoLastRewrite={onUndoLastRewrite}
      selections={[selected]}
      {...overrides}
    />,
  );
  return { onRewrite, onApplyCandidate, onUndoLastRewrite, onRemoveSelection };
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
      workflowProgress: {
        title: "正在撰写正文",
        detail: "写作 Agent 正在输出正文。",
        value: 42,
      },
      workflowSnapshot: {
        runId: "run-article-assistant",
        status: "running",
        events: [],
        artifacts: [],
        visualPlan: null,
        updatedAt: Date.now(),
      },
    });

    expect(await screen.findByText("正在撰写正文")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "停止生成" }));
    expect(onCancelWorkflow).toHaveBeenCalledOnce();
  });
});
