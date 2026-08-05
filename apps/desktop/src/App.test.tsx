import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import App, {
  applyTemplateFixedBlocks,
  buildCreationSeed,
  normalizeTemplate,
  persistedFailedCreationContext,
  replaceStudioValue,
  visualCompositionFromCreation,
} from "./App";
import { availableSkills, defaultAgents } from "./data/contentStudio";
import {
  type DesktopBridge,
  desktopBridge,
  setDesktopBridgeForTests,
  testOnlyMockDesktopBridge,
} from "./lib/desktopBridge";

const nativeTestBridge: DesktopBridge = {
  ...testOnlyMockDesktopBridge,
  piRuntimeSnapshot: async () => ({
    state: "ready",
    bridgeMode: "pi_sidecar",
    generation: 1,
    detail: "Test-only local Pi runtime.",
  }),
  ensurePiRuntime: async () => ({
    state: "ready",
    bridgeMode: "pi_sidecar",
    generation: 1,
    detail: "Test-only local Pi runtime.",
  }),
  startPiArticleRun: async ({ articleId, prompt }) => {
    const title = prompt.match(/(?:文章主题|主题)：\s*(.+)/)?.[1]?.trim()
      || "本地 Pi 写作测试";
    await testOnlyMockDesktopBridge.saveDraft({
      articleId,
      baseRevision: null,
      markdown: `# ${title}\n\n${prompt}`,
    });
    return {
      schemaVersion: "2",
      id: `test-pi-run-${articleId}`,
      articleId,
      sessionId: `test-session-${articleId}`,
      agentId: "writer",
      operation: "create_article",
      status: "completed",
      baseRevisionId: null,
      createdAt: "2026-08-05T00:00:00.000Z",
      startedAt: "2026-08-05T00:00:00.000Z",
      completedAt: "2026-08-05T00:00:00.000Z",
      error: null,
    };
  },
  getPiRun: async (runId) => ({
    schemaVersion: "2",
    id: runId,
    articleId: runId.replace("test-pi-run-", ""),
    sessionId: null,
    agentId: "writer",
    operation: "create_article",
    status: "completed",
    baseRevisionId: null,
    createdAt: "2026-08-05T00:00:00.000Z",
    startedAt: "2026-08-05T00:00:00.000Z",
    completedAt: "2026-08-05T00:00:00.000Z",
    error: null,
  }),
  getPiArticle: async (articleId) => {
    const article = (await testOnlyMockDesktopBridge.listArticles()).find(
      (candidate) => candidate.articleId === articleId,
    );
    if (!article) throw new Error(`测试文章不存在：${articleId}`);
    return {
      schemaVersion: "2",
      articleId,
      title: article.title,
      relativePath: "article.md",
      currentRevisionId: article.revisionId,
      contentHash: `test-hash-${article.revisionId}`,
      updatedAt: article.updatedAt,
      markdown: article.markdown,
    };
  },
  modelConfiguration: async () => ({
    profileId: "test-profile",
    name: "Test model",
    baseUrl: "https://example.test/v1",
    textProtocol: "openai-completions",
    textModel: "test-text-model",
    textSupportsVision: false,
    textReasoning: false,
    textThinkingLevel: "auto",
    textContextWindow: 128000,
    textMaxTokens: 16384,
    imageBaseUrl: "https://images.example.test/v1",
    imageModel: "test-image-model",
    imageTrustedHosts: [],
    timeoutSeconds: 30,
    secretConfigured: true,
    imageSecretConfigured: true,
    webSearchConfigured: false,
    githubConfigured: false,
    textKeyMasked: "tes••••ret",
    imageKeyMasked: "tes••••ret",
    tavilyKeyMasked: null,
    githubTokenMasked: null,
    persistence: "encrypted_local_database",
  }),
  listModelProfiles: async () => ([{
    id: "test-profile",
    name: "Test model",
    baseUrl: "https://example.test/v1",
    textProtocol: "openai-completions",
    textModel: "test-text-model",
    textSupportsVision: false,
    textReasoning: false,
    textThinkingLevel: "auto",
    textContextWindow: 128000,
    textMaxTokens: 16384,
    timeoutSeconds: 30,
    secretConfigured: true,
    textKeyMasked: "tes••••ret",
    active: true,
  }]),
  testModelConnection: async () => ({
    provider: "openai-compatible",
    model: "test-text-model",
    mocked: false,
  }),
};

const waitForNativeRuntime = () =>
  screen.findByRole("option", { name: /Test model/ });

