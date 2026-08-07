import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreatePage } from "./CreatePage";
import type { MediaAsset } from "../types";

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

const pastedAsset = {
  id: "media-pasted-image",
  name: "粘贴图片.png",
  alt: "粘贴的产品界面截图",
  description: "用于展示产品界面。",
  src: "data:image/png;base64,cGFzdGVk",
  source: "uploaded",
  createdAt: "刚刚",
} satisfies MediaAsset;

function renderCreatePage(options: { onImportPromptImages?: (files: File[]) => Promise<MediaAsset[]> } = {}) {
  const onCreate = vi.fn();
  const onActivateModelProfile = vi.fn();
  const onOpenSettings = vi.fn();
  const onImportPromptImages = options.onImportPromptImages ?? vi.fn().mockResolvedValue([]);
  const rendered = render(
    <CreatePage
      activeModelProfileId="writing"
      generating={false}
      mediaAssets={[]}
      modelProfiles={[profile]}
      onActivateModelProfile={onActivateModelProfile}
      onCreate={onCreate}
      onImportPromptImages={onImportPromptImages}
      onMediaChange={vi.fn()}
      onOpenSettings={onOpenSettings}
      onTemplateChange={vi.fn()}
      selectedMedia={[]}
      selectedTemplate={null}
      switchingModel={false}
      templates={[]}
    />,
  );
  return { ...rendered, onActivateModelProfile, onCreate, onImportPromptImages, onOpenSettings };
}

describe("CreatePage", () => {
  beforeEach(() => window.localStorage.clear());

  it("offers only the two product-promotion writing tones and no content type", () => {
    renderCreatePage();

    expect(screen.queryByLabelText("内容类型")).toBeNull();
    const tone = screen.getByLabelText("文风");
    expect(within(tone).getByRole("option", { name: "豆包投毒" })).toBeVisible();
    expect(within(tone).getByRole("option", { name: "真人感" })).toBeVisible();
  });

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
    fireEvent.change(screen.getByLabelText("文风"), {
      target: { value: "豆包投毒" },
    });
    fireEvent.change(screen.getByLabelText("篇幅"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("目标字数"), { target: { value: "4600" } });

    fireEvent.click(screen.getByRole("button", { name: "开始创作" }));

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      topic: "为本地优先写作工具准备一篇项目更新",
      title: "稿流 v0.2：更可靠的写作工作区",
      contentType: "产品推广",
      tone: expect.stringContaining("豆包投毒"),
      references: "本次更新包含文章修订、配图和发布前人工确认。",
      length: "约 4,600 字",
    }));

    await waitFor(() => {
      const draft = window.localStorage.getItem("open-publisher-creation-draft-v5") ?? "";
      expect(draft).toContain("稿流 v0.2：更可靠的写作工作区");
      expect(draft).toContain("豆包投毒");
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

  it("reports folder reading progress and preserves a source manifest", async () => {
    const { container, onCreate } = renderCreatePage();
    const readme = new File(["# Project\n\nA local project note."], "README.md", { type: "text/markdown" });
    Object.defineProperty(readme, "webkitRelativePath", { configurable: true, value: "demo/README.md" });
    const folderInput = container.querySelector<HTMLInputElement>("input[aria-label='选择项目文件夹']");
    expect(folderInput).not.toBeNull();

    fireEvent.change(folderInput!, { target: { files: [readme] } });
    expect(screen.getByRole("status", { name: "项目文件夹读取状态" })).toHaveTextContent("正在读取项目文件夹");
    expect(screen.getByRole("button", { name: "项目文件夹" })).toBeDisabled();

    await waitFor(() => {
      expect(screen.getByRole("status", { name: "项目文件夹读取状态" })).toHaveTextContent("项目文件夹已读取");
    });
    expect(screen.getByRole("button", { name: "项目文件夹" })).toBeEnabled();
    expect(screen.getByRole("status", { name: "项目文件夹读取状态" })).toHaveTextContent("已读 1 · 跳过 0");

    fireEvent.change(screen.getByLabelText("文章主题"), { target: { value: "介绍这个项目" } });
    fireEvent.click(screen.getByRole("button", { name: "开始创作" }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      references: expect.stringContaining("来源文件：`demo/README.md`"),
    }));
  });

  it("imports a pasted screenshot, stores it as an attachment, and forwards its selected intent", async () => {
    const onImportPromptImages = vi.fn().mockResolvedValue([pastedAsset]);
    const { onCreate } = renderCreatePage({ onImportPromptImages });
    const screenshot = new File(["image"], "clipboard.png", { type: "image/png" });

    fireEvent.paste(screen.getByLabelText("文章主题"), {
      clipboardData: {
        files: [],
        items: [{ kind: "file", type: "image/png", getAsFile: () => screenshot }],
      },
    });

    await waitFor(() => expect(onImportPromptImages).toHaveBeenCalledWith([screenshot]));
    expect(screen.getByLabelText("已附加提示图片")).toHaveTextContent("粘贴图片.png");
    fireEvent.change(screen.getByRole("combobox", { name: "粘贴图片.png的处理方式" }), {
      target: { value: "insert" },
    });
    fireEvent.change(screen.getByLabelText("文章主题"), { target: { value: "介绍这张产品界面" } });
    fireEvent.click(screen.getByRole("button", { name: "开始创作" }));

    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      inputImages: [expect.objectContaining({ assetId: pastedAsset.id, intent: "insert", asset: pastedAsset })],
    }));
  });

  it("waits for a pasted image to enter the local library before allowing creation", async () => {
    let resolveImport!: (assets: MediaAsset[]) => void;
    const onImportPromptImages = vi.fn(() => new Promise<MediaAsset[]>((resolve) => {
      resolveImport = resolve;
    }));
    const { onCreate } = renderCreatePage({ onImportPromptImages });
    const topic = screen.getByLabelText("文章主题");
    fireEvent.change(topic, { target: { value: "根据这张图写一篇产品介绍" } });
    fireEvent.paste(topic, {
      clipboardData: { files: [new File(["image"], "clipboard.png", { type: "image/png" })] },
    });

    const start = screen.getByRole("button", { name: "正在导入图片" });
    expect(start).toBeDisabled();
    fireEvent.click(start);
    expect(onCreate).not.toHaveBeenCalled();

    resolveImport([pastedAsset]);
    await waitFor(() => expect(screen.getByRole("button", { name: "开始创作" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "开始创作" }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      inputImages: [expect.objectContaining({ assetId: pastedAsset.id })],
    }));
  });

  it("keeps the rendered attachment count within the runtime limit", async () => {
    const assets = Array.from({ length: 7 }, (_, index) => ({
      ...pastedAsset,
      id: `media-pasted-${index + 1}`,
      name: `截图 ${index + 1}.png`,
    }));
    const onImportPromptImages = vi.fn().mockResolvedValue(assets);
    renderCreatePage({ onImportPromptImages });
    const screenshot = new File(["image"], "clipboard.png", { type: "image/png" });

    fireEvent.paste(screen.getByLabelText("文章主题"), {
      clipboardData: { files: [screenshot] },
    });

    const attachmentList = await screen.findByLabelText("已附加提示图片");
    expect(within(attachmentList).getAllByRole("combobox")).toHaveLength(6);
    expect(screen.getByRole("alert")).toHaveTextContent("一次最多附加 6 张图片");
  });
});
