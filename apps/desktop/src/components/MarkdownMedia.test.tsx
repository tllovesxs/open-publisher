import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";
import { MarkdownWorkbench } from "./MarkdownWorkbench";
import { ImageInsertDialog } from "./ImageInsertDialog";
import { generatedMediaAssetId } from "../lib/mediaReferences";

const platforms = [
  { id: "csdn" as const, name: "CSDN", shortName: "CSDN", limit: "", status: "connected" as const },
];

function WorkbenchHarness({ onImageFileDrop = vi.fn() }: { onImageFileDrop?: (file: File) => Promise<{ alt: string; src: string }> }) {
  const [markdown, setMarkdown] = useState("开头");
  return (
    <>
      <MarkdownWorkbench dirty editorMode="edit" markdown={markdown} onEditorModeChange={() => undefined} onImageFileDrop={onImageFileDrop} onMarkdownChange={setMarkdown} onPlatformChange={() => undefined} platforms={platforms} selectedPlatform="csdn" />
      <output>{markdown}</output>
    </>
  );
}

describe("Markdown media support", () => {
  it("converts generated runtime IDs into Markdown-safe media IDs", () => {
    expect(generatedMediaAssetId("asset:8676efc7-42ff-493a-9606-c52b1cb35689"))
      .toBe("generated-asset-8676efc7-42ff-493a-9606-c52b1cb35689");
  });

  it("renders only safe Markdown image sources", () => {
    const { rerender } = render(<MarkdownPreview markdown="![封面](https://cdn.example.com/cover.png)" />);
    expect(screen.getByRole("img", { name: "封面" })).toHaveAttribute("src", "https://cdn.example.com/cover.png");

    const localSource =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLZ8QAAAABJRU5ErkJggg==";
    rerender(
      <MarkdownPreview
        markdown="![本机素材](asset://media-local)"
        mediaAssets={[{ id: "media-local", src: localSource }]}
      />,
    );
    expect(screen.getByRole("img", { name: "本机素材" })).toHaveAttribute("src", localSource);

    rerender(
      <MarkdownPreview
        markdown="![旧版生图](asset://generated-asset:8676efc7-42ff-493a-9606-c52b1cb35689)"
        mediaAssets={[{ id: "generated-asset:8676efc7-42ff-493a-9606-c52b1cb35689", src: localSource }]}
      />,
    );
    expect(screen.getByRole("img", { name: "旧版生图" })).toHaveAttribute("src", localSource);

    rerender(
      <MarkdownPreview
        markdown="![新版生图](asset://generated-asset-8676efc7-42ff-493a-9606-c52b1cb35689)"
        mediaAssets={[{ id: "generated-asset-8676efc7-42ff-493a-9606-c52b1cb35689", src: localSource }]}
      />,
    );
    expect(screen.getByRole("img", { name: "新版生图" })).toHaveAttribute("src", localSource);

    rerender(<MarkdownPreview markdown="![不安全](javascript:alert(1))" />);
    expect(screen.queryByRole("img", { name: "不安全" })).toBeNull();
  });

  it("inserts a media-card Markdown payload at the selection", () => {
    render(<WorkbenchHarness />);
    const editor = screen.getByLabelText("Markdown 正文") as HTMLTextAreaElement;
    editor.setSelectionRange(2, 2);
    fireEvent.drop(editor, {
      dataTransfer: {
        files: [],
        getData: (type: string) => type === "application/x-open-publisher-markdown-image" ? "![图](https://cdn.example.com/image.png)" : "",
      },
    });
    expect((screen.getByLabelText("Markdown 正文") as HTMLTextAreaElement).value).toContain("![图](https://cdn.example.com/image.png)");
  });

  it("imports a dropped image through the supplied async callback", async () => {
    const importImage = vi.fn().mockResolvedValue({ alt: "本地图片", src: "https://cdn.example.com/local.png" });
    render(<WorkbenchHarness onImageFileDrop={importImage} />);
    const editor = screen.getByLabelText("Markdown 正文") as HTMLTextAreaElement;
    fireEvent.drop(editor, {
      dataTransfer: {
        files: [new File(["image"], "local.png", { type: "image/png" })],
        getData: () => "",
      },
    });
    await waitFor(() => expect(importImage).toHaveBeenCalledTimes(1));
    expect((screen.getByLabelText("Markdown 正文") as HTMLTextAreaElement).value).toContain("![本地图片](https://cdn.example.com/local.png)");
  });

  it("imports a pasted image through the supplied async callback", async () => {
    const importImage = vi.fn().mockResolvedValue({ alt: "剪贴板图片", src: "asset://media-pasted" });
    render(<WorkbenchHarness onImageFileDrop={importImage} />);
    const editor = screen.getByLabelText("Markdown 正文") as HTMLTextAreaElement;
    fireEvent.paste(editor, {
      clipboardData: {
        files: [new File(["image"], "pasted.png", { type: "image/png" })],
      },
    });
    await waitFor(() => expect(importImage).toHaveBeenCalledTimes(1));
    expect(editor.value).toContain("![剪贴板图片](asset://media-pasted)");
  });

  it("offers the selected Markdown range to the AI editor", () => {
    const onRequestSelectionRewrite = vi.fn();
    render(
      <MarkdownWorkbench
        dirty
        editorMode="edit"
        markdown="开头内容，选中这段文字。"
        onEditorModeChange={() => undefined}
        onMarkdownChange={() => undefined}
        onPlatformChange={() => undefined}
        onRequestSelectionRewrite={onRequestSelectionRewrite}
        platforms={platforms}
        selectedPlatform="csdn"
      />,
    );
    const editor = screen.getByLabelText("Markdown 正文") as HTMLTextAreaElement;
    editor.setSelectionRange(5, 11);
    fireEvent.select(editor);

    fireEvent.click(screen.getByRole("button", { name: "AI 修改选中内容" }));
    expect(onRequestSelectionRewrite).toHaveBeenCalledWith({
      start: 5,
      end: 11,
      text: "选中这段文字",
    });
  });

  it("uses one display-mode selector for editing and preview", () => {
    const onEditorModeChange = vi.fn();
    render(
      <MarkdownWorkbench
        dirty
        editorMode="split"
        markdown="同步内容"
        onEditorModeChange={onEditorModeChange}
        onMarkdownChange={() => undefined}
        onPlatformChange={() => undefined}
        platforms={platforms}
        selectedPlatform="csdn"
      />,
    );

    const selector = screen.getByRole("combobox", { name: "编辑器布局" });
    expect(selector).toHaveValue("split");
    fireEvent.change(selector, { target: { value: "preview" } });
    expect(onEditorModeChange).toHaveBeenCalledWith("preview");
  });

  it("syncs source and preview scroll positions by their own scroll ranges", () => {
    render(
      <MarkdownWorkbench
        dirty
        editorMode="split"
        markdown="很长的内容"
        onEditorModeChange={() => undefined}
        onMarkdownChange={() => undefined}
        onPlatformChange={() => undefined}
        platforms={platforms}
        selectedPlatform="csdn"
      />,
    );

    const editor = screen.getByLabelText("Markdown 正文") as HTMLTextAreaElement;
    const preview = document.querySelector(".preview-pane") as HTMLDivElement;
    Object.defineProperties(editor, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1_000 },
    });
    Object.defineProperties(preview, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 2_200 },
    });

    editor.scrollTop = 400;
    fireEvent.scroll(editor);
    expect(preview.scrollTop).toBe(1_000);

    preview.scrollTop = 1_500;
    fireEvent.scroll(preview);
    expect(editor.scrollTop).toBe(600);
  });

  it("keeps the last-scrolled pane as the proportional source after a resize", async () => {
    render(
      <MarkdownWorkbench
        dirty
        editorMode="split"
        markdown="很长的内容"
        onEditorModeChange={() => undefined}
        onMarkdownChange={() => undefined}
        onPlatformChange={() => undefined}
        platforms={platforms}
        selectedPlatform="csdn"
      />,
    );

    const editor = screen.getByLabelText("Markdown 正文") as HTMLTextAreaElement;
    const preview = document.querySelector(".preview-pane") as HTMLDivElement;
    Object.defineProperties(editor, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1_000 },
    });
    Object.defineProperties(preview, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 2_200 },
    });

    editor.scrollTop = 400;
    fireEvent.scroll(editor);
    expect(preview.scrollTop).toBe(1_000);

    Object.defineProperty(preview, "scrollHeight", { configurable: true, value: 4_200 });
    window.dispatchEvent(new Event("resize"));
    await waitFor(() => expect(preview.scrollTop).toBe(2_000));

    preview.scrollTop = 1_500;
    fireEvent.scroll(preview);
    expect(editor.scrollTop).toBe(300);

    Object.defineProperty(editor, "scrollHeight", { configurable: true, value: 1_800 });
    window.dispatchEvent(new Event("resize"));
    await waitFor(() => expect(editor.scrollTop).toBe(600));
  });

  it("does not treat a synchronized preview scroll event as a new user source", async () => {
    render(
      <MarkdownWorkbench
        dirty
        editorMode="split"
        markdown="很长的内容"
        onEditorModeChange={() => undefined}
        onMarkdownChange={() => undefined}
        onPlatformChange={() => undefined}
        platforms={platforms}
        selectedPlatform="csdn"
      />,
    );

    const editor = screen.getByLabelText("Markdown 正文") as HTMLTextAreaElement;
    const preview = document.querySelector(".preview-pane") as HTMLDivElement;
    Object.defineProperties(editor, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1_000 },
    });
    Object.defineProperties(preview, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 2_200 },
    });

    editor.scrollTop = 400;
    fireEvent.scroll(editor);
    expect(preview.scrollTop).toBe(1_000);

    // Browsers emit this event after assigning preview.scrollTop above. It
    // must not make preview the source just because the renderer synchronized it.
    fireEvent.scroll(preview);
    Object.defineProperty(preview, "scrollHeight", { configurable: true, value: 4_200 });
    window.dispatchEvent(new Event("resize"));

    await waitFor(() => expect(preview.scrollTop).toBe(2_000));
    expect(editor.scrollTop).toBe(400);
  });

  it("inserts a material-library image from the image dialog", () => {
    const onInsert = vi.fn();
    const onClose = vi.fn();
    render(
      <ImageInsertDialog
        assets={[
          {
            id: "media-architecture",
            name: "产品架构图",
            alt: "三层产品架构",
            description: "展示采集、编排、发布三层的数据流。",
            src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLZ8QAAAABJRU5ErkJggg==",
            source: "uploaded",
            createdAt: "刚刚",
          },
        ]}
        onClose={onClose}
        onImportFile={vi.fn()}
        onInsert={onInsert}
        open
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /产品架构图/ }));
    expect(onInsert).toHaveBeenCalledWith({
      alt: "三层产品架构",
      src: "asset://media-architecture",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
