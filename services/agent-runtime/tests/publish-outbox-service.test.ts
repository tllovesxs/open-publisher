import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { describe, expect, it, vi } from "vitest";
import {
  DryRunDelivery,
  type PublishDelivery,
  PublishOutboxService,
  UnknownPublishOutcome,
  WechatSyncDraftDelivery,
} from "../src/publishing/publish-outbox-service.js";
import { openRuntimeDatabase } from "../src/storage/database.js";

const deliveryInput = {
  idempotencyKey: "sha256:test",
  platform: "csdn",
  accountRef: "desktop-csdn",
  title: "Test draft",
  markdown: "# Test draft",
  mode: "wechat_sync_draft" as const,
};

describe("WechatSyncDraftDelivery", () => {
  it("bounds an unresponsive bridge and records an uncertain outcome", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockRejectedValue(
      Object.assign(new Error("request timed out"), { name: "TimeoutError" }),
    );
    const delivery = new WechatSyncDraftDelivery(
      fetchImplementation,
      "http://127.0.0.1:9528/request",
      1,
    );

    await expect(delivery.deliver(deliveryInput)).rejects.toBeInstanceOf(UnknownPublishOutcome);
    expect(fetchImplementation).toHaveBeenCalledWith(
      "http://127.0.0.1:9528/request",
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
    const [, request] = fetchImplementation.mock.calls[0] ?? [];
    const body = JSON.parse(String((request as RequestInit).body)) as {
      params: { idempotencyKey: string; article: { idempotencyKey: string } };
    };
    expect(body.params.idempotencyKey).toBe(deliveryInput.idempotencyKey);
    expect(body.params.article.idempotencyKey).toBe(deliveryInput.idempotencyKey);
  });

  it("preserves a disconnect after draft dispatch as an uncertain outcome", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          error: "WechatSync 扩展已断开连接。",
          outcomeUncertain: true,
        },
        { status: 503 },
      ),
    );
    const delivery = new WechatSyncDraftDelivery(fetchImplementation);

    await expect(delivery.deliver(deliveryInput)).rejects.toBeInstanceOf(UnknownPublishOutcome);
  });

  it("uploads inline image data before syncing and sends only a platform URL", async () => {
    const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
    const fetchImplementation = vi.fn<typeof fetch>();
    fetchImplementation.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string; params: Record<string, unknown> };
      requests.push(body);
      if (body.method === "uploadImage:complete") {
        return Response.json({ result: { url: "https://i-blog.csdnimg.cn/direct/image.png", platform: "csdn" } });
      }
      if (body.method === "syncArticle") {
        return Response.json({
          result: {
            syncId: "sync-with-image",
            results: [{ platform: "csdn", success: true, postId: "draft-with-image" }],
          },
        });
      }
      return Response.json({ result: { success: true } });
    });
    const image = "data:image/png;base64,aW1hZ2U=";
    const delivery = new WechatSyncDraftDelivery(fetchImplementation);

    await expect(delivery.deliver({
      ...deliveryInput,
      markdown: `![第一处](${image})\n\n![重复引用](${image})`,
    })).resolves.toMatchObject({ remoteId: "draft-with-image" });

    expect(requests.map((request) => request.method)).toEqual([
      "uploadImage:start",
      "uploadImage:chunk",
      "uploadImage:complete",
      "syncArticle",
    ]);
    const sync = requests.at(-1)?.params as {
      article?: { markdown?: string };
    };
    expect(sync.article?.markdown).toContain("https://i-blog.csdnimg.cn/direct/image.png");
    expect(sync.article?.markdown).not.toContain("data:image/");
  });

  it("stops before draft creation when the plugin cannot return an uploaded image URL", async () => {
    const methods: string[] = [];
    const fetchImplementation = vi.fn<typeof fetch>();
    fetchImplementation.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      methods.push(body.method);
      return Response.json({
        result: body.method === "uploadImage:complete"
          ? { url: "data:image/png;base64,aW1hZ2U=", platform: "csdn" }
          : { success: true },
      });
    });
    const delivery = new WechatSyncDraftDelivery(fetchImplementation);

    await expect(delivery.deliver({
      ...deliveryInput,
      markdown: "![图片](data:image/png;base64,aW1hZ2U=)",
    })).rejects.toThrow(/已停止创建草稿/);
    expect(methods).not.toContain("syncArticle");
  });
});

