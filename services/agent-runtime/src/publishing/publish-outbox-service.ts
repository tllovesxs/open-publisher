import { createHash, randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import {
  resolvePublishMediaReferences,
  type PublishMediaSourceInput,
} from "./publish-media.js";

export type PublishDeliveryMode = "dry_run" | "wechat_sync_draft";
export type UnknownPublishResolution = "draft_exists" | "draft_missing";
export type PublishJobState = "pending" | "in_progress" | "succeeded" | "failed_retryable" | "failed_terminal" | "unknown" | "reconciling" | "cancelled";

export interface PublishTargetInput {
  readonly platform: string;
  readonly accountRef: string;
  readonly title?: string;
  readonly deliveryMode: PublishDeliveryMode;
}

export interface PublishPlanSummary {
  planId: string; revisionId: string;
  status: "draft" | "approved" | "queued" | "running" | "completed" | "needs_attention";
  approvalStatus: "not_required" | "pending" | "approved" | "rejected";
  createdAt: string; updatedAt: string;
  variants: Array<{ id: string; platform: string; accountRef: string; title: string; contentHash: string }>;
  jobs: Array<{ id: string; planId: string; variantId: string; platform: string; accountRef: string; operation: "dry_run" | "wechat_sync_draft" | "reconcile"; idempotencyKey: string; payloadHash: string; state: PublishJobState; remoteId: string | null; lastError: string | null; reconcileRequired: boolean; createdAt: string; updatedAt: string }>;
  persistence: "local_database";
}

export class UnknownPublishOutcome extends Error {}
export class PublishDeliveryFailure extends Error { constructor(message: string, readonly retryable: boolean) { super(message); } }
export interface DraftDeliveryResult { remoteId: string; remoteUrl?: string; details: Record<string, unknown>; }
export interface PublishDelivery { deliver(input: { idempotencyKey: string; platform: string; accountRef: string; title: string; markdown: string; mode: PublishDeliveryMode }): Promise<DraftDeliveryResult>; reconcile?(input: { idempotencyKey: string; platform: string; mode: PublishDeliveryMode }): Promise<DraftDeliveryResult | null>; }

const WECHATSYNC_REQUEST_TIMEOUT_MS = 180_000;
const IMAGE_UPLOAD_CHUNK_CHARACTERS = 256 * 1024;
const INLINE_DATA_IMAGE_PATTERN =
  /data:(image\/(?:png|jpe?g|gif|webp|avif));base64,([a-z0-9+/]+={0,2})/gi;
const isPublishDeliveryMode = (value: string): value is PublishDeliveryMode =>
  value === "dry_run" || value === "wechat_sync_draft";

const isTimeoutError = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const name = "name" in error ? (error as { name?: unknown }).name : undefined;
  return name === "TimeoutError" || name === "AbortError";
};

/**
 * Explicitly side-effect-free delivery for previewing a publish plan. Keeping
 * this as a real outbox destination lets the UI exercise approval, retries,
 * and receipts without pretending that a platform write occurred.
 */
export class DryRunDelivery implements PublishDelivery {
  async deliver(input: {
    idempotencyKey: string;
    platform: string;
    accountRef: string;
    title: string;
    markdown: string;
    mode: PublishDeliveryMode;
  }): Promise<DraftDeliveryResult> {
    if (input.mode !== "dry_run") {
      throw new PublishDeliveryFailure("Dry-run delivery received an unsupported mode", false);
    }
    return {
      remoteId: `dry-run:${input.idempotencyKey}`,
      details: {
        mode: "dry_run",
        platform: input.platform,
        accountRef: input.accountRef,
        title: input.title,
        markdownLength: input.markdown.length,
        draftOnly: true,
        notice: "This is a local dry-run receipt. No platform content was created.",
      },
    };
  }

