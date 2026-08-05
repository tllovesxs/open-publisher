import { describe, expect, it } from "vitest";
import { TemplateService, type TemplateTextModel } from "../src/agent/template-service.js";

const source = `# 原始文章

开篇先提出问题。

## 解释

![示意图](https://example.com/image.png)

- 第一条
> 一段引用
`;

const model = (text: string): TemplateTextModel => ({
  generate: async () => ({ text, provider: "test-provider", model: "test-model", mocked: true }),
});

describe("TemplateService", () => {
  it("preserves the local source reference, sanitizes model output, and always clears fixed blocks", async () => {
    const result = await new TemplateService(model(JSON.stringify({
      name: "  深度文章  ",
      description: " 保留结构节奏 ",
      category: " 技术 ",
      markdown: "# 原始文章\n\n访问 https://example.com/docs\n\n![图](https://example.com/x.png)",
      style_profile: { sentence_style: "短句推进" },
      structureProfile: { openingPattern: "问题切入" },
      layout_profile: { use_lists: false },
      fixedBlocks: [{ content: "不应迁移" }],
      usage_instructions: "按段落动作复用。",
    }))).extract(source);

    expect(result).toMatchObject({
      name: "深度文章",
      referenceMarkdown: source.trim(),
      provider: "test-provider",
      mocked: true,
      fixedBlocks: [],
      styleProfile: { sentenceStyle: "短句推进" },
      structureProfile: { openingPattern: "问题切入" },
      layoutProfile: { useLists: false },
    });
    expect(result.markdown).toContain("{{title}}");
    expect(result.markdown).toContain("{{reference_url}}");
    expect(result.markdown).toContain("{{image_url}}");
    expect(result.markdown).not.toContain("example.com");
    expect(result.sourceFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("returns an inspectable local structural fallback for malformed model JSON", async () => {
    const result = await new TemplateService(model("not JSON at all")).extract(source);

    expect(result).toMatchObject({
      name: "高保真本地参考模板",
      provider: "test-provider",
      model: "test-model",
      referenceMarkdown: source.trim(),
      fixedBlocks: [],
    });
    expect(result.description).toContain("模型结果不完整");
    expect(result.markdown).toContain("{{section_1_heading}}");
    expect(result.markdown).toContain("{{image_1_url}}");
    expect(result.layoutProfile).toMatchObject({ useLists: true, useBlockquotes: true });
  });
});
