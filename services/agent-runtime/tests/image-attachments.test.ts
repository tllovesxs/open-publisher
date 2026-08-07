import { describe, expect, it } from "vitest";
import {
  arePromptImageAttachments,
  isPromptImageAttachment,
  promptImageContents,
  promptImageInstructions,
  type PromptImageAttachment,
} from "../src/agent/image-attachments.js";

const attachment: PromptImageAttachment = {
  assetId: "asset-example",
  name: "example.png",
  mimeType: "image/png",
  // A valid, padded Base64 payload. The runtime deliberately validates the
  // transport encoding rather than trying to decode every image format.
  data: "TQ==",
  intent: "analyze",
};

describe("prompt image attachments", () => {
  it("rejects malformed Base64 blocks and duplicate asset ids", () => {
    expect(isPromptImageAttachment({ ...attachment, data: "A" })).toBe(false);
    expect(isPromptImageAttachment({ ...attachment, data: "A=" })).toBe(false);
    expect(isPromptImageAttachment(attachment)).toBe(true);
    expect(arePromptImageAttachments([attachment, { ...attachment, name: "copy.png" }])).toBe(false);
  });

  it("does not pass binary image content to a text-only model", () => {
    expect(promptImageContents([attachment], false)).toEqual([]);
    expect(promptImageInstructions([attachment])).toContain("不能编造图片内容");
  });

  it("passes canonical MIME types to vision-capable model adapters", () => {
    const contents = promptImageContents([{ ...attachment, mimeType: "IMAGE/PNG" }], true);

    expect(contents).toEqual([{
      type: "image",
      data: attachment.data,
      mimeType: "image/png",
    }]);
  });
});
