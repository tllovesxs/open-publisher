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
});
