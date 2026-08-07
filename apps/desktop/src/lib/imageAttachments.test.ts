import { describe, expect, it } from "vitest";
import { promptImageAttachmentFromAsset } from "./imageAttachments";

describe("prompt image attachments", () => {
  it("converts a local image data URL into the runtime payload", () => {
    expect(promptImageAttachmentFromAsset({
      id: "media-local",
      name: "架构图.png",
      src: "data:image/PNG;base64,aGVsbG8=",
    }, "analyze")).toEqual({
      assetId: "media-local",
      name: "架构图.png",
      mimeType: "image/png",
      data: "aGVsbG8=",
      intent: "analyze",
    });
  });

  it("does not let remote media URLs become model attachments", () => {
    expect(promptImageAttachmentFromAsset({
      id: "media-remote",
      name: "remote.png",
      src: "https://images.example.test/remote.png",
    }, "insert")).toBeNull();
  });
});
