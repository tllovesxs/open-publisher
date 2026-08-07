import { describe, expect, it } from "vitest";
import { inferCreationTaskMode } from "./creationIntent";

describe("creation intent", () => {
  it("treats Markdown formatting of an attached source as a transformation", () => {
    expect(inferCreationTaskMode({
      instruction: "给这个内容加一下md格式并配图",
      hasReferenceText: false,
      hasImages: true,
    })).toBe("transform");
  });

  it("keeps an explicit new article request in creation mode", () => {
    expect(inferCreationTaskMode({
      instruction: "用 Markdown 格式写一篇 Rust 分布式锁介绍",
      hasReferenceText: false,
      hasImages: false,
    })).toBe("create");
  });

  it("routes editing of supplied text to transformation mode", () => {
    expect(inferCreationTaskMode({
      instruction: "把下面这段内容润色一下",
      hasReferenceText: true,
      hasImages: false,
    })).toBe("transform");
  });
});
