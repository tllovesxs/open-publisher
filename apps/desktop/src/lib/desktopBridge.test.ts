import { desktopBridge } from "./desktopBridge";

describe("desktopBridge browser fallback", () => {
  it("keeps the frontend on the narrow Rust-shaped contract", async () => {
    const snapshot = await desktopBridge.runtimeSnapshot();
    expect(snapshot.bridgeMode).toBe("interface_only");
    expect(snapshot).not.toHaveProperty("endpoint");
    expect(snapshot).not.toHaveProperty("apiKey");

    const receipt = await desktopBridge.saveDraft({
      articleId: "article-1",
      baseRevision: null,
      markdown: "# draft",
    });
    expect(receipt.revisionId).toContain("article-1-local");
    expect(receipt.persistence).toBe("memory");

    const summary = await desktopBridge.runDemo({
      title: "Demo",
      topic: "Local-first",
      sourceMarkdown: "# draft",
      platforms: ["wechat", "csdn"],
    });
    expect(summary.runStatus).toBe("completed");
    expect(summary.receipts).toHaveLength(2);
    expect(summary).not.toHaveProperty("endpoint");
    expect(summary).not.toHaveProperty("token");
    expect(summary).not.toHaveProperty("contentPackage");
  });
});
