import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { MediaPage } from "./MediaPage";

const asset = {
  id: "media-architecture",
  name: "产品架构图",
  alt: "三个服务的架构图",
  description: "展示采集、编排和发布三个服务的关系。",
  visualDescription: "展示采集、编排和发布三个服务的关系。",
  usageHint: "适合放在架构说明之后。",
  tags: ["架构", "流程"],
  src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLZ8QAAAABJRU5ErkJggg==",
  source: "uploaded" as const,
  createdAt: "刚刚导入",
};

function renderPage(overrides: Partial<ComponentProps<typeof MediaPage>> = {}) {
  const props: ComponentProps<typeof MediaPage> = {
    assets: [asset],
    hasSelectedArticle: true,
    onAdd: vi.fn(),
    onInsertInArticle: vi.fn(),
    onSelectionChange: vi.fn(),
    onStartCreating: vi.fn(),
    onUpdate: vi.fn(),
    selectedAssetIds: [],
    ...overrides,
  };
  return { ...render(<MediaPage {...props} />), props };
}

describe("MediaPage", () => {
  it("keeps the gallery image-first and edits descriptions in the detail drawer", () => {
    const { props } = renderPage();

    expect(screen.queryByLabelText("产品架构图的图片内容描述")).toBeNull();
    expect(screen.getByText("展示采集、编排和发布三个服务的关系。")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "查看产品架构图" }));
    expect(screen.getByRole("dialog", { name: "产品架构图的详情" })).toBeVisible();

    fireEvent.change(screen.getByLabelText("图片内容描述"), {
      target: { value: "新的图片内容描述" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存说明" }));

    expect(props.onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      id: "media-architecture",
      description: "新的图片内容描述",
      visualDescription: "新的图片内容描述",
      descriptionSource: "manual",
    }));
  });

  it("filters gallery cards and preserves the existing selection callback", () => {
    const { props } = renderPage();

    fireEvent.click(screen.getByRole("button", { name: "选择产品架构图" }));
    expect(props.onSelectionChange).toHaveBeenCalledWith(["media-architecture"]);

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索图片、说明或标签" }), {
      target: { value: "不存在的关键词" },
    });
    expect(screen.getByText("没有符合条件的素材")).toBeVisible();
  });
});
