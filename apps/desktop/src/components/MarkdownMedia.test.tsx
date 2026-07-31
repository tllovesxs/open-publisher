import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";
import { MarkdownWorkbench } from "./MarkdownWorkbench";

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
});