const setImagePlan = (mode: "none" | "fixed", count = 1) => {
  fireEvent.click(screen.getByRole("button", { name: /配图/ }));
  fireEvent.click(screen.getByLabelText(mode === "none" ? "不添加" : "指定数量"));
  if (mode === "fixed") {
    fireEvent.change(screen.getByLabelText("配图数量"), {
      target: { value: String(count) },
    });
  }
  fireEvent.click(screen.getByRole("button", { name: "保存配图设置" }));
};

describe("desktop product flow", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setDesktopBridgeForTests(nativeTestBridge);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setDesktopBridgeForTests(null);
  });

  it("migrates legacy templates and inserts enabled fixed blocks exactly once", () => {
    const template = normalizeTemplate({
      id: "legacy-template",
      name: "旧模板",
      description: "旧数据",
      category: "测试",
      markdown: "# {{title}}\n\n{{lead}}",
      isBuiltIn: false,
    });
    expect(template?.styleProfile).toEqual(expect.objectContaining({ tone: "" }));
    expect(template?.fixedBlocks).toEqual([]);
    const withBlock = {
      ...template!,
      fixedBlocks: [{ id: "intro", label: "项目介绍", enabled: true, content: "项目：{{title}}", position: "before_title" as const }],
    };
    const request = { title: "新文章", topic: "主题" } as Parameters<typeof applyTemplateFixedBlocks>[3];
    const article = { title: "新文章" } as Parameters<typeof applyTemplateFixedBlocks>[2];
    const once = applyTemplateFixedBlocks("# 新文章\n\n正文", withBlock, article, request);
    expect(once).toContain("项目：新文章");
    expect(applyTemplateFixedBlocks(once, withBlock, article, request).match(/项目：新文章/g)).toHaveLength(1);
  });

  it("keeps the complete reference article in a local high-fidelity creation seed", () => {
    const template = normalizeTemplate({
      id: "reference-template-1",
      name: "高保真模板",
      description: "参考文章",
      category: "参考写作",
      markdown: "# {{title}}\n\n{{lead}}",
      isBuiltIn: false,
      mode: "reference",
      referenceMarkdown: "# 参考原文\n\n独特的参考表达只用于分析。",
      sourceFingerprint: `sha256:${"a".repeat(64)}`,
      rightsConfirmed: true,
    });
    const seed = buildCreationSeed({
      topic: "新的写作主题",
      title: "",
      references: "",
      contentType: "技术文章",
      tone: "专业清晰",
      length: "约 3,000 字",
      platforms: [],
      preset: "standard",
      disabledNodeIds: [],
      template,
      imageAssets: [],
      imagePlan: { mode: "none", targetCount: 0, materialMatchThreshold: 30 },
      webSearchMode: "off",
    });

    expect(seed).toContain("open-publisher-reference-template:v1:");
    expect(seed).toContain("独特的参考表达只用于分析。");
    expect(seed).toContain("开篇切入动作、段落粒度、章节推进");
    expect(seed).not.toContain("phrase_blacklist");
  });

  it("preserves long author reference material in the creation seed", () => {
    const references = `项目资料段落。${"细节".repeat(50_000)}`;
    const seed = buildCreationSeed({
      topic: "基于完整资料写作",
      title: "",
      references,
      contentType: "技术文章",
      tone: "专业清晰",
      length: "约 120,000 字",
      platforms: [],
      preset: "standard",
      disabledNodeIds: [],
      template: null,
      imageAssets: [],
      imagePlan: { mode: "none", targetCount: 0, materialMatchThreshold: 30 },
      webSearchMode: "off",
    });

    expect(seed).toContain(references);
  });

  it("normalizes selected asset metadata to the visual sidecar protocol limits", () => {
    const description = `图片内容\r\n${"可用于解释工作流的图示。".repeat(120)}\u0007`;
    const composition = visualCompositionFromCreation({
      topic: "测试文章",
      title: "",
      references: "",
      contentType: "技术文章",
      tone: "专业清晰",
      length: "约 3,000 字",
      platforms: [],
      preset: "standard",
      disabledNodeIds: [],
      template: null,
      imageAssets: [{
        id: "asset-1",
        name: "工作流图\r\n",
        alt: "工作流图\u0000\r\n",
        description: "",
        visualDescription: description,
        usageHint: "",
        generationPrompt: "",
        tags: [],
        src: "data:image/png;base64,abc",
        source: "uploaded",
        createdAt: "2026-08-04T00:00:00.000Z",
      }],
      imagePlan: { mode: "auto", targetCount: 0, materialMatchThreshold: 30 },
      webSearchMode: "auto",
    });

    const asset = composition.assets[0]!;
    expect(Array.from(asset.description)).toHaveLength(600);
    expect(asset.description).not.toMatch(/[\r\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/);
    expect(Array.from(asset.alt)).toHaveLength(4);
    expect(asset.alt).toBe("工作流图");
  });

  it("uses the built-in Baoyu article-illustration Skill for the fixed visual workflow", () => {
    expect(availableSkills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "baoyu-article-illustrator", isBuiltIn: true }),
      ]),
    );
    expect(availableSkills.some((skill) => skill.id === "image-planning")).toBe(false);
    expect(defaultAgents.find((agent) => agent.id === "visual")?.skillIds).toEqual([
      "baoyu-article-illustrator",
    ]);
  });

  it("exposes the focused content-production areas", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "开始创作" })).toBeVisible();
    const navigation = screen.getByRole("navigation", { name: "主导航" });
    expect(within(navigation).getAllByRole("button")).toHaveLength(6);
    expect(within(navigation).getByRole("button", { name: "创作" })).toBeVisible();
    expect(within(navigation).getByRole("button", { name: "文章" })).toBeVisible();
    expect(within(navigation).getByRole("button", { name: "公告" })).toBeVisible();
    expect(within(navigation).getByRole("button", { name: "模板" })).toBeVisible();
    expect(within(navigation).getByRole("button", { name: "素材库" })).toBeVisible();
    expect(within(navigation).getByRole("button", { name: "设置" })).toBeVisible();
    expect(within(navigation).queryByRole("button", { name: "发布" })).toBeNull();
    expect(within(navigation).queryByRole("button", { name: "工作流" })).toBeNull();
    expect(within(navigation).queryByRole("button", { name: "Skill" })).toBeNull();
    expect(within(navigation).queryByRole("button", { name: "智能体" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "批量" })).toBeNull();
    expect(screen.queryByRole("list", { name: "文章进度" })).toBeNull();

    fireEvent.click(within(navigation).getByRole("button", { name: "文章" }));
    expect(await screen.findByRole("heading", { name: "还没有文章" })).toBeVisible();
    expect(screen.getByRole("button", { name: "新建文章" })).toBeVisible();
  });

  it("creates an article from a brief and opens the generated revision", async () => {
    render(<App />);
    await waitForNativeRuntime();

    fireEvent.change(screen.getByLabelText("文章主题"), {
      target: { value: "如何设计可靠的多平台发布流程" },
    });
    fireEvent.click(screen.getByRole("button", { name: "资料" }));
    fireEvent.change(screen.getByLabelText("参考资料"), {
      target: { value: "只使用用户提供的事实，发布前必须人工确认。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    fireEvent.click(screen.getByRole("button", { name: "开始创作" }));

    await waitFor(
      () => {
        expect(screen.getByLabelText("Markdown 正文")).toBeVisible();
        expect(
          screen.getAllByRole("heading", {
            name: "如何设计可靠的多平台发布流程",
          })[0],
        ).toBeVisible();
      },
      { timeout: 3000 },
    );
    expect((screen.getByLabelText("Markdown 正文") as HTMLTextAreaElement).value).toContain(
      "只使用用户提供的事实",
    );
    expect((screen.getByLabelText("Markdown 正文") as HTMLTextAreaElement).value).not.toContain(
      "{{",
    );
  });

  it("uses Pi for creation and commits its completed Markdown to the canonical article store", async () => {
    const piMarkdown = "# Pi 写作结果\n\n这篇文章由 Pi Runtime 流式生成，完成后写回本机文章修订库。";
    let persistedArticleId: string | null = null;
    const startPiArticleRun = vi.fn<DesktopBridge["startPiArticleRun"]>(async ({ articleId }) => {
      persistedArticleId = articleId;
      return {
      schemaVersion: "2",
      id: "pi-run-1",
      articleId,
      sessionId: "session:article-test",
      agentId: "writer",
      operation: "create_article",
      status: "running",
      baseRevisionId: null,
      createdAt: "2026-08-05T00:00:00.000Z",
      startedAt: "2026-08-05T00:00:00.000Z",
      completedAt: null,
      error: null,
      };
    });
    const getPiArticle = vi.fn<DesktopBridge["getPiArticle"]>(async (articleId) => ({
      schemaVersion: "2",
      articleId,
      title: "Pi 写作结果",
      relativePath: "article.md",
      currentRevisionId: "pi-stage-revision",
      contentHash: "pi-stage-hash",
      updatedAt: "2026-08-05T00:00:02.000Z",
      markdown: piMarkdown,
    }));
    setDesktopBridgeForTests({
      ...nativeTestBridge,
      piRuntimeSnapshot: async () => ({
        state: "ready",
        bridgeMode: "pi_sidecar",
        generation: 1,
        detail: "Test-only Pi runtime.",
      }),
      ensurePiRuntime: async () => ({
        state: "ready",
        bridgeMode: "pi_sidecar",
        generation: 1,
        detail: "Test-only Pi runtime.",
      }),
      startPiArticleRun,
      listArticles: async () => persistedArticleId ? [{
        articleId: persistedArticleId,
        title: "Pi 写作结果",
        markdown: piMarkdown,
        revisionId: "pi-stage-revision",
        revisionNumber: 1,
        updatedAt: "2026-08-05T00:00:02.000Z",
      }] : [],
      getPiRunEvents: async () => [{
        schemaVersion: "2",
        id: "pi-event-1",
        runId: "pi-run-1",
        sequence: 1,
        timestamp: "2026-08-05T00:00:01.000Z",
        articleId: "article-test",
        agentId: "writer",
        parentAgentId: null,
        operation: "create_article",
        type: "article.preview_delta",
        payload: { delta: piMarkdown, reset: true },
      }],
      getPiRun: async () => ({
        schemaVersion: "2",
        id: "pi-run-1",
        articleId: "article-test",
        sessionId: "session:article-test",
        agentId: "writer",
        operation: "create_article",
        status: "completed",
        baseRevisionId: null,
        createdAt: "2026-08-05T00:00:00.000Z",
        startedAt: "2026-08-05T00:00:00.000Z",
        completedAt: "2026-08-05T00:00:02.000Z",
        error: null,
      }),
      getPiArticle,
    });
    render(<App />);
    await waitForNativeRuntime();
    setImagePlan("none");

    fireEvent.change(screen.getByLabelText("文章主题"), {
      target: { value: "Pi Runtime 写作迁移" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始创作" }));

    await screen.findByText(/文章已生成 · 修订/, {}, { timeout: 3_000 });
    expect(startPiArticleRun).toHaveBeenCalledTimes(1);
    expect(getPiArticle).toHaveBeenCalledWith(expect.any(String));
    await waitFor(() => expect(
      (screen.getByLabelText("Markdown 正文") as HTMLTextAreaElement).value,
    ).toContain("Pi Runtime 流式生成"), { timeout: 5_000 });
  });

  it("passes an approximate custom length into the writing brief", async () => {
    const saveDraft = vi.spyOn(desktopBridge, "saveDraft");
    render(<App />);
    await waitForNativeRuntime();

    expect(screen.getByRole("option", { name: "短篇" })).toBeVisible();
    expect(screen.getByRole("option", { name: "中篇" })).toBeVisible();
    expect(screen.getByRole("option", { name: "长篇" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("篇幅"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("目标字数"), {
      target: { value: "6200" },
    });
    fireEvent.change(screen.getByLabelText("文章主题"), {
      target: { value: "按目标篇幅生成的文章" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始创作" }));

    await screen.findByLabelText("Markdown 正文");
    expect(saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        markdown: expect.stringContaining("- 篇幅：约 6,200 字"),
      }),
    );
  });

  it("stores a compact failed-run recovery record and absorbs a storage quota error", () => {
    const imageData = `data:image/png;base64,${"a".repeat(500_000)}`;
    const persisted = persistedFailedCreationContext({
      articleId: "article-1",
      templateId: "template-1",
      imageAssetIds: ["asset-1"],
      request: {
        topic: "为项目写一篇更新文章",
        title: "",
        references: "不会写入失败恢复缓存。".repeat(2_000),
        contentType: "技术文章",
        tone: "专业清晰",
        length: "约 3,000 字",
        platforms: [],
        preset: "standard",
        disabledNodeIds: [],
        template: normalizeTemplate({
          id: "template-1",
          name: "高保真模板",
          description: "",
          category: "测试",
          markdown: "# {{title}}",
          isBuiltIn: false,
          referenceMarkdown: "原文内容".repeat(10_000),
        }),
        imageAssets: [{
          id: "asset-1",
          name: "large-image.png",
          src: imageData,
          alt: "大型测试图片",
          description: "不应写入本地恢复缓存",
          tags: [],
          source: "uploaded",
          createdAt: "2026-08-04T00:00:00.000Z",
        }],
        imagePlan: { mode: "auto", targetCount: 0, materialMatchThreshold: 30 },
        webSearchMode: "auto",
        agentInstructions: [{
          id: "writer",
          name: "写作智能体",
          role: "writer",
          nodeId: "draft",
          prompt: "系统提示词".repeat(10_000),
          skills: [],
        }],
      },
    });
    const serialized = JSON.stringify(persisted);
    expect(serialized).not.toContain("data:image/");
    expect(serialized).not.toContain("不会写入失败恢复缓存");
    expect(serialized).not.toContain("原文内容");
    expect(serialized).not.toContain("系统提示词");
    expect(serialized.length).toBeLessThan(2_000);

    const storage = {
      removeItem: vi.fn(),
      setItem: vi.fn(() => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }),
    };
    expect(replaceStudioValue("open-publisher-failed-creation", persisted, storage)).toBe(false);
    expect(storage.removeItem).toHaveBeenCalledWith("open-publisher-failed-creation");
    expect(storage.setItem).toHaveBeenCalledTimes(2);
  });

  it("moves legacy inline images into the local media library while preserving preview", async () => {
    const image =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLZ8QAAAABJRU5ErkJggg==";
    render(<App />);
    await waitForNativeRuntime();
    setImagePlan("none");
    fireEvent.change(screen.getByLabelText("文章主题"), {
      target: { value: "内嵌图片迁移" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始创作" }));

    const editor = (await screen.findByLabelText("Markdown 正文")) as HTMLTextAreaElement;
    await screen.findByText(/文章已生成 · 修订/);
    fireEvent.change(editor, {
      target: { value: `# 内嵌图片迁移\n\n![旧图片](${image})` },
    });

    await waitFor(() => {
      expect(editor.value).toMatch(/!\[旧图片\]\(asset:\/\/media-/);
    });
    expect(editor.value).not.toContain("data:image/");
    fireEvent.click(screen.getByRole("button", { name: "预览" }));
    expect(await screen.findByRole("img", { name: "旧图片" })).toHaveAttribute("src", image);
  });

  it("edits and saves a local article revision", async () => {
    render(<App />);
    await waitForNativeRuntime();
    setImagePlan("none");
    fireEvent.change(screen.getByLabelText("文章主题"), {
      target: { value: "本地保存测试" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始创作" }));
    const editor = await screen.findByLabelText("Markdown 正文");
    await screen.findByText(/文章已生成 · 修订/);

    fireEvent.change(editor, {
      target: { value: "# 新标题\n\n作者保留最终决定权。" },
    });
    expect(screen.getByText("有未保存修改")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("文章已保存到浏览器演示会话")).toBeVisible();
    expect(screen.getByRole("button", { name: "已保存" })).toBeDisabled();
  });

  it("keeps templates and image assets in dedicated pages", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "模板" }));
    expect(await screen.findByRole("heading", { name: "模板" })).toBeVisible();
    expect(screen.getByRole("button", { name: "用此模板创作" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "素材库" }));
    expect(await screen.findByRole("heading", { name: "素材库" })).toBeVisible();
    expect(screen.getByRole("button", { name: "上传图片" })).toBeVisible();
    expect(screen.getByRole("main")).toHaveClass("page-viewport--media");

    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(await screen.findByRole("heading", { name: "设置" })).toBeVisible();
    expect(screen.getByRole("main")).toHaveClass("page-viewport--settings");
  });

  it("extracts a reusable template from Markdown and saves it after review", async () => {
    render(<App />);
    await waitForNativeRuntime();
    fireEvent.click(screen.getByRole("button", { name: "模板" }));

    fireEvent.click(await screen.findByRole("button", { name: "创建参考模板" }));
    const source = await screen.findByLabelText("原始 Markdown");
    fireEvent.change(source, {
      target: {
        value: "# Wandao 体积下降 42%\n\n## 改动\n\n具体版本与链接不应进入模板。",
      },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /我确认拥有这篇文章的使用授权/ }));
    fireEvent.click(screen.getByRole("button", { name: "分析参考模板" }));

    expect(await screen.findByRole("heading", { name: "审核并保存参考模板" })).toBeVisible();
    expect(screen.getByText("完整参考原文")).toBeVisible();
    expect(screen.getByText(/Wandao 体积下降 42%/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "保存模板" }));

    expect(await screen.findByRole("heading", { name: "高保真参考模板" })).toBeVisible();
  });

  it("configures and tests the model from settings without rendering the secret", async () => {
    render(<App />);
    await waitForNativeRuntime();
    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    expect(within(screen.getByLabelText("Pi 模型档案")).getByText("Test model")).toBeVisible();
    expect((screen.getByLabelText("Thinking level") as HTMLSelectElement).value).toBe("auto");

    const keyInput = screen.getByLabelText("API Key") as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: "test-session-secret-value" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并测试" }));

    expect(await screen.findByText("连接成功")).toBeVisible();
    expect(screen.queryByText("test-session-secret-value")).toBeNull();
    expect(keyInput.type).toBe("password");
  });
});
