import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ArticleRevisionDetail, ArticleRevisionSummary } from "../lib/desktopBridge";
import { RevisionHistoryDrawer } from "./RevisionHistoryDrawer";

const revisions: ArticleRevisionSummary[] = [
  {
    schemaVersion: "2",
    articleId: "article:history",
    revisionId: "revision:2",
    revisionNumber: 2,
    parentRevisionId: "revision:1",
    title: "当前文章",
    contentHash: `sha256:${"2".repeat(64)}`,
    createdAt: "2026-08-07T02:00:00.000Z",
    reason: "ai-rewrite",
    isCurrent: true,
  },
  {
    schemaVersion: "2",
    articleId: "article:history",
    revisionId: "revision:1",
    revisionNumber: 1,
    parentRevisionId: null,
    title: "初始文章",
    contentHash: `sha256:${"1".repeat(64)}`,
    createdAt: "2026-08-07T01:00:00.000Z",
    reason: "writer-create",
    isCurrent: false,
  },
];

describe("RevisionHistoryDrawer", () => {
  it("loads the timeline, previews an old revision, and confirms restore", async () => {
    const onList = vi.fn().mockResolvedValue(revisions);
    const onRead = vi.fn().mockResolvedValue({
      ...revisions[1],
      markdown: "# 初始文章\n\n旧版本正文。",
    } satisfies ArticleRevisionDetail);
    const onRestore = vi.fn().mockResolvedValue(undefined);

    render(
      <RevisionHistoryDrawer
        articleId="article:history"
        currentMarkdown="# 当前文章\n\n当前正文。"
        currentRevisionId="revision:2"
        onClose={vi.fn()}
        onList={onList}
        onRead={onRead}
        onRestore={onRestore}
        open
      />,
    );

    await screen.findByText("AI 修改文章");
    expect(screen.getByText("当前")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /查看版本/ })[1]);

    await screen.findByText("旧版本正文。", { exact: false });
    expect(onRead).toHaveBeenCalledWith("article:history", "revision:1");
    fireEvent.click(screen.getByRole("button", { name: "恢复到此版本" }));
    expect(screen.getByText(/当前内容会先保存/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认恢复" }));

    await waitFor(() => expect(onRestore).toHaveBeenCalledWith("article:history", "revision:1"));
    await waitFor(() => expect(onList).toHaveBeenCalledTimes(2));
  });
});
