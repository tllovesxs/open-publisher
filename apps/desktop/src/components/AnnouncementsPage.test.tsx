import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const openExternalUrlMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock("../lib/externalLinks", () => ({
  externalLinkClickHandler: (url: string) => (event: { preventDefault: () => void }) => {
    event.preventDefault();
    void openExternalUrlMock(url);
    return true;
  },
  openExternalUrl: openExternalUrlMock,
}));
import { AnnouncementsPage } from "./AnnouncementsPage";

describe("AnnouncementsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    openExternalUrlMock.mockClear();
  });

  it("keeps the embedded publishing tutorial readable when the repository is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    render(<AnnouncementsPage />);

    expect(screen.getByRole("heading", { name: "发布教程" })).toBeVisible();
    await screen.findByText("使用内置教程");
    expect(screen.getByRole("heading", { name: "如何添加文章同步发布功能" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "稿流发布使用教程" })).toBeVisible();
    expect(screen.getByRole("img", { name: "点击文章同步助手右上角的设置" })).toHaveAttribute(
      "src",
      "https://raw.githubusercontent.com/tllovesxs/open-publisher/main/docs/integrations/images/wechatsync-open-settings.png",
    );
    expect(screen.getByText(/本次同步未完成：offline/)).toBeVisible();

    fireEvent.click(screen.getByRole("link", { name: /在 GitHub 查看/ }));
    expect(openExternalUrlMock).toHaveBeenCalledWith(
      "https://github.com/tllovesxs/open-publisher/blob/main/docs/integrations/wechatsync-publishing-guide.md",
    );

    fireEvent.click(screen.getByRole("link", { name: "文章同步助手官网" }));
    expect(openExternalUrlMock).toHaveBeenCalledWith(
      "https://www.wechatsync.com/?utm_source=extension_about",
    );
  });

  it("loads a remote manifest and its selected Markdown document", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          version: 1,
          updatedAt: "2026-08-05",
          items: [{
            id: "wechatsync-publishing-guide",
            type: "tutorial",
            title: "远端发布教程",
            summary: "来自项目仓库",
            date: "2026-08-07",
            path: "docs/integrations/wechatsync-publishing-guide.md",
          }],
        }),
      })
      .mockResolvedValueOnce({ ok: true, text: async () => "# 远端发布教程\n\n正文已经同步。\n\n![教程截图](./images/wechatsync-open-settings.png)" })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          version: 1,
          updatedAt: "2026-08-05",
          items: [{
            id: "wechatsync-publishing-guide",
            type: "tutorial",
            title: "远端发布教程",
            summary: "来自项目仓库",
            date: "2026-08-07",
            path: "docs/integrations/wechatsync-publishing-guide.md",
          }],
        }),
      })
      .mockResolvedValueOnce({ ok: true, text: async () => "# 远端发布教程\n\n正文已经同步。\n\n![教程截图](./images/wechatsync-open-settings.png)" });
    vi.stubGlobal("fetch", fetchMock);

    render(<AnnouncementsPage />);

    expect(await screen.findByRole("heading", { name: "远端发布教程" })).toBeVisible();
    expect(await screen.findByText("正文已经同步。")).toBeVisible();
    expect(screen.getByRole("img", { name: "教程截图" })).toHaveAttribute(
      "src",
      "https://raw.githubusercontent.com/tllovesxs/open-publisher/main/docs/integrations/images/wechatsync-open-settings.png",
    );
    expect(screen.getByText("已从 GitHub 同步")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "刷新教程" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  });
});