  async reconcile(input: { idempotencyKey: string; platform: string; mode: PublishDeliveryMode }): Promise<DraftDeliveryResult> {
    if (input.mode !== "dry_run") {
      throw new PublishDeliveryFailure("Dry-run reconciliation received an unsupported mode", false);
    }
    return {
      remoteId: `dry-run:${input.idempotencyKey}`,
      details: {
        mode: "dry_run_reconcile",
        platform: input.platform,
        draftOnly: true,
        notice: "The deterministic local dry-run receipt was reconciled.",
      },
    };
  }
}

const hash = (value: unknown): string => `sha256:${createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value) ?? "", "utf8").digest("hex")}`;
const now = (): string => new Date().toISOString();
const requiredText = (row: Record<string, unknown>, field: string): string => {
  const value = row[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Corrupt publish outbox row: ${field} is missing`);
  }
  return value;
};
type PlanRow = { id: string; revision_id: string; revision_hash: string; status: string; approval_status: string; plan_json: string; approval_binding_hash: string | null; created_at: string; updated_at: string };
type VariantRow = { id: string; plan_id: string; platform: string; account_ref: string; title: string; markdown: string; content_hash: string; target_hash: string };
type JobRow = { id: string; plan_id: string; variant_id: string; platform: string; account_ref: string; operation: string; idempotency_key: string; payload_hash: string; state: string; remote_id: string | null; last_error: string | null; reconcile_required: number; created_at: string; updated_at: string };

/** Local-only bridge. It submits platform drafts and never receives browser credentials. */
export class WechatSyncDraftDelivery implements PublishDelivery {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly bridgeUrl = "http://127.0.0.1:9528/request",
    private readonly timeoutMs = WECHATSYNC_REQUEST_TIMEOUT_MS,
  ) {}

  async deliver(input: { idempotencyKey: string; platform: string; accountRef: string; title: string; markdown: string; mode: PublishDeliveryMode }): Promise<DraftDeliveryResult> {
    if (input.mode !== "wechat_sync_draft") throw new PublishDeliveryFailure("Unsupported delivery mode", false);
    const markdown = await this.uploadInlineImages(input.markdown, input.platform);
    const payload = await this.bridgeRequest("syncArticle", {
      platforms: [input.platform],
      idempotencyKey: input.idempotencyKey,
      article: {
        title: input.title,
        markdown,
        idempotencyKey: input.idempotencyKey,
      },
    }, true) as { syncId?: string; results?: Array<{ platform?: string; success?: boolean; postId?: string; postUrl?: string; error?: string }> } | null;
    const result = payload?.results?.find((item) => item.platform === input.platform);
    if (!result?.success) throw new PublishDeliveryFailure(result?.error ?? "WechatSync did not save a draft", true);
    return {
      remoteId: result.postId ?? `wechat-sync:${payload?.syncId ?? input.idempotencyKey}:${input.platform}`,
      ...(result.postUrl ? { remoteUrl: result.postUrl } : {}),
      details: { mode: "wechat_sync_draft", draftOnly: true, notice: "A platform draft was requested; the user must confirm final publishing." },
    };
  }

  private async uploadInlineImages(markdown: string, platform: string): Promise<string> {
    const images = [...markdown.matchAll(INLINE_DATA_IMAGE_PATTERN)];
    if (images.length === 0) return markdown;
    const uploaded = new Map<string, string>();
    for (const match of images) {
      const dataUrl = match[0];
      if (uploaded.has(dataUrl)) continue;
      const mimeType = match[1]!;
      const base64 = match[2]!;
      const uploadId = `open-publisher-${randomUUID()}`;
      const totalChunks = Math.ceil(base64.length / IMAGE_UPLOAD_CHUNK_CHARACTERS);
      await this.bridgeRequest("uploadImage:start", {
        uploadId,
        totalChunks,
        mimeType,
        platform,
      });
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
        await this.bridgeRequest("uploadImage:chunk", {
          uploadId,
          chunkIndex,
          data: base64.slice(
            chunkIndex * IMAGE_UPLOAD_CHUNK_CHARACTERS,
            (chunkIndex + 1) * IMAGE_UPLOAD_CHUNK_CHARACTERS,
          ),
        });
      }
      const completed = await this.bridgeRequest("uploadImage:complete", { uploadId }) as { url?: unknown } | null;
      const url = typeof completed?.url === "string" ? completed.url : "";
      if (!/^https:\/\//i.test(url)) {
        throw new PublishDeliveryFailure(
          `${platform} 图片上传未返回可访问地址，已停止创建草稿，避免出现“图片转存失败”。`,
          true,
        );
      }
      uploaded.set(dataUrl, url);
    }
    let resolved = markdown;
    for (const [dataUrl, url] of uploaded) resolved = resolved.split(dataUrl).join(url);
    return resolved;
  }

  private async bridgeRequest(
    method: string,
    params: Record<string, unknown>,
    uncertainDraftOutcome = false,
  ): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.bridgeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, params }),
        redirect: "error",
        signal: timeout,
      });
    } catch (error: unknown) {
      if (timeout.aborted || isTimeoutError(error)) {
        if (uncertainDraftOutcome) {
          throw new UnknownPublishOutcome("WechatSync 请求超时，草稿是否已创建无法确认。");
        }
        throw new PublishDeliveryFailure("WechatSync 图片上传超时，尚未创建平台草稿。", true);
      }
      throw new PublishDeliveryFailure("WechatSync 本地桥未连接；请确认浏览器扩展的 CLI/MCP 连接已启用。", true);
    }
    const payload = await response.json().catch(() => null) as { result?: unknown; error?: unknown } | null;
    if (!response.ok) {
      const detail = typeof payload?.error === "string"
        ? payload.error
        : `WechatSync 本地桥请求失败：${method}`;
      throw new PublishDeliveryFailure(detail, true);
    }
    return payload?.result;
  }

  async reconcile(_input: { idempotencyKey: string; platform: string; mode: PublishDeliveryMode }): Promise<DraftDeliveryResult | null> {
    // WechatSync's local bridge currently has no draft lookup keyed by an
    // idempotency value. Returning null deliberately preserves UNKNOWN: a
    // second sync could create a duplicate platform draft.
    return null;
  }
}

/** Routes a persisted outbox job to its declared, immutable delivery mode. */
export class PublishDeliveryRouter implements PublishDelivery {
  constructor(
    private readonly dryRun = new DryRunDelivery(),
    private readonly wechatSync = new WechatSyncDraftDelivery(),
  ) {}

  deliver(input: {
    idempotencyKey: string;
    platform: string;
    accountRef: string;
    title: string;
    markdown: string;
    mode: PublishDeliveryMode;
  }): Promise<DraftDeliveryResult> {
    return input.mode === "dry_run"
      ? this.dryRun.deliver(input)
      : this.wechatSync.deliver(input);
  }

  reconcile(input: { idempotencyKey: string; platform: string; mode: PublishDeliveryMode }): Promise<DraftDeliveryResult | null> {
    const delivery = input.mode === "dry_run" ? this.dryRun : this.wechatSync;
    return delivery.reconcile?.(input) ?? Promise.resolve(null);
  }
}

export class PublishOutboxService {
  constructor(private readonly database: Database, private readonly delivery: PublishDelivery) {}

  createPlan(input: { revisionId: string; title: string; markdown: string; mediaSources?: readonly PublishMediaSourceInput[]; targets: readonly PublishTargetInput[] }): PublishPlanSummary {
    if (input.targets.length === 0) throw new Error("publish plan requires at least one target");
    const createdAt = now(); const planId = `plan:${randomUUID()}`; const revisionHash = hash(input.markdown);
    const publishMarkdown = resolvePublishMediaReferences(input.markdown, input.mediaSources ?? []);
    const variants = input.targets.map((target) => {
      const platform = target.platform.trim().toLowerCase(), accountRef = target.accountRef.trim(), title = (target.title ?? input.title).trim();
      if (!platform || !accountRef || !title) throw new Error("publish target platform, accountRef, and title are required");
      const markdown = `<!-- open-publisher variant:${platform} -->\n\n${publishMarkdown.trim()}\n`;
      const contentHash = hash(markdown); const id = `variant:${randomUUID()}`;
      return { id, platform, accountRef, title, markdown, contentHash, targetHash: hash({ platform, accountRef, title, contentHash, deliveryMode: target.deliveryMode }), deliveryMode: target.deliveryMode };
    });
    if (new Set(variants.map((variant) => variant.deliveryMode)).size !== 1) {
      throw new Error("all targets in one publish plan must use the same delivery mode");
    }
    const binding = hash({ revisionId: input.revisionId, revisionHash, targetHashes: variants.map((variant) => variant.targetHash).sort() });
    this.database.transaction(() => {
      this.database.query("INSERT INTO publish_plans_v2 VALUES (?, ?, ?, 'draft', 'pending', ?, NULL, ?, ?)").run(planId, input.revisionId, revisionHash, JSON.stringify({ binding, modes: Object.fromEntries(variants.map((variant) => [variant.id, variant.deliveryMode])) }), createdAt, createdAt);
      for (const variant of variants) this.database.query("INSERT INTO publish_variants_v2 VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(variant.id, planId, variant.platform, variant.accountRef, variant.title, variant.markdown, variant.contentHash, variant.targetHash);
    })();
    return this.getPlan(planId);
  }

  approve(planId: string, actorId: string): PublishPlanSummary {
    if (!actorId.trim()) throw new Error("publish approval actor cannot be blank");
    const plan = this.plan(planId); if (plan.status !== "draft" && plan.status !== "approved") throw new Error("publish plan cannot be approved in its current state");
    const binding = this.binding(planId, plan.revision_id, plan.revision_hash);
    this.database.query("UPDATE publish_plans_v2 SET status = 'approved', approval_status = 'approved', approval_binding_hash = ?, updated_at = ? WHERE id = ?").run(binding, now(), planId);
    return this.getPlan(planId);
  }

  enqueue(planId: string): PublishPlanSummary {
    const plan = this.plan(planId); const binding = this.binding(planId, plan.revision_id, plan.revision_hash);
    if (plan.approval_status !== "approved" || plan.approval_binding_hash !== binding) throw new Error("publish plan must be explicitly approved without content changes");
    const createdAt = now();
    this.database.transaction(() => {
      const variants = this.database.query("SELECT * FROM publish_variants_v2 WHERE plan_id = ?").all(planId).map((row) => this.variant(row as Record<string, unknown>));
      for (const variant of variants) {
        const mode = (JSON.parse(plan.plan_json) as { modes: Record<string, PublishDeliveryMode> }).modes[variant.id] ?? "dry_run";
        const payload = { mode, variantId: variant.id, contentHash: variant.content_hash };
        const payloadHash = hash(payload); const idempotencyKey = hash(`publisher-v1:${planId}:${variant.id}:${variant.platform}:${variant.account_ref}:${payloadHash}`);
        this.database.query("INSERT OR IGNORE INTO publish_jobs_v2 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, 0, ?, ?)").run(`job:${randomUUID()}`, planId, variant.id, variant.platform, variant.account_ref, mode, idempotencyKey, payloadHash, JSON.stringify(payload), createdAt, createdAt);
      }
      this.database.query("UPDATE publish_plans_v2 SET status = 'queued', updated_at = ? WHERE id = ?").run(createdAt, planId);
    })();
    return this.getPlan(planId);
  }

  async process(jobId: string): Promise<PublishPlanSummary> {
    const rawJob = this.database.query("SELECT * FROM publish_jobs_v2 WHERE id = ?").get(jobId) as Record<string, unknown> | null;
    const job = rawJob ? this.job(rawJob) : null;
    if (!job) throw new Error("publish job not found"); if (job.state === "unknown") throw new Error("UNKNOWN jobs must be reconciled before retry");
    if (!["pending", "failed_retryable"].includes(String(job.state))) throw new Error("publish job cannot be processed from its current state");
    const plan = this.plan(String(job.plan_id));
    if (plan.approval_status !== "approved" || plan.approval_binding_hash !== this.binding(String(job.plan_id), plan.revision_id, plan.revision_hash)) {
      throw new Error("publish plan approval is missing or no longer bound to this content");
    }
    const rawVariant = this.database.query("SELECT * FROM publish_variants_v2 WHERE id = ?").get(job.variant_id) as Record<string, unknown> | null;
    if (!rawVariant) throw new Error("publish variant not found");
    const variant = this.variant(rawVariant);
    const startedAt = now();
    const attemptNumber = this.database.transaction(() => {
      // The conditional write is the outbox claim. A second runtime may have
      // read the same pending job before this transaction, but it must not be
      // allowed to send another external delivery.
      const claim = this.database.query(
        "UPDATE publish_jobs_v2 SET state = 'in_progress', updated_at = ? WHERE id = ? AND state = ?",
      ).run(startedAt, jobId, job.state);
      if (claim.changes !== 1) return null;
      const nextAttempt = Number((this.database.query("SELECT COUNT(*) count FROM publish_attempts_v2 WHERE job_id = ?").get(jobId) as { count: number }).count) + 1;
      this.database.query("INSERT INTO publish_attempts_v2 VALUES (?, ?, ?, ?, 'in_progress', ?, NULL, NULL, ?, NULL)").run(
        `attempt:${randomUUID()}`,
        jobId,
        nextAttempt,
        job.operation,
        JSON.stringify({ idempotencyKey: job.idempotency_key }),
        startedAt,
      );
      return nextAttempt;
    })();
    if (attemptNumber === null) throw new Error("publish job was claimed by another process");
    try {
      const result = await this.delivery.deliver({ idempotencyKey: String(job.idempotency_key), platform: variant.platform, accountRef: variant.account_ref, title: variant.title, markdown: variant.markdown, mode: job.operation as PublishDeliveryMode });
      const completedAt = now(); this.database.transaction(() => { this.database.query("UPDATE publish_attempts_v2 SET state = 'succeeded', response_json = ?, completed_at = ? WHERE job_id = ? AND attempt_number = ?").run(JSON.stringify(result), completedAt, jobId, attemptNumber); this.database.query("UPDATE publish_jobs_v2 SET state = 'succeeded', remote_id = ?, last_error = NULL, reconcile_required = 0, updated_at = ? WHERE id = ?").run(result.remoteId, completedAt, jobId); this.database.query("INSERT OR REPLACE INTO publish_receipts_v2 VALUES (?, ?, ?, 'draft_saved', ?, ?, ?, ?, ?)").run(`receipt:${randomUUID()}`, jobId, variant.platform, result.remoteId, result.remoteUrl ?? null, job.payload_hash, JSON.stringify(result.details), completedAt); })();
    } catch (error: unknown) {
      const unknown = error instanceof UnknownPublishOutcome; const retryable = error instanceof PublishDeliveryFailure && error.retryable; const message = error instanceof Error ? error.message : "unexpected publisher error"; const state = unknown ? "unknown" : retryable ? "failed_retryable" : "failed_terminal"; const completedAt = now(); this.database.transaction(() => { this.database.query("UPDATE publish_attempts_v2 SET state = ?, error = ?, completed_at = ? WHERE job_id = ? AND attempt_number = ?").run(unknown ? "unknown" : "failed", message, completedAt, jobId, attemptNumber); this.database.query("UPDATE publish_jobs_v2 SET state = ?, last_error = ?, reconcile_required = ?, updated_at = ? WHERE id = ?").run(state, message, unknown ? 1 : 0, completedAt, jobId); })();
    }
    this.refreshPlan(String(job.plan_id)); return this.getPlan(String(job.plan_id));
  }

  /**
   * Resolve a delivery whose remote outcome was ambiguous. This path never
   * calls deliver(): an unavailable lookup remains UNKNOWN so a user can
   * inspect the platform draft before explicitly creating any new plan.
   */
  async reconcile(jobId: string): Promise<PublishPlanSummary> {
    const rawJob = this.database.query("SELECT * FROM publish_jobs_v2 WHERE id = ?").get(jobId) as Record<string, unknown> | null;
    const job = rawJob ? this.job(rawJob) : null;
    if (!job) throw new Error("publish job not found");
    if (job.state !== "unknown" || job.reconcile_required !== 1) {
      throw new Error("only UNKNOWN publish jobs that require reconciliation can be reconciled");
    }
    if (!isPublishDeliveryMode(job.operation)) {
      throw new Error("corrupt publish outbox job: delivery mode is invalid");
    }

    const rawVariant = this.database.query("SELECT * FROM publish_variants_v2 WHERE id = ?").get(job.variant_id) as Record<string, unknown> | null;
    if (!rawVariant) throw new Error("publish variant not found");
    const variant = this.variant(rawVariant);
    const attemptNumber = Number((this.database.query("SELECT COUNT(*) count FROM publish_attempts_v2 WHERE job_id = ?").get(jobId) as { count: number }).count) + 1;
    const startedAt = now();
    const claimed = this.database.transaction(() => {
      const update = this.database.query("UPDATE publish_jobs_v2 SET state = 'reconciling', updated_at = ? WHERE id = ? AND state = 'unknown' AND reconcile_required = 1").run(startedAt, jobId);
      if (update.changes !== 1) return false;
      this.database.query("INSERT INTO publish_attempts_v2 VALUES (?, ?, ?, 'reconcile', 'in_progress', ?, NULL, NULL, ?, NULL)").run(
        `attempt:${randomUUID()}`,
        jobId,
        attemptNumber,
        JSON.stringify({ idempotencyKey: job.idempotency_key, platform: job.platform, mode: job.operation }),
        startedAt,
      );
      return true;
    })();
    if (!claimed) throw new Error("publish job is already being reconciled");

    let result: DraftDeliveryResult | null = null;
    let lookupError: string | null = null;
    try {
      result = await this.delivery.reconcile?.({
        idempotencyKey: job.idempotency_key,
        platform: variant.platform,
        mode: job.operation,
      }) ?? null;
    } catch (error: unknown) {
      lookupError = error instanceof Error ? error.message : "unexpected reconciliation error";
    }

    const completedAt = now();
    if (result) {
      this.database.transaction(() => {
        this.database.query("UPDATE publish_attempts_v2 SET state = 'succeeded', response_json = ?, completed_at = ? WHERE job_id = ? AND attempt_number = ?").run(JSON.stringify(result), completedAt, jobId, attemptNumber);
        this.database.query("UPDATE publish_jobs_v2 SET state = 'succeeded', remote_id = ?, last_error = NULL, reconcile_required = 0, updated_at = ? WHERE id = ?").run(result.remoteId, completedAt, jobId);
        this.database.query("INSERT OR REPLACE INTO publish_receipts_v2 VALUES (?, ?, ?, 'draft_saved', ?, ?, ?, ?, ?)").run(`receipt:${randomUUID()}`, jobId, variant.platform, result.remoteId, result.remoteUrl ?? null, job.payload_hash, JSON.stringify({ ...result.details, reconciled: true }), completedAt);
      })();
    } else {
      const message = lookupError
        ? `无法完成远端结果核验：${lookupError}。请在 ${variant.platform} 草稿箱确认是否已创建草稿；系统不会自动重试。`
        : `当前发布通道不支持按幂等键查询草稿。请在 ${variant.platform} 草稿箱确认是否已创建草稿；系统不会自动重试。`;
      this.database.transaction(() => {
        this.database.query("UPDATE publish_attempts_v2 SET state = 'unknown', error = ?, completed_at = ? WHERE job_id = ? AND attempt_number = ?").run(message, completedAt, jobId, attemptNumber);
        this.database.query("UPDATE publish_jobs_v2 SET state = 'unknown', last_error = ?, reconcile_required = 1, updated_at = ? WHERE id = ?").run(message, completedAt, jobId);
      })();
    }
    this.refreshPlan(job.plan_id);
    return this.getPlan(job.plan_id);
  }

  /**
   * The only route out of an UNKNOWN result when the delivery channel cannot
   * look it up. Both choices are a deliberate, user-visible acknowledgement:
   * this method never sends the draft payload.
   */
  resolveUnknown(jobId: string, resolution: UnknownPublishResolution): PublishPlanSummary {
    const rawJob = this.database.query("SELECT * FROM publish_jobs_v2 WHERE id = ?").get(jobId) as Record<string, unknown> | null;
    const job = rawJob ? this.job(rawJob) : null;
    if (!job) throw new Error("publish job not found");
    if (job.state !== "unknown" || job.reconcile_required !== 1) {
      throw new Error("only UNKNOWN publish jobs that require manual confirmation can be resolved");
    }
    const rawVariant = this.database.query("SELECT * FROM publish_variants_v2 WHERE id = ?").get(job.variant_id) as Record<string, unknown> | null;
    if (!rawVariant) throw new Error("publish variant not found");
    const variant = this.variant(rawVariant);
    const attemptNumber = Number((this.database.query("SELECT COUNT(*) count FROM publish_attempts_v2 WHERE job_id = ?").get(jobId) as { count: number }).count) + 1;
    const completedAt = now();

    const resolved = this.database.transaction(() => {
      const claim = this.database.query("UPDATE publish_jobs_v2 SET state = 'reconciling', updated_at = ? WHERE id = ? AND state = 'unknown' AND reconcile_required = 1").run(completedAt, jobId);
      if (claim.changes !== 1) return false;
      this.database.query("INSERT INTO publish_attempts_v2 VALUES (?, ?, ?, 'reconcile', ?, ?, ?, ?, ?, ?)").run(
        `attempt:${randomUUID()}`,
        jobId,
        attemptNumber,
        resolution === "draft_exists" ? "succeeded" : "cancelled",
        JSON.stringify({ idempotencyKey: job.idempotency_key, resolution, actor: "user:desktop" }),
        resolution === "draft_exists"
          ? JSON.stringify({ manualConfirmation: "draft_exists" })
          : null,
        resolution === "draft_missing"
          ? "User confirmed the platform draft was not created; delivery may be retried explicitly."
          : null,
        completedAt,
        completedAt,
      );
      if (resolution === "draft_exists") {
        const remoteId = `manual-confirmed:${job.id}`;
        this.database.query("UPDATE publish_jobs_v2 SET state = 'succeeded', remote_id = ?, last_error = NULL, reconcile_required = 0, updated_at = ? WHERE id = ?").run(remoteId, completedAt, jobId);
        this.database.query("INSERT OR REPLACE INTO publish_receipts_v2 VALUES (?, ?, ?, 'draft_saved', ?, NULL, ?, ?, ?)").run(
          `receipt:${randomUUID()}`,
          jobId,
          variant.platform,
          remoteId,
          job.payload_hash,
          JSON.stringify({
            mode: "manual_confirmation",
            draftOnly: true,
            notice: "The user confirmed this platform draft exists after an ambiguous delivery outcome.",
          }),
          completedAt,
        );
      } else {
        this.database.query("UPDATE publish_jobs_v2 SET state = 'pending', remote_id = NULL, last_error = ?, reconcile_required = 0, updated_at = ? WHERE id = ?").run(
          "用户已确认平台草稿未创建；可由用户手动再次执行发布。",
          completedAt,
          jobId,
        );
      }
      return true;
    })();
    if (!resolved) throw new Error("publish job is already being reconciled or resolved");
    this.refreshPlan(job.plan_id);
    return this.getPlan(job.plan_id);
  }

  getPlan(planId: string): PublishPlanSummary { const plan = this.plan(planId); const variants = this.database.query("SELECT * FROM publish_variants_v2 WHERE plan_id = ?").all(planId).map((row) => this.variant(row as Record<string, unknown>)); const jobs = this.database.query("SELECT * FROM publish_jobs_v2 WHERE plan_id = ? ORDER BY created_at").all(planId).map((row) => this.job(row as Record<string, unknown>)); return { planId, revisionId: plan.revision_id, status: plan.status as PublishPlanSummary["status"], approvalStatus: plan.approval_status as PublishPlanSummary["approvalStatus"], createdAt: plan.created_at, updatedAt: plan.updated_at, variants: variants.map((v) => ({ id: v.id, platform: v.platform, accountRef: v.account_ref, title: v.title, contentHash: v.content_hash })), jobs: jobs.map((j) => ({ id: j.id, planId: j.plan_id, variantId: j.variant_id, platform: j.platform, accountRef: j.account_ref, operation: j.operation as "dry_run" | "wechat_sync_draft" | "reconcile", idempotencyKey: j.idempotency_key, payloadHash: j.payload_hash, state: j.state as PublishJobState, remoteId: j.remote_id, lastError: j.last_error, reconcileRequired: j.reconcile_required === 1, createdAt: j.created_at, updatedAt: j.updated_at })), persistence: "local_database" }; }
  private plan(id: string): PlanRow { const row = this.database.query("SELECT * FROM publish_plans_v2 WHERE id = ?").get(id) as Record<string, unknown> | null; if (!row) throw new Error("publish plan not found"); return { id: requiredText(row, "id"), revision_id: requiredText(row, "revision_id"), revision_hash: requiredText(row, "revision_hash"), status: requiredText(row, "status"), approval_status: requiredText(row, "approval_status"), plan_json: requiredText(row, "plan_json"), approval_binding_hash: typeof row.approval_binding_hash === "string" ? row.approval_binding_hash : null, created_at: requiredText(row, "created_at"), updated_at: requiredText(row, "updated_at") }; }
  private variant(row: Record<string, unknown>): VariantRow { return { id: requiredText(row, "id"), plan_id: requiredText(row, "plan_id"), platform: requiredText(row, "platform"), account_ref: requiredText(row, "account_ref"), title: requiredText(row, "title"), markdown: requiredText(row, "markdown"), content_hash: requiredText(row, "content_hash"), target_hash: requiredText(row, "target_hash") }; }
  private job(row: Record<string, unknown>): JobRow { const reconcile = row.reconcile_required; if (reconcile !== 0 && reconcile !== 1) throw new Error("Corrupt publish outbox row: reconcile_required is invalid"); return { id: requiredText(row, "id"), plan_id: requiredText(row, "plan_id"), variant_id: requiredText(row, "variant_id"), platform: requiredText(row, "platform"), account_ref: requiredText(row, "account_ref"), operation: requiredText(row, "operation"), idempotency_key: requiredText(row, "idempotency_key"), payload_hash: requiredText(row, "payload_hash"), state: requiredText(row, "state"), remote_id: typeof row.remote_id === "string" ? row.remote_id : null, last_error: typeof row.last_error === "string" ? row.last_error : null, reconcile_required: reconcile, created_at: requiredText(row, "created_at"), updated_at: requiredText(row, "updated_at") }; }
  private binding(planId: string, revisionId: string, revisionHash: string): string { const targets = (this.database.query("SELECT target_hash FROM publish_variants_v2 WHERE plan_id = ? ORDER BY id").all(planId) as Array<{ target_hash: string }>).map((value) => value.target_hash).sort(); return hash({ revisionId, revisionHash, targetHashes: targets }); }
  private refreshPlan(planId: string): void { const states = (this.database.query("SELECT state FROM publish_jobs_v2 WHERE plan_id = ?").all(planId) as Array<{ state: string }>).map((row) => row.state); const status = states.some((state) => ["unknown", "failed_terminal"].includes(state)) ? "needs_attention" : states.length > 0 && states.every((state) => state === "succeeded") ? "completed" : states.some((state) => state === "in_progress") ? "running" : "queued"; this.database.query("UPDATE publish_plans_v2 SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), planId); }
}
