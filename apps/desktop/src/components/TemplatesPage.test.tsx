import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TemplatesPage } from "./TemplatesPage";
import type { MarkdownTemplate } from "../types";

const template: MarkdownTemplate = {
  id: "template-1",
  name: "基础模板",
  description: "用于测试。",
  category: "测试",
  markdown: "# {{title}}\n\n{{lead}}",
  styleProfile: {
    tone: "清晰",
    audience: "读者",
    perspective: "作者",
    sentenceStyle: "短句",
    pacing: "递进",
    density: "中等",
  },
  structureProfile: {
    openingPattern: "结论",
    sectionPattern: "章节",
    conclusionPattern: "总结",
    headingDepth: "二级",
    paragraphPattern: "一段一要点",
  },
  layoutProfile: {
    useLists: true,
    useTables: false,
    useBlockquotes: false,
    useCodeBlocks: false,
    imagePlacement: "章节后",
    emphasisRules: "加粗关键词",
  },
  fixedBlocks: [],
  variables: ["title", "lead"],
  usageInstructions: "填写内容。",
  isBuiltIn: true,
};

describe("TemplatesPage", () => {
  it("releases a stalled extraction for retry", async () => {
    vi.useFakeTimers();
    try {
      render(
        <TemplatesPage
          onChange={vi.fn()}
          onExtractTemplate={() => new Promise<MarkdownTemplate>(() => undefined)}
          onSelect={vi.fn()}
          onStartCreating={vi.fn()}
          selectedTemplateId={template.id}
          templates={[template]}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "创建参考模板" }));
      fireEvent.change(screen.getByLabelText("原始 Markdown"), {
        target: { value: "# 一篇参考文章\n\n正文" },
      });
      fireEvent.click(screen.getByRole("checkbox", { name: /我确认拥有这篇文章的使用授权/ }));
      fireEvent.click(screen.getByRole("button", { name: "分析参考模板" }));

      expect(screen.getByRole("button", { name: "停止等待" })).toBeEnabled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(90_000);
      });

      expect(screen.getByRole("alert")).toHaveTextContent("分析等待超过 90 秒");
      expect(screen.getByRole("button", { name: "重新分析" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });
});
