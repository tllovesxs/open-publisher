import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PublishDialog } from "./PublishDialog";
import type { Article } from "../types";

const article: Article = {
  id: "article-1",
  title: "本地优先发布",
  deck: "测试摘要",
  markdown: "# 本地优先发布",
  status: "ready" as const,
  updatedAt: "刚刚",
  wordCount: 120,
  channels: ["csdn", "wechat"],
  collection: "草稿",
};

const platforms = [
  { id: "wechat" as const, name: "微信公众号", shortName: "微信", limit: "", status: "connected" as const },
  { id: "csdn" as const, name: "CSDN", shortName: "CSDN", limit: "", status: "connected" as const },
  { id: "toutiao" as const, name: "今日头条", shortName: "头条", limit: "", status: "not_connected" as const },
];

describe("PublishDialog", () => {
  it("selects only authenticated platforms and makes the draft boundary explicit", () => {
    render(
      <PublishDialog
        article={article}
        bridge={{
          available: true,
          connected: true,
          state: "connected",
          detail: "WechatSync 已连接；登录状态来自浏览器扩展。",
          platforms: [
            { id: "wechat", authenticated: true, accountLabel: null },
            { id: "csdn", authenticated: true, accountLabel: null },
            { id: "toutiao", authenticated: false, accountLabel: null },
          ],
        }}
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        open
        platforms={platforms}
        publishing={false}
        refreshing={false}
      />,
    );

    expect(screen.getByText("WechatSync 已连接")).toBeVisible();
    expect(screen.getByText(/最终发布、验证码和平台二次确认/)).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /微信公众号/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /CSDN/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /今日头条/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /CSDN/ }));
    expect(screen.getByRole("button", { name: "同步到 1 个草稿" })).toBeEnabled();
  });

  it("keeps a stale bridge snapshot read-only while the extension reconnects", () => {
    render(
      <PublishDialog
        article={article}
        bridge={{
          available: false,
          connected: false,
          state: "extension_waiting",
          stale: true,
          detail: "本地桥正在恢复连接。",
          platforms: [{ id: "csdn", authenticated: true, accountLabel: "demo" }],
        }}
        onClose={vi.fn()}
        onOpenSettings={vi.fn()}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
        open
        platforms={platforms}
        publishing={false}
        refreshing={false}
      />,
    );

    expect(screen.getByText(/连接正在恢复/)).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /CSDN/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /同步到/ })).toBeDisabled();
  });
});
