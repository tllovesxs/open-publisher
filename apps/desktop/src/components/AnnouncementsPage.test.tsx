import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnouncementsPage } from "./AnnouncementsPage";

describe("AnnouncementsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the embedded announcement readable when the repository is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    render(<AnnouncementsPage />);

    expect(screen.getByRole("heading", { name: "公告与教程" })).toBeVisible();
    await screen.findByText("使用内置公告");
    expect(screen.getAllByRole("heading", { name: /稿流正在构建/ })).toHaveLength(2);
    expect(screen.getByText(/本次同步未完成：offline/)).toBeVisible();
  });

  it("loads a remote manifest and its selected Markdown document", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          version: 1,
          updatedAt: "2026-08-05",
          items: [{
            id: "remote-notice",
            type: "announcement",
            title: "远端公告",
            summary: "来自项目仓库",
            date: "2026-08-05",
            path: "docs/announcements/remote-notice.md",
          }],
        }),
      })
      .mockResolvedValueOnce({ ok: true, text: async () => "# 远端公告\n\n正文已经同步。" })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          version: 1,
          updatedAt: "2026-08-05",
          items: [{
            id: "remote-notice",
            type: "announcement",
            title: "远端公告",
            summary: "来自项目仓库",
            date: "2026-08-05",
            path: "docs/announcements/remote-notice.md",
          }],
        }),
      })
      .mockResolvedValueOnce({ ok: true, text: async () => "# 远端公告\n\n正文已经同步。" });
    vi.stubGlobal("fetch", fetchMock);

    render(<AnnouncementsPage />);

    expect(await screen.findByRole("heading", { name: "远端公告" })).toBeVisible();
    expect(await screen.findByText("正文已经同步。")).toBeVisible();
    expect(screen.getByText("已从 GitHub 同步")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "刷新公告" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  });
});
