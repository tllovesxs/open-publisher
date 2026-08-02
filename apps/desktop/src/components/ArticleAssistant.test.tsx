import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArticleAssistant } from "./ArticleAssistant";

describe("ArticleAssistant", () => {
  it("keeps an AI rewrite as a candidate until the user applies it", async () => {
    const onRewrite = vi.fn().mockResolvedValue({
      replacement: "改写后的段落。",
      provider: "mock",
      model: "deterministic-mock-v1",
      mocked: true,
    });
    const onApplyCandidate = vi.fn().mockResolvedValue(undefined);

    render(
      <ArticleAssistant
        onApplyCandidate={onApplyCandidate}
        onClearSelection={vi.fn()}
        onRewrite={onRewrite}
        selection={{ start: 4, end: 9, text: "原始段落。" }}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("说明如何修改这段内容"), {
      target: { value: "表达更简洁" },
    });
    fireEvent.click(screen.getByRole("button", { name: "生成 AI 修改建议" }));

    expect(onApplyCandidate).not.toHaveBeenCalled();
    await screen.findByText("改写后的段落。");
    expect(onApplyCandidate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "应用修改" }));
    await waitFor(() => expect(onApplyCandidate).toHaveBeenCalledTimes(1));
    expect(onApplyCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        replacement: "改写后的段落。",
        selection: { start: 4, end: 9, text: "原始段落。" },
      }),
    );
  });
});
