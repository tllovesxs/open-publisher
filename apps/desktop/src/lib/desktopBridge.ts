import { invoke } from "@tauri-apps/api/core";

export type RuntimeState = "standby" | "starting" | "ready" | "stopped" | "faulted";

export interface RuntimeSnapshot {
  state: RuntimeState;
  bridgeMode: "interface_only" | "python_sidecar";
  generation: number;
  detail: string;
}

export interface SaveDraftRequest {
  articleId: string;
  baseRevision: string | null;
  markdown: string;
}

export interface SaveDraftReceipt {
  revisionId: string;
  savedAtEpochMs: number;
  persistence: "memory" | "local_database";
}

export interface RunWorkflowRequest {
  articleId: string;
  revisionId: string;
  topic: string;
  disabledOptionalNodeIds: DisabledOptionalNodeId[];
}

export type DisabledOptionalNodeId =
  | "research"
  | "outline"
  | "natural-style"
  | "review"
  | "visual";

export interface WorkflowArtifactSummary {
  id: string;
  kind: string;
}

export interface RunWorkflowSummary {
  runId: string;
  status: string;
  workflowName: string;
  workflowVersion: string;
  inputRevisionId: string;
  outputRevisionId: string;
  outputRevisionNumber: number;
  outputMarkdown: string;
  outputContentHash: string;
  artifacts: WorkflowArtifactSummary[];
  persistence: "memory" | "local_database";
}

export type PublishPlatform = "wechat" | "csdn" | "toutiao";

export interface CreatePublishPlanRequest {
  articleId: string;
  revisionId: string;
  platforms: PublishPlatform[];
}

export interface PublishPlanRequest {
  planId: string;
}

export interface ProcessPublishJobRequest {
  jobId: string;
}

export interface PublishVariantSummary {
  id: string;
  platform: PublishPlatform;
  accountRef: string;
  title: string;
  contentHash: string;
}

export type PublishJobState =
  | "pending"
  | "in_progress"
  | "succeeded"
  | "failed_retryable"
  | "failed_terminal"
  | "unknown"
  | "reconciling"
  | "cancelled";

