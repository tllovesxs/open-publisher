import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import App from "./App";
import { desktopBridge, type RunWorkflowSummary } from "./lib/desktopBridge";

const defaultMatchMedia = window.matchMedia;

describe("desktop workspace", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: defaultMatchMedia,
    });
  });

  it("switches between product areas and opens an article", () => {
    render(<App />);

    expect(
      screen.getAllByRole("heading", { name: "本地优先，才是创作者工具的底气" }).length,
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "文章" }));
    expect(screen.getByRole("heading", { name: "稿件不是文件，是一条修订历史" })).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /打开稿件/ })[1]);
    expect(
      screen.getAllByRole("heading", { name: "一个写作团队，住进一条工作流" }).length,
    ).toBeGreaterThan(0);
    expect((screen.getByLabelText("Markdown 正文") as HTMLTextAreaElement).value).toContain(
      "多 Agent 的价值",
    );
  });

  it("edits and saves a revision through the desktop bridge fallback", async () => {
    render(<App />);
    const editor = screen.getByLabelText("Markdown 正文");

    fireEvent.change(editor, { target: { value: "# 新修订\n\n作者仍然拥有最终决定权。" } });
    expect(screen.getByText("有未保存修改")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "保存修订" }));
    await waitFor(() => {
      expect(screen.getByText("修订已记入本地会话（演示模式）")).toBeTruthy();
    });
    expect((screen.getByRole("button", { name: "已保存" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("creates a local draft and applies Markdown toolbar actions", () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "新建文章" }));
    expect(screen.getAllByRole("heading", { name: "未命名文章" }).length).toBeGreaterThan(0);

    const editor = screen.getByLabelText("Markdown 正文") as HTMLTextAreaElement;
    editor.focus();
    editor.setSelectionRange(0, 0);
    fireEvent.click(screen.getByRole("button", { name: "插入标题" }));
    expect(editor.value.startsWith("## 小节标题")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "让 Agent 处理选中内容" }));
    expect(screen.getByText(/已记录选区请求/)).toBeVisible();
  });

  it("runs the workflow and opens a real platform preview", async () => {
    let resolveWorkflow: ((summary: RunWorkflowSummary) => void) | undefined;
    const workflowCall = vi
      .spyOn(desktopBridge, "runWorkflow")
      .mockImplementation(
        (request) =>
          new Promise((resolve) => {
            resolveWorkflow = resolve;
            expect(request.articleId).toBe("art-local-first");
          }),
      );
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "运行工作流" }));
    await waitFor(() => {
      expect(workflowCall).toHaveBeenCalledOnce();
      expect((screen.getByRole("button", { name: "运行中" }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    });
    expect(screen.queryByRole("button", { name: "运行工作流" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "打开平台预览" }));
    const dialog = screen.getByRole("dialog", { name: "平台预览" });
    expect(dialog).toBeTruthy();
    const closePreview = within(dialog).getByRole("button", { name: "关闭平台预览" });
    expect(closePreview).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(within(dialog).getByRole("button", { name: "公众号" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(closePreview).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: "CSDN" }));
    expect(screen.getByText("平台预览 · 不会实际发布")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "平台预览" })).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "打开平台预览" })).toHaveFocus());
    const request = workflowCall.mock.calls[0][0];
    resolveWorkflow?.({
      runId: "run-controlled",
      status: "completed",
      workflowName: "article-default",
      workflowVersion: "1.1.0",
      inputRevisionId: request.revisionId,
      outputRevisionId: "revision-controlled",
      outputRevisionNumber: 2,
      outputMarkdown: "# 工作流已完成",
      outputContentHash: "a".repeat(64),
      artifacts: [{ id: "artifact-controlled", kind: "workflow.canonical-draft" }],
      persistence: "memory",
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "运行工作流" })).toBeEnabled();
    });
  });

  it("passes optional workflow selections into the local demo bridge", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "工作流" }));

    const researchToggle = screen.getByRole("checkbox", { name: "证据采集可选节点" });
    const riskToggle = screen.getByRole("checkbox", { name: "风险巡检必经节点" });
    expect(researchToggle).toBeChecked();
    expect(riskToggle).toBeDisabled();
    fireEvent.click(researchToggle);
    expect(researchToggle).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "从头运行" }));
    const result = await screen.findByRole("region", { name: "最近一次工作流结果" });
    expect(within(result).getByText("7")).toBeVisible();
    expect(within(result).getByText("Artifact")).toBeVisible();
  });

  it("requires approval, verifies idempotency, and completes a local publish dry-run", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "发布" }));

    fireEvent.click(screen.getByRole("button", { name: "生成发布计划" }));
    const approveButton = await screen.findByRole("button", { name: "批准本次演练" });
    expect(approveButton).toBeDisabled();
    expect(screen.getByText("3 项 · 内容哈希已绑定")).toBeVisible();

    fireEvent.click(
      screen.getByRole("checkbox", { name: /我已检查目标与变体/ }),
    );
    expect(approveButton).toBeEnabled();
    fireEvent.click(approveButton);

    const enqueueButton = await screen.findByRole("button", {
      name: "验证幂等并入队",
    });
    fireEvent.click(enqueueButton);
    expect(await screen.findByText(/同一组 3 个 durable job/)).toBeVisible();
    expect(screen.getByText("3 个任务")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "执行本地 dry-run" }));
    expect(await screen.findByText("演练闭环已完成")).toBeVisible();
    expect(screen.getByText("3 个持久化回执")).toBeVisible();
    expect(screen.getAllByText("published")).toHaveLength(3);
  });

  it("stores generated visual output through the desktop bridge", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "素材" }));
    fireEvent.click(screen.getByRole("button", { name: "生成配图" }));

    expect(await screen.findByText(/已保存 1 个配图 Artifact/)).toBeVisible();
    expect(screen.getByText("已存入本地 Artifact")).toBeVisible();
  });

  it("keeps the evidence rail closed on a narrow initial viewport", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        ...defaultMatchMedia(query),
        matches: query === "(max-width: 900px)",
      }),
    });

    render(<App />);
    expect(screen.getByLabelText("证据与风险")).not.toHaveClass("is-open");
    expect(screen.getByRole("button", { name: "运行工作流" })).toBeVisible();
  });

  it("adds an honest mock connection through the accessible dialog", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "连接" }));

    expect(await screen.findByText("尚未添加模型连接")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "添加连接" }));
    const dialog = screen.getByRole("dialog", { name: "添加模型连接" });
    expect(dialog).toBeVisible();

    fireEvent.click(within(dialog).getByRole("button", { name: "保存连接引用" }));
    expect(screen.getByText("请输入连接名称。")).toBeVisible();

    fireEvent.change(screen.getByLabelText(/连接名称/), {
      target: { value: "本地演示 Mock" },
    });
    fireEvent.change(screen.getByLabelText(/密钥环境变量名/), {
      target: { value: "sk-plaintext-is-not-an-env-name" },
    });
    fireEvent.blur(screen.getByLabelText(/密钥环境变量名/));
    expect(screen.getByText(/请填写大写环境变量名/)).toBeVisible();
    fireEvent.change(screen.getByLabelText(/提供商/), {
      target: { value: "mock" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存连接引用" }));

    const profileHeading = await screen.findByRole("heading", { name: "本地演示 Mock" });
    expect(profileHeading.closest("article")).toHaveTextContent("Mock 引用 · 不使用真实密钥");
    expect(screen.getByText(/当前 deterministic demo 仍使用内置 Mock/)).toBeVisible();
  });

  it("closes the connection dialog with Escape and labels the external Skill honestly", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "连接" }));
    await waitFor(() => {
      expect(screen.queryByText("正在读取本地连接配置…")).toBeNull();
    });
    const addConnection = screen.getByRole("button", { name: "添加连接" });
    fireEvent.click(addConnection);
    expect(screen.getByRole("dialog", { name: "添加模型连接" })).toBeVisible();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "添加模型连接" })).toBeNull();
    await waitFor(() => expect(addConnection).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Skill" }));
    expect(screen.getByText("v0.1 未安装")).toBeVisible();
    expect(screen.getByLabelText("不可启用归藏社交卡片")).toBeDisabled();
    expect(screen.queryByText("沙箱运行")).toBeNull();
    expect(screen.getAllByText("声明式 · 无平台写权限")).toHaveLength(4);
  });
});