describe("delivery reconciliation hooks", () => {
  it("returns a deterministic receipt when a delivery supports lookup", async () => {
    const result = await new DryRunDelivery().reconcile({
      idempotencyKey: deliveryInput.idempotencyKey,
      platform: deliveryInput.platform,
      mode: "dry_run",
    });
    expect(result).toMatchObject({
      remoteId: `dry-run:${deliveryInput.idempotencyKey}`,
      details: { mode: "dry_run_reconcile" },
    });
  });

  it("makes the absence of a WechatSync draft lookup explicit instead of retrying", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const delivery = new WechatSyncDraftDelivery(fetchImplementation);
    await expect(delivery.reconcile({
      idempotencyKey: deliveryInput.idempotencyKey,
      platform: deliveryInput.platform,
      mode: deliveryInput.mode,
    })).resolves.toBeNull();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

describe("PublishOutboxService", () => {
  it("resolves local asset references only inside the immutable publish variant", async () => {
    const database = openRuntimeDatabase(await mkdtemp(join(tmpdir(), "open-publisher-outbox-media-")));
    let deliveredMarkdown = "";
    const delivery: PublishDelivery = {
      async deliver(input) {
        deliveredMarkdown = input.markdown;
        return { remoteId: "test:media", details: {} };
      },
    };
    const service = new PublishOutboxService(database.sqlite, delivery);
    const canonical = "# Article\n\n![产品截图](asset://media-product)";
    try {
      const plan = service.createPlan({
        revisionId: "revision:media",
        title: "Article",
        markdown: canonical,
        mediaSources: [{ assetId: "media-product", source: "data:image/png;base64,aW1hZ2U=" }],
        targets: [{ platform: "csdn", accountRef: "desktop-csdn", deliveryMode: "dry_run" }],
      });
      service.approve(plan.planId, "user:desktop");
      const queued = service.enqueue(plan.planId);
      await service.process(queued.jobs[0]!.id);

      expect(deliveredMarkdown).toContain("data:image/png;base64,aW1hZ2U=");
      expect(deliveredMarkdown).not.toContain("asset://");
      expect(canonical).toContain("asset://media-product");
    } finally {
      database.close();
    }
  });

  it("rejects a plan before enqueueing when a referenced local image is missing", async () => {
    const database = openRuntimeDatabase(await mkdtemp(join(tmpdir(), "open-publisher-outbox-missing-media-")));
    const service = new PublishOutboxService(database.sqlite, new DryRunDelivery());
    try {
      expect(() => service.createPlan({
        revisionId: "revision:missing-media",
        title: "Article",
        markdown: "![缺失图片](asset://media-missing)",
        targets: [{ platform: "csdn", accountRef: "desktop-csdn", deliveryMode: "dry_run" }],
      })).toThrow(/media-missing/);
    } finally {
      database.close();
    }
  });

  it("atomically claims a job so a stale concurrent process cannot deliver it twice", async () => {
    const database = openRuntimeDatabase(await mkdtemp(join(tmpdir(), "open-publisher-outbox-race-")));
    let releaseDelivery: (() => void) | undefined;
    const deliveryGate = new Promise<void>((resolve) => {
      releaseDelivery = resolve;
    });
    let deliveryCalls = 0;
    const delivery: PublishDelivery = {
      async deliver(input) {
        deliveryCalls += 1;
        await deliveryGate;
        return {
          remoteId: `test:${input.idempotencyKey}`,
          details: { mode: input.mode },
        };
      },
    };

    try {
      const competingService = new PublishOutboxService(database.sqlite, delivery);
      let competingProcess: Promise<unknown> | undefined;
      let triggerCompetingProcess = true;
      const racingDatabase = new Proxy(database.sqlite, {
        get(target, property, receiver) {
          if (property === "query") {
            return (sql: string) => {
              const statement = target.query(sql);
              if (!triggerCompetingProcess || sql !== "SELECT * FROM publish_jobs_v2 WHERE id = ?") {
                return statement;
              }
              return new Proxy(statement, {
                get(statementTarget, statementProperty, statementReceiver) {
                  const value = Reflect.get(statementTarget, statementProperty, statementReceiver);
                  if (statementProperty !== "get" || typeof value !== "function") {
                    return typeof value === "function" ? value.bind(statementTarget) : value;
                  }
                  return (...args: unknown[]) => {
                    const row = value.apply(statementTarget, args);
                    if (triggerCompetingProcess) {
                      triggerCompetingProcess = false;
                      competingProcess = competingService.process(String(args[0]));
                    }
                    return row;
                  };
                },
              });
            };
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as unknown as Database;
      const service = new PublishOutboxService(racingDatabase, delivery);
      const plan = service.createPlan({
        revisionId: "revision:race",
        title: "Race condition",
        markdown: "# Race condition",
        targets: [{ platform: "csdn", accountRef: "desktop-csdn", deliveryMode: "dry_run" }],
      });
      service.approve(plan.planId, "user:desktop");
      const queued = service.enqueue(plan.planId);
      const jobId = queued.jobs[0]?.id;
      expect(jobId).toBeDefined();

      const staleProcess = service.process(jobId!);
      expect(competingProcess).toBeDefined();
      queueMicrotask(() => releaseDelivery?.());
      const [staleResult, competingResult] = await Promise.allSettled([
        staleProcess,
        competingProcess!,
      ]);

      expect(staleResult).toMatchObject({ status: "rejected", reason: expect.any(Error) });
      if (staleResult.status === "rejected") {
        expect(staleResult.reason).toBeInstanceOf(Error);
        expect((staleResult.reason as Error).message).toBe("publish job was claimed by another process");
      }
      expect(competingResult).toMatchObject({
        status: "fulfilled",
        value: { jobs: [expect.objectContaining({ state: "succeeded" })] },
      });
      expect(deliveryCalls).toBe(1);
      expect(service.getPlan(plan.planId).jobs[0]).toMatchObject({ state: "succeeded" });
    } finally {
      releaseDelivery?.();
      database.close();
    }
  });

  it("stores embedded media once instead of copying it into every platform variant", async () => {
    const database = openRuntimeDatabase(await mkdtemp(join(tmpdir(), "open-publisher-outbox-compact-media-")));
    const delivery: PublishDelivery = {
      async deliver() {
        return { remoteId: "test:compact", details: {} };
      },
    };
    const service = new PublishOutboxService(database.sqlite, delivery);
    const image = `data:image/png;base64,${"a".repeat(128 * 1024)}`;
    try {
      service.createPlan({
        revisionId: "revision:compact",
        title: "Article",
        markdown: "# Article\n\n![产品截图](asset://media-product)",
        mediaSources: [{ assetId: "media-product", source: image }],
        targets: Array.from({ length: 10 }, (_, index) => ({
          platform: `platform-${index}`,
          accountRef: `desktop-platform-${index}`,
          deliveryMode: "wechat_sync_draft" as const,
        })),
      });

      const variants = database.sqlite.query(
        "SELECT markdown FROM publish_variants_v2",
      ).all() as Array<{ markdown: string }>;
      const plan = database.sqlite.query(
        "SELECT plan_json FROM publish_plans_v2 LIMIT 1",
      ).get() as { plan_json: string };
      expect(variants).toHaveLength(10);
      expect(variants.every((variant) => variant.markdown.includes("asset://media-product"))).toBe(true);
      expect(variants.some((variant) => variant.markdown.includes("data:image/"))).toBe(false);
      expect(plan.plan_json.match(/data:image\/png;base64/g)).toHaveLength(1);
    } finally {
      database.close();
    }
  });
});
