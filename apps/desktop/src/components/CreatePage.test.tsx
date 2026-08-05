import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreatePage } from "./CreatePage";

const profile = {
  id: "writing",
  name: "默认写作模型",
  baseUrl: "https://example.test/v1",
  textProtocol: "openai-completions" as const,
  textModel: "writer-v1",
  textSupportsVision: false,
  textReasoning: false,
  textThinkingLevel: "auto" as const,
  textContextWindow: 128000,
  textMaxTokens: 16384,
  timeoutSeconds: 120,
  secretConfigured: true,
  textKeyMasked: "sk-***",
  active: true,
};

function renderCreatePage() {
  const onCreate = vi.fn();
  const onActivateModelProfile = vi.fn();
  const onOpenSettings = vi.fn();
  render(
    <CreatePage
      activeModelProfileId="writing"
      generating={false}
      mediaAssets={[]}
      modelProfiles={[profile]}
      onActivateModelProfile={onActivateModelProfile}
      onCreate={onCreate}
      onMediaChange={vi.fn()}
      onOpenSettings={onOpenSettings}
      onTemplateChange={vi.fn()}
      selectedMedia={[]}
      selectedTemplate={null}
      switchingModel={false}
      templates={[]}
    />,
  );
  return { onActivateModelProfile, onCreate, onOpenSettings };
}

describe("CreatePage", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps title and references in a focused dialog while preserving them in the request", async () => {
    const { onCreate } = renderCreatePage();

    fireEvent.click(screen.getByRole("button", { name: "资料" }));
    fireEvent.change(screen.getByLabelText("文章标题（可选）"), {
      target: { value: "稿流 v0.2：更可靠的写作工作区" },
    });
    fireEvent.change(screen.getByLabelText("参考资料"), {
      target: { value: "本次更新包含文章修订、配图和发布前人工确认。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    fireEvent.change(screen.getByLabelText("文章主题"), {
      target: { value: "为本地优先写作工具准备一篇项目更新" },
    });
    fireEvent.change(screen.getByLabelText("内容类型"), {
      target: { value: "项目更新" },
    });
    fireEvent.change(screen.getByLabelText("篇幅"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("目标字数"), { target: { value: "4600" } });

    fireEvent.click(screen.getByRole("button", { name: "开始创作" }));

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      topic: "为本地优先写作工具准备一篇项目更新",
      title: "稿流 v0.2：更可靠的写作工作区",
      contentType: "项目更新",
      references: "本次更新包含文章修订、配图和发布前人工确认。",
      length: "约 4,600 字",
    }));

    await waitFor(() => {
      const draft = window.localStorage.getItem("open-publisher-creation-draft-v4") ?? "";
      expect(draft).toContain("稿流 v0.2：更可靠的写作工作区");
      expect(draft).toContain("项目更新");
    });
  });

  it("uses a configurable material threshold for image planning", () => {
    const { onCreate } = renderCreatePage();
    fireEvent.change(screen.getByLabelText("文章主题"), {
      target: { value: "一篇需要配图的项目介绍" },
    });
    fireEvent.click(screen.getByRole("button", { name: /配图/ }));
    fireEvent.click(screen.getByLabelText("指定数量"));
    fireEvent.change(screen.getByLabelText("配图数量"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("素材默认阈值"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配图设置" }));
    fireEvent.click(screen.getByRole("button", { name: "开始创作" }));

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      imagePlan: { mode: "fixed", targetCount: 3, materialMatchThreshold: 45 },
    }));
  });

  it("switches the active writing model from the creation footer", () => {
    const { onActivateModelProfile, onOpenSettings } = renderCreatePage();
    fireEvent.change(screen.getByLabelText("写作模型"), { target: { value: "writing" } });
    expect(onActivateModelProfile).toHaveBeenCalledWith("writing");

    fireEvent.change(screen.getByLabelText("写作模型"), { target: { value: "__settings__" } });
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
