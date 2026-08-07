import { describe, expect, it } from "vitest";
import {
  ARTICLE_VISUAL_MATCH_REFRESH_THRESHOLD,
  estimateArticleVisualMatch,
} from "./visualMatch";

const image = "![产品流程](asset://product-flow)";

describe("estimateArticleVisualMatch", () => {
  it("does not request visual review when the article has no images", () => {
    expect(estimateArticleVisualMatch("# 标题\n\n正文", "# 新标题\n\n新正文")).toBeNull();
  });

  it("reports a perfect match when only image markup is preserved", () => {
    const article = `# 标题\n\n这是产品流程介绍和使用方法。\n\n${image}`;
    expect(estimateArticleVisualMatch(article, article)).toBe(100);
  });

  it("flags a completely changed article as a weak visual match", () => {
    const before = `# 项目介绍\n\n${"项目写作发布流程功能说明".repeat(40)}\n\n${image}`;
    const after = `# 旅行记录\n\n${"海边落日餐厅住宿行程体验".repeat(40)}`;
    expect(estimateArticleVisualMatch(before, after)).toBeLessThan(ARTICLE_VISUAL_MATCH_REFRESH_THRESHOLD);
  });

  it("keeps a small local edit above the refresh threshold", () => {
    const body = "项目支持写作、配图和发布，并保留每次文章修订。".repeat(40);
    const before = `# 项目介绍\n\n${body}\n\n${image}`;
    const after = `# 项目介绍\n\n开头表达已经优化。${body}\n\n${image}`;
    expect(estimateArticleVisualMatch(before, after)).toBeGreaterThanOrEqual(ARTICLE_VISUAL_MATCH_REFRESH_THRESHOLD);
  });
});
