import { describe, expect, it, vi } from "vitest";
import { createRuntimeApp } from "../src/api/app.js";
import type { WriterService } from "../src/agent/writer-service.js";
import type { RewriteService } from "../src/agent/rewrite-service.js";
import type { VisualPlanningService } from "../src/agent/visual-planning-service.js";
import type { RuntimeConfig } from "../src/config.js";
import { SecretLeaseStore } from "../src/security/secret-provider.js";
import { ArticleStore } from "../src/storage/article-store.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const config: RuntimeConfig = {
  host: "127.0.0.1",
  port: 43123,
  token: "test-runtime-token",
  dataDir: "C:\\runtime-data",
  articleDir: "C:\\runtime-data\\articles",
  protocolVersion: "2",
};

describe("runtime API", () => {
  it("provides unauthenticated liveness", async () => {
    const app = createRuntimeApp({
      config,
      readiness: () => ({ ready: true, checks: { storage: "ready" } }),
    });

    const response = await app.request("/health/live");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "live",
      protocolVersion: "2",
    });
  });

  it("rejects v2 endpoints without the launch token", async () => {
    const app = createRuntimeApp({
      config,
      readiness: () => ({ ready: true, checks: { storage: "ready" } }),
    });

    const response = await app.request("/v2/version");

    expect(response.status).toBe(401);
  });

  it("reports the pinned Pi Runtime version to an authenticated host", async () => {
    const app = createRuntimeApp({
      config,
      readiness: () => ({ ready: true, checks: { storage: "ready" } }),
    });

    const response = await app.request("/v2/version", {
      headers: { Authorization: `Bearer ${config.token}` },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      schemaVersion: "2",
      runtimeVersion: "0.3.0",
      piAgentVersion: "0.83.0",
      engine: "pi",
    });
  });

  it("returns 503 until durable storage is ready", async () => {
    const app = createRuntimeApp({
      config,
      readiness: () => ({ ready: false, checks: { storage: "pending" } }),
    });

    const response = await app.request("/health/ready");

    expect(response.status).toBe(503);
  });

  it("lists articles and commits draft revisions through authenticated v2 endpoints", async () => {
    const articleStore = new ArticleStore(await mkdtemp(join(tmpdir(), "open-publisher-api-")));
    await articleStore.initialize();
    const app = createRuntimeApp({
      config,
      readiness: () => ({ ready: true, checks: { storage: "ready" } }),
      articleStore,
    });
    const headers = {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    };

    const commit = await app.request("/v2/articles", {
      method: "POST",
      headers,
      body: JSON.stringify({
        schemaVersion: "2",
        articleId: "article:api",
        baseRevisionId: null,
        baseContentHash: null,
        title: "API article",
        markdown: "# API article",
        reason: "save draft",
      }),
    });

    expect(commit.status).toBe(201);
    const saved = await commit.json() as { currentRevisionId: string; contentHash: string };
    const list = await app.request("/v2/articles", { headers });
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toEqual({
      articles: [expect.objectContaining({ articleId: "article:api", title: "API article" })],
    });

    const revision = await app.request("/v2/articles", {
      method: "POST",
      headers,
      body: JSON.stringify({
        schemaVersion: "2",
        articleId: "article:api",
        baseRevisionId: saved.currentRevisionId,
        baseContentHash: saved.contentHash,
        title: "Updated API article",
        markdown: "# Updated API article",
        reason: "revise draft",
      }),
    });
    expect(revision.status).toBe(201);
    await expect(revision.json()).resolves.toMatchObject({ title: "Updated API article" });
  });

  it("rejects invalid and stale article commits", async () => {
    const articleStore = new ArticleStore(await mkdtemp(join(tmpdir(), "open-publisher-api-")));
    await articleStore.initialize();
    const app = createRuntimeApp({
      config,
      readiness: () => ({ ready: true, checks: { storage: "ready" } }),
      articleStore,
    });
    const headers = {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    };
    const invalid = await app.request("/v2/articles", {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    expect(invalid.status).toBe(400);

    await articleStore.commit({
      schemaVersion: "2",
      articleId: "article:conflict",
      baseRevisionId: null,
      baseContentHash: null,
      title: "Current",
      markdown: "# Current",
      reason: "create",
    });
    const stale = await app.request("/v2/articles", {
      method: "POST",
      headers,
      body: JSON.stringify({
        schemaVersion: "2",
        articleId: "article:conflict",
        baseRevisionId: "revision:stale",
        baseContentHash: `sha256:${"0".repeat(64)}`,
        title: "Stale",
        markdown: "# Stale",
        reason: "stale write",
      }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: "ARTICLE_CONFLICT", retryable: true },
    });
  });

  it("plans visuals only against the current canonical article revision", async () => {
    const articleStore = new ArticleStore(await mkdtemp(join(tmpdir(), "open-publisher-api-")));
    await articleStore.initialize();
    const article = await articleStore.commit({
      schemaVersion: "2",
      articleId: "article:visual",
      baseRevisionId: null,
      baseContentHash: null,
      title: "Visual article",
      markdown: "# Visual article\n\nExplain a publish workflow.",
      reason: "create",
    });
    const plan = vi.fn(async (request: { sourceRevisionHash: string }) => ({
      plan: {
        sourceRevisionHash: request.sourceRevisionHash,
        targetCount: 1,
        settings: { type: "flowchart" },
        needsConfirmation: true,
        placements: [],
      },
      provider: "local-deterministic",
      model: "baoyu-article-illustrator-rules-v1",
      mocked: false,
      provenance: "local_deterministic" as const,
      fallbackReason: "No text model profile was supplied",
    }));
    const app = createRuntimeApp({
      config,
      readiness: () => ({ ready: true, checks: { storage: "ready" } }),
      articleStore,
      visualPlanningService: { plan } as unknown as VisualPlanningService,
    });
    const headers = { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" };
    const body = {
      articleId: article.articleId,
      markdown: article.markdown,
      sourceRevisionHash: article.contentHash,
      instruction: "请配一张流程图",
      visualComposition: {
        mode: "fixed",
        targetCount: 1,
        assets: [],
        assetScope: "none",
        preferredType: "flowchart",
        density: "balanced",
        style: "sketch-notes",
        palette: "macaron",
        preferredImageBackend: "auto",
        generationBatchSize: 2,
        materialMatchThreshold: 30,
        skipConfirmation: false,
      },
    };

    const response = await app.request("/v2/visual/plan", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      plan: { sourceRevisionHash: article.contentHash },
      provenance: "local_deterministic",
      mocked: false,
    });
    expect(plan).toHaveBeenCalledWith(expect.objectContaining({
      markdown: article.markdown,
      sourceRevisionHash: article.contentHash,
    }), undefined);

    const stale = await app.request("/v2/visual/plan", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, markdown: "# stale" }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: "VISUAL_REVISION_NOT_CURRENT", retryable: true },
    });
  });

  it("starts an authenticated non-mutating rewrite-candidate run", async () => {
    const run = {
      schemaVersion: "2" as const,
      id: "run:rewrite",
      articleId: "article:rewrite",
      sessionId: "session:article:rewrite",
      agentId: "writer" as const,
      operation: "rewrite_candidate",
      status: "pending" as const,
      baseRevisionId: null,
      createdAt: "2026-08-05T00:00:00.000Z",
      startedAt: null,
      completedAt: null,
      error: null,
    };
    const startRewrite = vi.fn(async () => run);
    const app = createRuntimeApp({
      config,
      readiness: () => ({ ready: true, checks: { storage: "ready" } }),
      rewriteService: { startRewrite } as unknown as RewriteService,
    });
    const response = await app.request("/v2/editor/rewrite", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        articleId: "article:rewrite",
        requestId: "rewrite:request-1",
        markdown: "# 标题\n\n要改写的段落。",
        instruction: "改得更简洁",
        selectedTexts: ["要改写的段落。"],
        conversation: [],
        modelProfile: {
          providerId: "test-provider",
          displayName: "Test Provider",
          protocol: "openai-responses",
          baseUrl: "https://models.example/v1",
          modelId: "test-model",
          secretRef: "env://TEST_KEY",
          supportsVision: false,
          reasoning: false,
          thinkingLevel: "off",
          contextWindow: 32_768,
          maxTokens: 8_192,
          timeoutSeconds: 120,
        },
      }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual(run);
    expect(startRewrite).toHaveBeenCalledOnce();
  });

  it("returns replayable run events as JSON for the native host", async () => {
    const run = {
      schemaVersion: "2" as const,
      id: "run:test",
      articleId: "article:test",
      sessionId: "session:test",
      agentId: "writer" as const,
      operation: "create_article",
      status: "running" as const,
      baseRevisionId: null,
      createdAt: "2026-08-04T00:00:00.000Z",
      startedAt: "2026-08-04T00:00:00.000Z",
      completedAt: null,
      error: null,
    };
    const event = {
      schemaVersion: "2" as const,
      id: "event:test",
      runId: run.id,
      sequence: 2,
      timestamp: "2026-08-04T00:00:01.000Z",
      articleId: run.articleId,
      agentId: "writer" as const,
      parentAgentId: null,
      operation: "create_article",
      type: "article.preview_delta" as const,
      payload: { delta: "正文", reset: false },
    };
    const writerService = {
      getRun: () => run,
      eventsAfter: (_runId: string, afterSequence: number) =>
        afterSequence < event.sequence ? [event] : [],
    } as unknown as WriterService;
    const app = createRuntimeApp({
      config,
      readiness: () => ({ ready: true, checks: { storage: "ready" } }),
      writerService,
    });

    const response = await app.request(`/v2/runs/${run.id}/events?afterSequence=1`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.token}`,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ events: [event] });
  });

  it("routes rewrite cancellation to the rewrite agent instead of the shared writer journal", async () => {
    const run = {
      schemaVersion: "2" as const,
      id: "run:rewrite-stop",
      articleId: "article:rewrite",
      sessionId: "rewrite:article:rewrite:request-1",
      agentId: "writer" as const,
      operation: "rewrite_candidate",
      status: "running" as const,
      baseRevisionId: null,
      createdAt: "2026-08-05T00:00:00.000Z",
      startedAt: "2026-08-05T00:00:01.000Z",
      completedAt: null,
      error: null,
    };
    const stoppedRun = { ...run, status: "stopping" as const };
    const writerStop = vi.fn();
    const rewriteStop = vi.fn(async () => stoppedRun);
    const app = createRuntimeApp({
      config,
      readiness: () => ({ ready: true, checks: { storage: "ready" } }),
      // Both services see the same persisted run. This mirrors production
      // and catches routing based only on getRun() truthiness.
      writerService: { getRun: () => run, stop: writerStop } as unknown as WriterService,
      rewriteService: { getRun: () => run, stop: rewriteStop } as unknown as RewriteService,
    });

    const response = await app.request(`/v2/runs/${run.id}/stop`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}` },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(stoppedRun);
    expect(rewriteStop).toHaveBeenCalledWith(run.id);
    expect(writerStop).not.toHaveBeenCalled();
  });

  it("discovers provider models through the authenticated Pi profile endpoint", async () => {
    const secrets = new SecretLeaseStore();
    secrets.put({
      id: "lease:model-discovery",
      secret: "test-key",
      providerId: "test-provider",
      expiresAtEpochMs: Date.now() + 60_000,
    });
    const providerFetch = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: "test-model", name: "Test Model" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", providerFetch);
    try {
      const app = createRuntimeApp({
        config,
        readiness: () => ({ ready: true, checks: { storage: "ready" } }),
        secretLeaseStore: secrets,
      });
      const response = await app.request("/v2/models/discover", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          modelProfile: {
            providerId: "test-provider",
            displayName: "Test Provider",
            protocol: "openai-responses",
            baseUrl: "https://models.example/v1",
            modelId: "test-model",
            secretRef: "lease://lease:model-discovery",
            supportsVision: false,
            reasoning: true,
            thinkingLevel: "high",
            contextWindow: 128_000,
            maxTokens: 16_384,
            timeoutSeconds: 120,
          },
        }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        models: [{ id: "test-model", name: "Test Model" }],
        endpoint: "https://models.example/v1/models",
      });
      expect(providerFetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
