import {
  desktopBridge,
  setDesktopBridgeForTests,
  testOnlyMockDesktopBridge,
} from "./desktopBridge";

describe("desktopBridge browser preview boundary", () => {
  afterEach(() => {
    setDesktopBridgeForTests(null);
  });

  it("does not simulate writes or Agent execution outside the desktop host", async () => {
    const snapshot = await desktopBridge.piRuntimeSnapshot();
    expect(snapshot).toMatchObject({
      state: "standby",
      bridgeMode: "interface_only",
    });
    expect(snapshot.detail).toContain("浏览器预览不能调用 Pi Agent Runtime");
    await expect(
      desktopBridge.saveDraft({
        articleId: "article-1",
        baseRevision: null,
        markdown: "# draft",
      }),
    ).rejects.toThrow(/桌面应用/);
    await expect(
      desktopBridge.generateImage({
        prompt: "A restrained editorial cover",
        size: "1536x1024",
        model: null,
      }),
    ).rejects.toThrow(/桌面应用/);
    expect(await desktopBridge.listArticles()).toEqual([]);
  });

  it("keeps the test-only mock on the narrow Rust-shaped contract", async () => {
    setDesktopBridgeForTests(testOnlyMockDesktopBridge);
    const snapshot = await desktopBridge.piRuntimeSnapshot();
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
    const storedArticles = await desktopBridge.listArticles();
    expect(storedArticles).toHaveLength(1);
    expect(storedArticles[0]).toMatchObject({
      articleId: "article-1",
      markdown: "# draft",
      revisionId: receipt.revisionId,
      revisionNumber: 1,
    });

    const draftPlan = await desktopBridge.createPublishPlan({
      articleId: "article-1",
      revisionId: receipt.revisionId,
      platforms: ["wechat", "csdn"],
    });
    expect(draftPlan.status).toBe("draft");
    expect(draftPlan.approvalStatus).toBe("pending");
    expect(draftPlan.variants).toHaveLength(2);
    expect(draftPlan.jobs).toHaveLength(0);
    await expect(
      desktopBridge.enqueuePublishPlan({ planId: draftPlan.planId }),
    ).rejects.toThrow(/approved/);

    const approvedPlan = await desktopBridge.approvePublishPlan({
      planId: draftPlan.planId,
    });
    expect(approvedPlan.approvalStatus).toBe("approved");

    const firstEnqueue = await desktopBridge.enqueuePublishPlan({
      planId: draftPlan.planId,
    });
    const secondEnqueue = await desktopBridge.enqueuePublishPlan({
      planId: draftPlan.planId,
    });
    expect(firstEnqueue.jobs.map((job) => job.id)).toEqual(
      secondEnqueue.jobs.map((job) => job.id),
    );
    expect(firstEnqueue.jobs).toHaveLength(2);

    const publishResults = await Promise.all(
      firstEnqueue.jobs.map((job) =>
        desktopBridge.processPublishJob({ jobId: job.id }),
      ),
    );
    expect(publishResults.map((result) => result.receipt)).not.toContain(null);
    expect(publishResults.map((result) => result.job.state)).toEqual([
      "succeeded",
      "succeeded",
    ]);

    const completedPlan = await desktopBridge.getPublishPlan({
      planId: draftPlan.planId,
    });
    expect(completedPlan.status).toBe("completed");
    expect(completedPlan.jobs.every((job) => job.operation === "dry_run")).toBe(true);

    const image = await desktopBridge.generateImage({
      prompt: "A restrained editorial cover",
      size: "1536x1024",
      model: null,
    });
    expect(image.artifactCount).toBe(1);
    expect(image.mediaTypes).toEqual(["image/png"]);
    expect(image.images[0]?.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(image).not.toHaveProperty("prompt");
    expect(image).not.toHaveProperty("storagePath");

    const template = await desktopBridge.extractTemplate({
      sourceMarkdown: "# 原始文章\n\n## 一段结构\n\n具体事实和链接不应保留。",
    });
    expect(template).toMatchObject({
      name: "高保真参考模板",
      provider: "mock",
      mocked: true,
    });
    expect(template.markdown).toContain("{{title}}");
    expect(template.markdown).not.toContain("原始文章");
    expect(template).not.toHaveProperty("sourceMarkdown");

    const configuration = await desktopBridge.configureModel({
      name: "Session model",
      profileId: "session-model",
      baseUrl: "https://example.com/v1",
      textProtocol: "openai-completions",
      textApiKey: "test-only-secret",
      textModel: "test-text-model",
      textSupportsVision: false,
      textReasoning: false,
      textThinkingLevel: "off",
      textContextWindow: 128000,
      textMaxTokens: 16384,
      imageBaseUrl: null,
      imageModel: null,
      imageApiKey: "",
      imageTrustedHosts: [],
      tavilyApiKey: "",
      githubToken: "",
      timeoutSeconds: 30,
    });
    expect(configuration).toMatchObject({
      name: "Session model",
      textModel: "test-text-model",
      secretConfigured: true,
      webSearchConfigured: false,
      persistence: "encrypted_local_database",
    });
    expect(configuration).not.toHaveProperty("apiKey");
    expect(await desktopBridge.modelConfiguration()).toEqual(configuration);
    expect(await desktopBridge.testModelConnection()).toMatchObject({
      provider: "mock",
      mocked: true,
    });
  });
});
