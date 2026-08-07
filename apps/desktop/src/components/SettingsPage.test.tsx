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
