import { describe, expect, it } from "vitest";
import { publishMediaSourcesForMarkdown } from "./mediaReferences";

describe("publishMediaSourcesForMarkdown", () => {
  it("projects referenced local images once without including unused assets", () => {
    const image = "data:image/png;base64,aW1hZ2U=";
    const result = publishMediaSourcesForMarkdown(
      [
        "![产品截图](asset://media-product)",
        '<img src="asset://media-product" alt="重复引用">',
      ].join("\n\n"),
      [
        { id: "media-product", src: image },
        { id: "media-unused", src: "https://cdn.example.com/unused.png" },
      ],
    );

    expect(result).toEqual({
      sources: [{ assetId: "media-product", source: image }],
      missingAssetIds: [],
    });
  });

  it("reports references whose local image payload is unavailable", () => {
    expect(publishMediaSourcesForMarkdown(
      "![缺失图片](asset://media-missing)",
      [],
    )).toEqual({
      sources: [],
      missingAssetIds: ["media-missing"],
    });
  });
});
