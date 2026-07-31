import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import App from "./App";
import { desktopBridge } from "./lib/desktopBridge";

describe("desktop product flow", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    await waitFor(() =>
      expect(screen.getByLabelText("Markdown 正文")).toBeVisible(),
    );
  });

  it("creates an article from a brief and opens the generated revision", async () => {
    render(<App />);

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

  it("shows the creation stage, execution plan, and timestamped logs", async () => {
    let finishWorkflow: (() => void) | undefined;
    const originalRunWorkflow = desktopBridge.runWorkflow.bind(desktopBridge);
    vi.spyOn(desktopBridge, "runWorkflow").mockImplementation(
      (request) =>
        new Promise((resolve) => {
          finishWorkflow = () => void originalRunWorkflow(request).then(resolve);
        }),
    );
    render(<App />);

    fireEvent.change(screen.getByLabelText("文章主题"), {
      target: { value: "可观察的智能写作流程" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始创作" }));

    expect(screen.getByText("正在保存创作要求")).toBeVisible();
    expect(screen.getByText("写作 Agent")).toBeVisible();
    expect(screen.getByText(/执行日志/)).toBeVisible();
    await screen.findByText("多 Agent 工作流正在执行");
    expect(screen.getByText("多 Agent 工作流已启动")).toBeInTheDocument();

    finishWorkflow?.();
    await screen.findByLabelText("Markdown 正文");
  });

  it("keeps the same article and offers a retry after workflow failure", async () => {
    const originalRunWorkflow = desktopBridge.runWorkflow.bind(desktopBridge);
    const saveDraft = vi.spyOn(desktopBridge, "saveDraft");
    const runWorkflow = vi
      .spyOn(desktopBridge, "runWorkflow")
      .mockRejectedValueOnce(new Error("upstream timeout"))
      .mockImplementation(originalRunWorkflow);
    render(<App />);

    fireEvent.change(screen.getByLabelText("文章主题"), {
      target: { value: "失败后可恢复的写作流程" },
    });
    fireEvent.click(screen.getByRole("button", { name: "开始创作" }));

    expect(await screen.findByText("文章生成失败")).toBeVisible();
    expect(screen.getByText("失败原因：upstream timeout")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重试本次生成" }));

    await screen.findByLabelText("Markdown 正文");
    expect(runWorkflow).toHaveBeenCalledTimes(2);
    expect(runWorkflow.mock.calls[1]?.[0].articleId).toBe(
      runWorkflow.mock.calls[0]?.[0].articleId,
    );
    expect(saveDraft).toHaveBeenCalledTimes(1);
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

  it("edits and saves a local article revision", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "文章" }));
    const editor = await screen.findByLabelText("Markdown 正文");

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

  it("configures and tests the model from settings without rendering the secret", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    const keyInput = screen.getByLabelText("API Key") as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: "test-session-secret-value" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并测试" }));

    expect(await screen.findByText("Mock 模型")).toBeVisible();
    expect(screen.queryByText("test-session-secret-value")).toBeNull();
    expect(keyInput.type).toBe("password");
  });
});