export interface PublishJobSummary {
  id: string;
  planId: string;
  variantId: string;
  platform: PublishPlatform;
  accountRef: string;
  operation: "dry_run" | "reconcile";
  idempotencyKey: string;
  payloadHash: string;
  state: PublishJobState;
  remoteId: string | null;
  lastError: string | null;
  reconcileRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PublishPlanSummary {
  planId: string;
  revisionId: string;
  status: "draft" | "approved" | "queued" | "running" | "completed" | "needs_attention";
  approvalStatus: "not_required" | "pending" | "approved" | "rejected";
  createdAt: string;
  updatedAt: string;
  variants: PublishVariantSummary[];
  jobs: PublishJobSummary[];
  persistence: "memory" | "local_database";
}

export interface PublishReceiptSummary {
  id: string;
  jobId: string;
  status: string;
  remoteId: string;
  contentHash: string;
  createdAt: string;
}

export interface ProcessPublishJobSummary {
  job: PublishJobSummary;
  receipt: PublishReceiptSummary | null;
}

export interface GenerateImageRequest {
  prompt: string;
  size: "512x512" | "768x768" | "1024x1024" | "1024x1536" | "1536x1024";
  model: string | null;
}

export interface GenerateImageSummary {
  artifactCount: number;
  provider: string;
  model: string;
  mocked: boolean;
  remoteUrlsIgnored: number;
  mediaTypes: string[];
}

export type ConnectionProvider = "openai-compatible" | "mock";

export interface CreateConnectionProfileRequest {
  name: string;
  provider: ConnectionProvider;
  baseUrl: string | null;
  secretEnvVar: string | null;
  defaultTextModel: string | null;
  defaultImageModel: string | null;
  timeoutSeconds: number;
}

export interface ConnectionProfilePublic {
  id: string;
  name: string;
  provider: string;
  baseUrl: string | null;
  secretScheme: "env" | "mock" | "keyring" | "stronghold";
  secretConfigured: boolean;
  defaultTextModel: string | null;
  defaultImageModel: string | null;
  timeoutSeconds: number;
  createdAt: string;
}

export interface DesktopBridge {
  runtimeSnapshot(): Promise<RuntimeSnapshot>;
  ensureAgentRuntime(): Promise<RuntimeSnapshot>;
  stopAgentRuntime(): Promise<RuntimeSnapshot>;
  saveDraft(request: SaveDraftRequest): Promise<SaveDraftReceipt>;
  runWorkflow(request: RunWorkflowRequest): Promise<RunWorkflowSummary>;
  createPublishPlan(request: CreatePublishPlanRequest): Promise<PublishPlanSummary>;
  getPublishPlan(request: PublishPlanRequest): Promise<PublishPlanSummary>;
  approvePublishPlan(request: PublishPlanRequest): Promise<PublishPlanSummary>;
  enqueuePublishPlan(request: PublishPlanRequest): Promise<PublishPlanSummary>;
  processPublishJob(request: ProcessPublishJobRequest): Promise<ProcessPublishJobSummary>;
  generateImage(request: GenerateImageRequest): Promise<GenerateImageSummary>;
  listConnectionProfiles(): Promise<ConnectionProfilePublic[]>;
  createConnectionProfile(
    request: CreateConnectionProfileRequest,
  ): Promise<ConnectionProfilePublic>;
}

const isTauriHost = () => typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

let mockGeneration = 0;
let mockRuntimeState: RuntimeState = "standby";
const mockConnectionProfiles: ConnectionProfilePublic[] = [];
let mockSequence = 0;

interface MockArticleState {
  revisionId: string;
  markdown: string;
  revisionNumber: number;
}

const mockArticles = new Map<string, MockArticleState>();
const mockPublishPlans = new Map<string, PublishPlanSummary>();
const mockPublishReceipts = new Map<string, PublishReceiptSummary>();

const nextMockId = (prefix: string) => `${prefix}-${++mockSequence}`;

const mockHash = (seed: string) => {
  const hex = Array.from(seed || "0", (character) =>
    character.charCodeAt(0).toString(16).padStart(2, "0"),
  ).join("");
  return hex.repeat(Math.ceil(64 / hex.length)).slice(0, 64);
};

const clonePlan = (plan: PublishPlanSummary): PublishPlanSummary => ({
  ...plan,
  variants: plan.variants.map((variant) => ({ ...variant })),
  jobs: plan.jobs.map((job) => ({ ...job })),
});

const requireMockPlan = (planId: string) => {
  const plan = mockPublishPlans.get(planId);
  if (!plan) throw new Error(`publish plan ${planId} not found`);
  return plan;
};

const mockBridge: DesktopBridge = {
  async runtimeSnapshot() {
    return {
      state: mockRuntimeState,
      bridgeMode: "interface_only",
      generation: mockGeneration,
      detail: "浏览器预览使用内存桥接，不会访问模型或发布平台。",
    };
  },
  async ensureAgentRuntime() {
    mockRuntimeState = "starting";
    await pause(120);
    mockRuntimeState = "ready";
    mockGeneration += 1;
    return {
      state: mockRuntimeState,
      bridgeMode: "interface_only",
      generation: mockGeneration,
      detail: "本地接口已就绪；当前为演示运行时。",
    };
  },
  async stopAgentRuntime() {
    mockRuntimeState = "stopped";
    return {
      state: mockRuntimeState,
      bridgeMode: "interface_only",
      generation: mockGeneration,
      detail: "演示运行时已停止。",
    };
  },
  async saveDraft(request) {
    await pause(80);
    const current = mockArticles.get(request.articleId);
    if (
      request.baseRevision &&
      current &&
      request.baseRevision !== current.revisionId
    ) {
      throw new Error("该稿件的基础修订已过期");
    }
    const revisionId = nextMockId(`${request.articleId}-local`);
    mockArticles.set(request.articleId, {
      revisionId,
      markdown: request.markdown,
      revisionNumber: (current?.revisionNumber ?? 0) + 1,
    });
    return {
      revisionId,
      savedAtEpochMs: Date.now(),
      persistence: "memory",
    };
  },
  async runWorkflow(request) {
    mockRuntimeState = "ready";
    mockGeneration += 1;
    await pause(180);
    const article = mockArticles.get(request.articleId);
    if (!article || article.revisionId !== request.revisionId) {
      throw new Error("请先保存当前稿件，再运行工作流");
    }
    const definitions: Array<[string, string, DisabledOptionalNodeId | null]> = [
      ["research", "workflow.research", "research"],
      ["outline", "workflow.outline", "outline"],
      ["raw-draft", "workflow.raw-draft", null],
      ["natural-patch", "workflow.natural-style-patch", "natural-style"],
      ["canonical-draft", "workflow.canonical-draft", "natural-style"],
      ["review", "workflow.review", "review"],
      ["risk", "workflow.risk", null],
      ["visual", "workflow.visual-plan", "visual"],
    ];
    const disabled = new Set(request.disabledOptionalNodeIds);
    const outputRevisionId = nextMockId(`${request.articleId}-workflow`);
    const outputMarkdown = `${article.markdown.trim()}\n\n<!-- mock workflow ${outputRevisionId} -->`;
    const revisionNumber = article.revisionNumber + 1;
    mockArticles.set(request.articleId, {
      revisionId: outputRevisionId,
      markdown: outputMarkdown,
      revisionNumber,
    });
    return {
      runId: nextMockId("run"),
      status: "completed",
      workflowName: "mock-article",
      workflowVersion: "1.1.0",
      inputRevisionId: request.revisionId,
      outputRevisionId,
      outputRevisionNumber: revisionNumber,
      outputMarkdown,
      outputContentHash: mockHash(outputMarkdown),
      artifacts: definitions
        .filter(([, , optionalNode]) => !optionalNode || !disabled.has(optionalNode))
        .map(([suffix, kind]) => ({
          id: `${outputRevisionId}-${suffix}`,
          kind,
        })),
      persistence: "memory",
    };
  },
  async createPublishPlan(request) {
    await pause(100);
    const article = mockArticles.get(request.articleId);
    if (!article || article.revisionId !== request.revisionId) {
      throw new Error("只能为当前已保存修订创建发布计划");
    }
    const planId = nextMockId("plan");
    const now = new Date().toISOString();
    const plan: PublishPlanSummary = {
      planId,
      revisionId: request.revisionId,
      status: "draft",
      approvalStatus: "pending",
      createdAt: now,
      updatedAt: now,
      variants: request.platforms.map((platform) => ({
        id: `${planId}-${platform}-variant`,
        platform,
        accountRef: `desktop-${platform}`,
        title: `本地演练 · ${platform}`,
        contentHash: mockHash(`${request.revisionId}-${platform}`),
      })),
      jobs: [],
      persistence: "memory",
    };
    mockPublishPlans.set(planId, plan);
    return clonePlan(plan);
  },
  async getPublishPlan(request) {
    await pause(40);
    return clonePlan(requireMockPlan(request.planId));
  },
  async approvePublishPlan(request) {
    await pause(80);
    const plan = requireMockPlan(request.planId);
    plan.status = "approved";
    plan.approvalStatus = "approved";
    plan.updatedAt = new Date().toISOString();
    return clonePlan(plan);
  },
  async enqueuePublishPlan(request) {
    await pause(80);
    const plan = requireMockPlan(request.planId);
    if (plan.approvalStatus !== "approved") {
      throw new Error("publish plan must be explicitly approved before enqueue");
    }
    if (plan.jobs.length === 0) {
      const now = new Date().toISOString();
      plan.jobs = plan.variants.map((variant) => ({
        id: `${plan.planId}-${variant.platform}-job`,
        planId: plan.planId,
        variantId: variant.id,
        platform: variant.platform,
        accountRef: variant.accountRef,
        operation: "dry_run",
        idempotencyKey: mockHash(`${plan.planId}-${variant.id}-idempotency`),
        payloadHash: mockHash(`${variant.id}-payload`),
        state: "pending",
        remoteId: null,
        lastError: null,
        reconcileRequired: false,
        createdAt: now,
        updatedAt: now,
      }));
    }
    plan.status = "queued";
    plan.updatedAt = new Date().toISOString();
    return clonePlan(plan);
  },
  async processPublishJob(request) {
    await pause(80);
    const plan = [...mockPublishPlans.values()].find((candidate) =>
      candidate.jobs.some((job) => job.id === request.jobId),
    );
    if (!plan) throw new Error(`publish job ${request.jobId} not found`);
    const job = plan.jobs.find((candidate) => candidate.id === request.jobId);
    if (!job) throw new Error(`publish job ${request.jobId} not found`);
    let receipt = mockPublishReceipts.get(job.id);
    if (!receipt) {
      job.state = "succeeded";
      job.remoteId = `dry-run-${job.platform}-${job.id.slice(-8)}`;
      job.updatedAt = new Date().toISOString();
      receipt = {
        id: `${job.id}-receipt`,
        jobId: job.id,
        status: "published",
        remoteId: job.remoteId,
        contentHash: job.payloadHash,
        createdAt: job.updatedAt,
      };
      mockPublishReceipts.set(job.id, receipt);
    }
    plan.status = plan.jobs.every((candidate) => candidate.state === "succeeded")
      ? "completed"
      : "running";
    plan.updatedAt = new Date().toISOString();
    return {
      job: { ...job },
      receipt: { ...receipt },
    };
  },
  async generateImage() {
    await pause(100);
    return {
      artifactCount: 1,
      provider: "mock",
      model: "deterministic-svg-v1",
      mocked: true,
      remoteUrlsIgnored: 0,
      mediaTypes: ["image/svg+xml"],
    };
  },
  async listConnectionProfiles() {
    await pause(60);
    return [...mockConnectionProfiles];
  },
  async createConnectionProfile(request) {
    await pause(100);
    const profile: ConnectionProfilePublic = {
      id: `mock-connection-${mockConnectionProfiles.length + 1}`,
      name: request.name.trim(),
      provider: request.provider,
      baseUrl: request.provider === "mock" ? null : request.baseUrl,
      secretScheme: request.provider === "mock" ? "mock" : "env",
      secretConfigured: true,
      defaultTextModel: request.defaultTextModel,
      defaultImageModel: request.defaultImageModel,
      timeoutSeconds: request.timeoutSeconds,
      createdAt: new Date().toISOString(),
    };
    mockConnectionProfiles.push(profile);
    return profile;
  },
};

const tauriBridge: DesktopBridge = {
  runtimeSnapshot: () => invoke<RuntimeSnapshot>("runtime_snapshot"),
  ensureAgentRuntime: () => invoke<RuntimeSnapshot>("ensure_agent_runtime"),
  stopAgentRuntime: () => invoke<RuntimeSnapshot>("stop_agent_runtime"),
  saveDraft: (request) => invoke<SaveDraftReceipt>("save_draft", { request }),
  runWorkflow: (request) => invoke<RunWorkflowSummary>("run_workflow", { request }),
  createPublishPlan: (request) =>
    invoke<PublishPlanSummary>("create_publish_plan", { request }),
  getPublishPlan: (request) =>
    invoke<PublishPlanSummary>("get_publish_plan", { request }),
  approvePublishPlan: (request) =>
    invoke<PublishPlanSummary>("approve_publish_plan", { request }),
  enqueuePublishPlan: (request) =>
    invoke<PublishPlanSummary>("enqueue_publish_plan", { request }),
  processPublishJob: (request) =>
    invoke<ProcessPublishJobSummary>("process_publish_job", { request }),
  generateImage: (request) =>
    invoke<GenerateImageSummary>("generate_image", { request }),
  listConnectionProfiles: () =>
    invoke<ConnectionProfilePublic[]>("list_connection_profiles"),
  createConnectionProfile: (request) =>
    invoke<ConnectionProfilePublic>("create_connection_profile", { request }),
};

/**
 * React only sees this narrow Rust command surface. It receives neither a Python
 * endpoint nor plaintext provider/platform credentials.
 */
export const desktopBridge: DesktopBridge = {
  runtimeSnapshot: () =>
    isTauriHost() ? tauriBridge.runtimeSnapshot() : mockBridge.runtimeSnapshot(),
  ensureAgentRuntime: () =>
    isTauriHost() ? tauriBridge.ensureAgentRuntime() : mockBridge.ensureAgentRuntime(),
  stopAgentRuntime: () =>
    isTauriHost() ? tauriBridge.stopAgentRuntime() : mockBridge.stopAgentRuntime(),
  saveDraft: (request) =>
    isTauriHost() ? tauriBridge.saveDraft(request) : mockBridge.saveDraft(request),
  runWorkflow: (request) =>
    isTauriHost() ? tauriBridge.runWorkflow(request) : mockBridge.runWorkflow(request),
  createPublishPlan: (request) =>
    isTauriHost()
      ? tauriBridge.createPublishPlan(request)
      : mockBridge.createPublishPlan(request),
  getPublishPlan: (request) =>
    isTauriHost()
      ? tauriBridge.getPublishPlan(request)
      : mockBridge.getPublishPlan(request),
  approvePublishPlan: (request) =>
    isTauriHost()
      ? tauriBridge.approvePublishPlan(request)
      : mockBridge.approvePublishPlan(request),
  enqueuePublishPlan: (request) =>
    isTauriHost()
      ? tauriBridge.enqueuePublishPlan(request)
      : mockBridge.enqueuePublishPlan(request),
  processPublishJob: (request) =>
    isTauriHost()
      ? tauriBridge.processPublishJob(request)
      : mockBridge.processPublishJob(request),
  generateImage: (request) =>
    isTauriHost()
      ? tauriBridge.generateImage(request)
      : mockBridge.generateImage(request),
  listConnectionProfiles: () =>
    isTauriHost()
      ? tauriBridge.listConnectionProfiles()
      : mockBridge.listConnectionProfiles(),
  createConnectionProfile: (request) =>
    isTauriHost()
      ? tauriBridge.createConnectionProfile(request)
      : mockBridge.createConnectionProfile(request),
};
