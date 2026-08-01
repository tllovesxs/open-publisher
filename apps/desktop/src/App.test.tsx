import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import App from "./App";
import {
  type DesktopBridge,
  desktopBridge,
  type RunWorkflowSummary,
  setDesktopBridgeForTests,
  testOnlyMockDesktopBridge,
} from "./lib/desktopBridge";

const nativeTestBridge: DesktopBridge = {
  ...testOnlyMockDesktopBridge,
  runtimeSnapshot: async () => ({
    state: "ready",
    bridgeMode: "python_sidecar",
    generation: 1,
    detail: "Test-only local Python sidecar.",
  }),
  ensureAgentRuntime: async () => ({
    state: "ready",
    bridgeMode: "python_sidecar",
    generation: 1,
    detail: "Test-only local Python sidecar.",
  }),
  modelConfiguration: async () => ({
    name: "Test model",
    baseUrl: "https://example.test/v1",
    textModel: "test-text-model",
    imageBaseUrl: "https://images.example.test/v1",
    imageModel: "test-image-model",
    imageTrustedHosts: [],
    timeoutSeconds: 30,
    secretConfigured: true,
    persistence: "session",
  }),
  testModelConnection: async () => ({
    provider: "openai-compatible",
    model: "test-text-model",
    mocked: false,
  }),
};

const waitForNativeRuntime = () => screen.findByText("test-text-model");

