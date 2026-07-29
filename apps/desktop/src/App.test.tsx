import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";

describe("desktop workspace", () => {
  beforeEach(() => {
    window.localStorage.clear();
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

  it("runs the workflow and opens a real platform preview", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "运行工作流" }));
    await waitFor(() => {
      expect((screen.getByRole("button", { name: "运行中" }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "打开平台预览" }));
    const dialog = screen.getByRole("dialog", { name: "平台预览" });
    expect(dialog).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "CSDN" }));
    expect(screen.getByText("平台预览 · 不会实际发布")).toBeTruthy();
  });
});
