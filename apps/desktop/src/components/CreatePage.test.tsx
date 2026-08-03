import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreatePage } from "./CreatePage";

function renderCreatePage() {
  const onCreate = vi.fn();
  render(
    <CreatePage
      generating={false}
      mediaAssets={[]}
      modelLabel="test-text-model"
      onCreate={onCreate}
      onMediaChange={vi.fn()}
      onOpenSettings={vi.fn()}
      onTemplateChange={vi.fn()}
      selectedMedia={[]}
      selectedTemplate={null}
      templates={[]}
    />,
  );
  return { onCreate };
}

describe("CreatePage", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps advanced creation inputs progressive while preserving them in the request", async () => {
    const { onCreate } = renderCreatePage();

    expect(screen.getByText("更多创作信息").closest("details")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "更多" }));

    fireEvent.change(screen.getByLabelText("文章主题"), {
      target: { value: "为本地优先写作工具准备一篇项目更新" },
    });
    fireEvent.change(screen.getByLabelText("文章标题（可选）"), {
      target: { value: "稿流 v0.2：更可靠的写作工作区" },
    });
    fireEvent.change(screen.getByLabelText("内容类型"), {
      target: { value: "项目更新" },
    });
    fireEvent.change(screen.getByLabelText("参考资料"), {
      target: { value: "本次更新包含文章修订、配图和发布前人工确认。" },
    });
    fireEvent.change(screen.getByLabelText("篇幅"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("目标字数"), { target: { value: "4600" } });

    fireEvent.click(screen.getByRole("button", { name: "开始创作" }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: "为本地优先写作工具准备一篇项目更新",
        title: "稿流 v0.2：更可靠的写作工作区",
        contentType: "项目更新",
        references: "本次更新包含文章修订、配图和发布前人工确认。",
        length: "约 4,600 字",
      }),
    );

    await waitFor(() => {
      const draft = window.localStorage.getItem("open-publisher-creation-draft-v3") ?? "";
      expect(draft).toContain("稿流 v0.2：更可靠的写作工作区");
      expect(draft).toContain("项目更新");
    });
  });

  it("opens the advanced area when a custom length is selected", () => {
    renderCreatePage();

    fireEvent.change(screen.getByLabelText("篇幅"), { target: { value: "custom" } });

    expect(screen.getByLabelText("目标字数")).toBeVisible();
  });
});
