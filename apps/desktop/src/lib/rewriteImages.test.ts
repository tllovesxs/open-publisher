import { describe, expect, it } from "vitest";
import { articleImages, reconcileRewriteImages } from "./rewriteImages";

describe("reconcileRewriteImages", () => {
  it("restores an original asset image when a whole-article rewrite omits it", () => {
    const image = "![流程截图](asset://generated-flow-image)";
    const source = `# 原标题\n\n原来的开场。\n\n${image}\n\n## 功能\n\n原来的功能介绍。`;
    const replacement = "# 新标题\n\n重新写过的开场。\n\n## 使用方式\n\n重新组织后的正文。";

    const result = reconcileRewriteImages(source, replacement);

    expect(result.markdown).toContain("重新写过的开场");
    expect(articleImages(result.markdown)).toEqual([image]);
    expect(result.preservedCount).toBe(1);
  });

  it("keeps multiple original images once and in their original order", () => {
    const first = "![第一张](asset://first-image)";
    const second = '<img src="asset://second-image" alt="第二张">';
    const source = `# 标题\n\n第一段。\n\n${first}\n\n第二段。\n\n${second}\n\n第三段。`;
    const replacement = `# 新标题\n\n新第一段。\n\n${first}\n\n新第二段。\n\n${first}`;

    const result = reconcileRewriteImages(source, replacement);

    expect(articleImages(result.markdown)).toEqual([first, second]);
    expect(result.discardedCandidateCount).toBe(2);
  });

  it("drops model-invented images from a text-only rewrite", () => {
    const result = reconcileRewriteImages(
      "# 标题\n\n原文没有图片。",
      "# 新标题\n\n新正文。\n\n![模型擅自添加](https://example.com/image.png)",
    );

    expect(articleImages(result.markdown)).toEqual([]);
    expect(result.markdown).toContain("新正文");
    expect(result.discardedCandidateCount).toBe(1);
  });
});