describe("desktop product flow", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setDesktopBridgeForTests(nativeTestBridge);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setDesktopBridgeForTests(null);
  });

  it("exposes the focused content-production areas", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "从一个主题开始" })).toBeVisible();
    const navigation = screen.getByRole("navigation", { name: "主导航" });
    expect(within(navigation).getAllByRole("button")).toHaveLength(6);
    expect(within(navigation).getByRole("button", { name: "创作" })).toBeVisible();
    expect(within(navigation).getByRole("button", { name: "文章" })).toBeVisible();
    expect(within(navigation).getByRole("button", { name: "智能体" })).toBeVisible();
    expect(within(navigation).getByRole("button", { name: "模板" })).toBeVisible();
    expect(within(navigation).getByRole("button", { name: "素材库" })).toBeVisible();
    expect(within(navigation).getByRole("button", { name: "设置" })).toBeVisible();
    expect(within(navigation).queryByRole("button", { name: "发布" })).toBeNull();
    expect(within(navigation).queryByRole("button", { name: "工作流" })).toBeNull();
    expect(within(navigation).queryByRole("button", { name: "Skill" })).toBeNull();

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
    fireEvent.change(screen.getByLabelText("参考资料"), {
      target: { value: "只使用用户提供的事实，发布前必须人工确认。" },
    });
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

  it("passes an approximate custom length into the writing brief", async () => {
    const saveDraft = vi.spyOn(desktopBridge, "saveDraft");
    render(<App />);
    await waitForNativeRuntime();

    expect(screen.getByRole("option", { name: "短篇（约 1,500–2,000 字）" })).toBeVisible();
    expect(screen.getByRole("option", { name: "中篇（约 3,000–4,000 字）" })).toBeVisible();
    expect(screen.getByRole("option", { name: "长篇（约 5,500–7,000 字）" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("文章篇幅"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("自定义约多少字"), {
      target: { value: "6200" },
    });
    fireEvent.change(screen.getByLabelText("文章主题"), {
      target: { value: "按目标篇幅生成的文章" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始创作" }));

    await screen.findByLabelText("Markdown 正文");
    expect(saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        markdown: expect.stringContaining("- 篇幅：自定义（约 6,200 字）"),
      }),
    );
  });

  it("opens the article immediately and streams the writing Agent output", async () => {
    let finishWorkflow: (() => void) | undefined;
    let activityReadCount = 0;
    const runWorkflow = vi.fn<DesktopBridge["runWorkflow"]>(
      (request) =>
        new Promise<RunWorkflowSummary>((resolve) => {
          finishWorkflow = () =>
            void nativeTestBridge.runWorkflow(request).then(resolve);
        }),
    );
    setDesktopBridgeForTests({
      ...nativeTestBridge,
      runWorkflow,
      getWorkflowActivity: async () => {
        activityReadCount += 1;
        const events = [
          {
            id: "stream-start",
            eventType: "run.node_started",
            nodeId: "draft" as const,
            createdAt: "2026-08-01T02:20:00.000Z",
          },
          {
            id: "stream-delta",
            eventType: "run.node_output_delta",
            nodeId: "draft" as const,
            createdAt: "2026-08-01T02:20:01.000Z",
            draftDelta: "# 流式文章\\n\\n正文正在到达。",
          },
          {
            id: "stream-complete",
            eventType: "run.node_completed",
            nodeId: "draft" as const,
            createdAt: "2026-08-01T02:20:02.000Z",
          },
        ];
        return {
          runId: "streaming-run",
          status: "running" as const,
          events: activityReadCount === 1 ? events.slice(0, 2) : events,
        };
      },
    });
    render(<App />);
    await waitForNativeRuntime();

    fireEvent.change(screen.getByLabelText("文章主题"), {
      target: { value: "可观察的智能写作流程" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始创作" }));

    const editor = await screen.findByLabelText("Markdown 正文");
    await waitFor(() => expect(activityReadCount).toBeGreaterThan(0));
    await waitFor(() =>
      expect((editor as HTMLTextAreaElement).value).toContain("正文正在到达"),
    );
    fireEvent.click(await screen.findByRole("button", { name: "关闭进度提示" }));
    expect(screen.queryByRole("button", { name: "关闭进度提示" })).toBeNull();
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        agentInstructions: expect.arrayContaining([
          expect.objectContaining({ id: "writer", nodeId: "draft" }),
          expect.objectContaining({ id: "risk", nodeId: "risk" }),
        ]),
      }),
    );

    finishWorkflow?.();
    await screen.findByText(/文章已生成 · 修订/);
  });

  it("keeps the same article and offers a retry after workflow failure", async () => {
    const originalRunWorkflow = desktopBridge.runWorkflow.bind(desktopBridge);
    const saveDraft = vi.spyOn(desktopBridge, "saveDraft");
    const runWorkflow = vi
      .spyOn(desktopBridge, "runWorkflow")
      .mockRejectedValueOnce(new Error("upstream timeout"))
      .mockImplementation(originalRunWorkflow);
    render(<App />);
    await waitForNativeRuntime();

    fireEvent.change(screen.getByLabelText("文章主题"), {
      target: { value: "失败后可恢复的写作流程" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始创作" }));

    expect(await screen.findByText("文章生成失败")).toBeVisible();
    expect(screen.getByText("失败原因：upstream timeout")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重试本次生成" }));

    await waitFor(() => expect(runWorkflow).toHaveBeenCalledTimes(2));
    await screen.findByText(/文章已生成 · 修订/);
    expect(runWorkflow).toHaveBeenCalledTimes(2);
    expect(runWorkflow.mock.calls[1]?.[0].articleId).toBe(
      runWorkflow.mock.calls[0]?.[0].articleId,
    );
    // The initial brief is retained after failure. The retry persists only the
    // final composed revision, preserving the same article identity.
    expect(saveDraft).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem("open-publisher-creation-activity") ?? "{}",
      ) as { logs?: Array<{ message: string }> };
      expect(stored.logs?.map((entry) => entry.message)).toEqual(
        expect.arrayContaining([
          "工作流失败：upstream timeout",
          "开始重试本次生成",
        ]),
      );
    });
  });

  it("uses the visual plan to generate a missing image and persist the composed Markdown", async () => {
    const originalRunWorkflow = desktopBridge.runWorkflow.bind(desktopBridge);
    const runWorkflow = vi
      .spyOn(desktopBridge, "runWorkflow")
      .mockImplementation(async (request) => {
        const result = await originalRunWorkflow(request);
        return {
          ...result,
          visualPlan: {
            targetCount: 1,
            placements: [
              {
                afterHeading: null,
                assetId: null,
                alt: "自动生成的架构说明图",
                generationPrompt: "展示可靠写作流程的简洁架构图，不含文字。",
              },
            ],
          },
        };
      });
    const generateImage = vi.spyOn(desktopBridge, "generateImage");
    const saveDraft = vi.spyOn(desktopBridge, "saveDraft");
    render(<App />);
    await waitForNativeRuntime();

    fireEvent.change(screen.getByLabelText("文章主题"), {
      target: { value: "自动配图与文章结构" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始创作" }));

    const editor = await screen.findByLabelText("Markdown 正文");
    await waitFor(() => expect(runWorkflow).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(generateImage).toHaveBeenCalledTimes(1));
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        disabledOptionalNodeIds: expect.not.arrayContaining(["visual"]),
        visualComposition: {
          mode: "auto",
          targetCount: 0,
          assets: [],
        },
      }),
    );
    expect(generateImage).toHaveBeenCalledWith({
      prompt: "展示可靠写作流程的简洁架构图，不含文字。",
      size: "1536x1024",
      model: "test-image-model",
    });
    await waitFor(() =>
      expect((editor as HTMLTextAreaElement).value).toContain(
        "![自动生成的架构说明图](asset://generated-",
      ),
    );
    expect((editor as HTMLTextAreaElement).value).not.toContain("data:image/");
    expect(saveDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({
        baseRevision: expect.stringContaining("workflow"),
        markdown: expect.stringContaining("![自动生成的架构说明图]"),
      }),
    );
  });

  it("uses selected local media with its description before asking the image model", async () => {
    const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLZ8QAAAABJRU5ErkJggg==";
    window.localStorage.setItem(
      "open-publisher-studio-media",
      JSON.stringify([
        {
          id: "media-architecture",
          name: "产品架构图",
          alt: "三层产品架构图",
          description: "展示采集、编排、发布三层之间的单向数据流，适合放在架构小节。",
          src: image,
          source: "uploaded",
          createdAt: "刚刚导入",
        },
      ]),
    );
    const runWorkflow = vi.spyOn(desktopBridge, "runWorkflow");
    const generateImage = vi.spyOn(desktopBridge, "generateImage");
    setDesktopBridgeForTests({
      ...nativeTestBridge,
      modelConfiguration: async () => ({
        ...((await nativeTestBridge.modelConfiguration())!),
        imageBaseUrl: null,
        imageModel: null,
      }),
    });
    render(<App />);
    await waitForNativeRuntime();

    fireEvent.click(screen.getByRole("button", { name: "素材库" }));
    fireEvent.click(await screen.findByRole("button", { name: "选择产品架构图" }));
    fireEvent.click(screen.getByRole("button", { name: "带入创作" }));
    await screen.findByRole("heading", { name: "从一个主题开始" });
    fireEvent.change(screen.getByLabelText("配图数量"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("文章主题"), {
      target: { value: "已有素材的自动插入" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始创作" }));

    const editor = await screen.findByLabelText("Markdown 正文");
    await waitFor(() => expect(runWorkflow).toHaveBeenCalledTimes(1));
    await screen.findByText(/文章已生成 · 修订/);
    expect(runWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        visualComposition: {
          mode: "fixed",
          targetCount: 1,
          assets: [
            {
              id: "media-architecture",
              alt: "三层产品架构图",
              description: "展示采集、编排、发布三层之间的单向数据流，适合放在架构小节。",
            },
          ],
        },
      }),
    );
    expect(generateImage).not.toHaveBeenCalled();
    expect((editor as HTMLTextAreaElement).value).toContain(
      "![三层产品架构图](asset://media-architecture)",
    );
  });

  it("moves legacy inline images into the local media library while preserving preview", async () => {
    const image =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLZ8QAAAABJRU5ErkJggg==";
    render(<App />);
    await waitForNativeRuntime();
    fireEvent.change(screen.getByLabelText("配图数量"), { target: { value: "none" } });
    fireEvent.change(screen.getByLabelText("文章主题"), {
      target: { value: "内嵌图片迁移" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始创作" }));

    const editor = (await screen.findByLabelText("Markdown 正文")) as HTMLTextAreaElement;
    fireEvent.change(editor, {
      target: { value: `# 内嵌图片迁移\n\n![旧图片](${image})` },
    });

    await waitFor(() => {
      expect(editor.value).toMatch(/!\[旧图片\]\(asset:\/\/media-/);
    });
    expect(editor.value).not.toContain("data:image/");
    expect(await screen.findByRole("img", { name: "旧图片" })).toHaveAttribute("src", image);
  });

  it("edits and saves a local article revision", async () => {
    render(<App />);
    await waitForNativeRuntime();
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

  it("keeps agent, template, and image configuration in dedicated pages", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "智能体" }));
    expect(await screen.findByRole("heading", { name: "智能体" })).toBeVisible();
    expect(screen.getByLabelText("系统提示词")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "模板" }));
    expect(await screen.findByRole("heading", { name: "模板" })).toBeVisible();
    expect(screen.getByRole("button", { name: "用此模板创作" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "素材库" }));
    expect(await screen.findByRole("heading", { name: "素材库" })).toBeVisible();
    expect(screen.getByRole("button", { name: "上传图片" })).toBeVisible();
  });

  it("extracts a reusable template from Markdown and saves it after review", async () => {
    render(<App />);
    await waitForNativeRuntime();
    fireEvent.click(screen.getByRole("button", { name: "模板" }));

    fireEvent.click(await screen.findByRole("button", { name: "从文章提取" }));
    const source = await screen.findByLabelText("原始 Markdown");
    fireEvent.change(source, {
      target: {
        value: "# Wandao 体积下降 42%\n\n## 改动\n\n具体版本与链接不应进入模板。",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "提取为模板" }));

    expect(await screen.findByRole("heading", { name: "审核并保存模板" })).toBeVisible();
    const markdown = screen.getByLabelText("Markdown 正文") as HTMLTextAreaElement;
    expect(markdown.value).toContain("{{title}}");
    expect(markdown.value).not.toContain("Wandao");
    fireEvent.click(screen.getByRole("button", { name: "保存模板" }));

    expect(await screen.findByRole("heading", { name: "文章结构模板" })).toBeVisible();
  });

  it("configures and tests the model from settings without rendering the secret", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    const keyInput = screen.getByLabelText("API Key") as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: "test-session-secret-value" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并测试" }));

    expect(await screen.findByText("连接成功")).toBeVisible();
    expect(screen.queryByText("test-session-secret-value")).toBeNull();
    expect(keyInput.type).toBe("password");
  });
});
