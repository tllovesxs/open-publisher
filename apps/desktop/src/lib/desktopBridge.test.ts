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

    const workflow = await desktopBridge.runWorkflow({
      articleId: "article-1",
      revisionId: receipt.revisionId,
      topic: "Local-first",
      disabledOptionalNodeIds: ["research", "natural-style"],
    });
    expect(workflow.status).toBe("completed");
    expect(workflow.artifacts).toHaveLength(5);
    expect(workflow.outputRevisionId).not.toBe(receipt.revisionId);
    expect(workflow.outputMarkdown).toContain("# draft");
    expect(workflow).not.toHaveProperty("endpoint");
    expect(workflow).not.toHaveProperty("token");
    expect(workflow).not.toHaveProperty("contentPackage");

    const draftPlan = await desktopBridge.createPublishPlan({
      articleId: "article-1",
      revisionId: workflow.outputRevisionId,
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
    expect(image.mediaTypes).toEqual(["image/svg+xml"]);
    expect(image).not.toHaveProperty("prompt");
    expect(image).not.toHaveProperty("storagePath");

    expect(await desktopBridge.listConnectionProfiles()).toEqual([]);
    const profile = await desktopBridge.createConnectionProfile({
      name: "Deterministic mock",
      provider: "mock",
      baseUrl: null,
      secretEnvVar: null,
      defaultTextModel: "mock-text",
      defaultImageModel: "mock-image",
      timeoutSeconds: 30,
    });
    expect(profile.secretScheme).toBe("mock");
    expect(profile).not.toHaveProperty("secretRef");
    expect(profile).not.toHaveProperty("secretEnvVar");
    expect(profile).not.toHaveProperty("apiKey");
    expect(profile).not.toHaveProperty("endpoint");
    expect(profile).not.toHaveProperty("token");
    expect(await desktopBridge.listConnectionProfiles()).toEqual([profile]);
  });
});
