import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";

describe("SettingsPage publisher bridge", () => {
  it("lets the user save the extension WebSocket address and token", () => {
    const onConfigurePublisherBridge = vi.fn();
    render(
      <SettingsPage
        configuring={false}
        configuringPublisherBridge={false}
        disabledNodes={new Set()}
        githubApplicationError={null}
        githubApplicationInfo={null}
        githubApplicationLoading={false}
        initialTab="accounts"
        modelConfiguration={null}
        modelDiscovering={false}
        modelDiscovery={null}
        modelDiscoveryError={null}
        modelError={null}
        modelProfiles={[]}
        modelTest={null}
        onActivateModelProfile={vi.fn()}
        onCheckGitHubApplicationInfo={vi.fn()}
        onConfigureModel={vi.fn()}
        onConfigurePublisherBridge={onConfigurePublisherBridge}
        onDiscoverModels={vi.fn()}
        onRefreshWechatSync={vi.fn()}
        onRevealPublisherBridgeToken={vi.fn().mockResolvedValue(null)}
        onRevealSecret={vi.fn().mockResolvedValue(null)}
        onToggleNode={vi.fn()}
        platforms={[]}
        publisherBridgeConfiguration={{
          serverUrl: "ws://localhost:9527",
          tokenConfigured: false,
          tokenMasked: null,
          persistence: "encrypted_local_database",
        }}
        publisherBridgeError={null}
        runtime={{
          state: "ready",
          bridgeMode: "pi_sidecar",
          generation: 1,
          detail: "ready",
        }}
        wechatSyncRefreshing={false}
        wechatSyncStatus={{
          available: true,
          connected: false,
          state: "extension_waiting",
          detail: "等待浏览器扩展连接。",
          platforms: [],
        }}
      />,
    );

    expect(screen.getByDisplayValue("ws://localhost:9527")).toBeVisible();
    fireEvent.change(screen.getByPlaceholderText("粘贴插件中显示的 Token"), {
      target: { value: "extension-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并测试" }));

    expect(onConfigurePublisherBridge).toHaveBeenCalledWith({
      serverUrl: "ws://localhost:9527",
      token: "extension-token",
    });
  });
});

describe("SettingsPage model connection", () => {
  it("labels the save probe as text-only and explains image validation", () => {
    render(
      <SettingsPage
        configuring={false}
        configuringPublisherBridge={false}
        disabledNodes={new Set()}
        githubApplicationError={null}
        githubApplicationInfo={null}
        githubApplicationLoading={false}
        initialTab="models"
        modelConfiguration={null}
        modelDiscovering={false}
        modelDiscovery={null}
        modelDiscoveryError={null}
        modelError={null}
        modelProfiles={[]}
        modelTest={null}
        onActivateModelProfile={vi.fn()}
        onCheckGitHubApplicationInfo={vi.fn()}
        onConfigureModel={vi.fn()}
        onConfigurePublisherBridge={vi.fn()}
        onDiscoverModels={vi.fn()}
        onRefreshWechatSync={vi.fn()}
        onRevealPublisherBridgeToken={vi.fn().mockResolvedValue(null)}
        onRevealSecret={vi.fn().mockResolvedValue(null)}
        onToggleNode={vi.fn()}
        platforms={[]}
        publisherBridgeConfiguration={null}
        publisherBridgeError={null}
        runtime={null}
        wechatSyncRefreshing={false}
        wechatSyncStatus={null}
      />,
    );

    expect(screen.getByRole("button", { name: "保存并测试文本模型" })).toBeVisible();
    expect(screen.getByText("生图模型将在首次生成图片时验证，不会在保存时发起生图请求。")).toBeVisible();
  });

  it("names the text-model probe while it is running", () => {
    render(
      <SettingsPage
        configuring
        configuringPublisherBridge={false}
        disabledNodes={new Set()}
        githubApplicationError={null}
        githubApplicationInfo={null}
        githubApplicationLoading={false}
        initialTab="models"
        modelConfiguration={null}
        modelDiscovering={false}
        modelDiscovery={null}
        modelDiscoveryError={null}
        modelError={null}
        modelProfiles={[]}
        modelTest={null}
        onActivateModelProfile={vi.fn()}
        onCheckGitHubApplicationInfo={vi.fn()}
        onConfigureModel={vi.fn()}
        onConfigurePublisherBridge={vi.fn()}
        onDiscoverModels={vi.fn()}
        onRefreshWechatSync={vi.fn()}
        onRevealPublisherBridgeToken={vi.fn().mockResolvedValue(null)}
        onRevealSecret={vi.fn().mockResolvedValue(null)}
        onToggleNode={vi.fn()}
        platforms={[]}
        publisherBridgeConfiguration={null}
        publisherBridgeError={null}
        runtime={null}
        wechatSyncRefreshing={false}
        wechatSyncStatus={null}
      />,
    );

    expect(screen.getByRole("button", { name: "正在测试文本模型" })).toBeDisabled();
  });
});


describe("SettingsPage external links", () => {
  it("opens project, release, and author pages with the controlled external opener", () => {
    const windowOpen = vi.spyOn(window, "open").mockReturnValue(null);
    render(
      <SettingsPage
        configuring={false}
        configuringPublisherBridge={false}
        disabledNodes={new Set()}
        githubApplicationError={null}
        githubApplicationInfo={{
          repository: "tllovesxs/open-publisher",
          authorName: "tllovesxs",
          authorUrl: "https://github.com/tllovesxs",
          installedVersion: "0.1.1",
          latestVersion: "0.1.2",
          releaseUrl: "https://github.com/tllovesxs/open-publisher/releases/tag/v0.1.2",
          releaseNotes: null,
          publishedAt: null,
          updateAvailable: true,
          detail: "发现新版本",
        }}
        githubApplicationLoading={false}
        initialTab="data"
        modelConfiguration={null}
        modelDiscovering={false}
        modelDiscovery={null}
        modelDiscoveryError={null}
        modelError={null}
        modelProfiles={[]}
        modelTest={null}
        onActivateModelProfile={vi.fn()}
        onCheckGitHubApplicationInfo={vi.fn()}
        onConfigureModel={vi.fn()}
        onConfigurePublisherBridge={vi.fn()}
        onDiscoverModels={vi.fn()}
        onRefreshWechatSync={vi.fn()}
        onRevealPublisherBridgeToken={vi.fn().mockResolvedValue(null)}
        onRevealSecret={vi.fn().mockResolvedValue(null)}
        onToggleNode={vi.fn()}
        platforms={[]}
        publisherBridgeConfiguration={null}
        publisherBridgeError={null}
        runtime={null}
        wechatSyncRefreshing={false}
        wechatSyncStatus={null}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "项目主页" }));
    fireEvent.click(screen.getByRole("link", { name: "查看 Release" }));
    fireEvent.click(screen.getByRole("link", { name: "作者主页" }));

    expect(windowOpen).toHaveBeenNthCalledWith(
      1,
      "https://github.com/tllovesxs/open-publisher",
      "_blank",
      "noopener,noreferrer",
    );
    expect(windowOpen).toHaveBeenNthCalledWith(
      2,
      "https://github.com/tllovesxs/open-publisher/releases/tag/v0.1.2",
      "_blank",
      "noopener,noreferrer",
    );
    expect(windowOpen).toHaveBeenNthCalledWith(
      3,
      "https://github.com/tllovesxs",
      "_blank",
      "noopener,noreferrer",
    );
  });
});
