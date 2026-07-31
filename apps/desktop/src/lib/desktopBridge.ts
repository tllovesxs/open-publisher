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

export interface StoredArticleSummary {
  articleId: string;
  title: string;
  markdown: string;
  revisionId: string;
  revisionNumber: number;
  updatedAt: string;
}

export interface RunWorkflowRequest {
  articleId: string;
  revisionId: string;
  topic: string;
  disabledOptionalNodeIds: DisabledOptionalNodeId[];
  agentInstructions: WorkflowAgentInstruction[];
  visualComposition?: VisualCompositionRequest;
}

export type DisabledOptionalNodeId =
  | "research"
  | "outline"
  | "natural-style"
  | "review"
  | "visual";

export type WorkflowNodeId = DisabledOptionalNodeId | "draft" | "risk";

/** A text-only Skill snapshot. The desktop bridge never executes Skill code. */
export interface WorkflowSkillInstruction {
  id: string;
  name: string;
  instructions: string;
}

/** A per-node Agent snapshot used for one workflow run. */
export interface WorkflowAgentInstruction {
  id: string;
  name: string;
  role: string;
  nodeId: WorkflowNodeId;
  prompt: string;
  skills: WorkflowSkillInstruction[];
}

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
  visualPlan: VisualCompositionPlanSummary | null;
  persistence: "memory" | "local_database";
}

export type VisualImageMode = "none" | "auto" | "fixed";

/** Text-only metadata lets a text model place a local image without seeing its bytes. */
export interface VisualAssetInstruction {
  id: string;
  alt: string;
  description: string;
}

export interface VisualCompositionRequest {
  mode: VisualImageMode;
  targetCount: number;
  assets: VisualAssetInstruction[];
}

export interface VisualPlacementSummary {
  afterHeading: string | null;
  assetId: string | null;
  alt: string;
  generationPrompt: string | null;
}

export interface VisualCompositionPlanSummary {
  targetCount: number;
  placements: VisualPlacementSummary[];
}

/** Safe, backend-originated lifecycle data for a currently running workflow. */
export interface WorkflowActivityEvent {
  id: string;
  eventType: string;
  nodeId: WorkflowNodeId | null;
  createdAt: string;
  /** Bounded text chunk emitted only by the writing Agent. */
  draftDelta?: string;
}

export interface WorkflowActivitySummary {
  runId: string;
  status: "queued" | "running";
  events: WorkflowActivityEvent[];
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
  images: GeneratedImageSummary[];
}

export interface GeneratedImageSummary {
  id: string;
  mediaType: string;
  /** Locally retained, content-addressed image bytes encoded for the renderer. */
  dataUrl: string;
}

export interface ExtractTemplateRequest {
  sourceMarkdown: string;
}

export interface TemplateExtractionSummary {
  name: string;
  description: string;
  category: string;
  markdown: string;
  provider: string;
  model: string;
  mocked: boolean;
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

export interface ConfigureModelRequest {
  name: string;
  baseUrl: string;
  apiKey: string;
  textModel: string;
  imageBaseUrl: string | null;
  imageModel: string | null;
  imageTrustedHosts: string[];
  timeoutSeconds: number;
}

export interface ModelConfigurationSummary {
  name: string;
  baseUrl: string;
  textModel: string;
  imageBaseUrl: string | null;
  imageModel: string | null;
  imageTrustedHosts: string[];
  timeoutSeconds: number;
  secretConfigured: boolean;
  persistence: "session";
}

export interface ModelConnectionTestSummary {
  provider: string;
  model: string;
  mocked: boolean;
}

export interface DesktopBridge {
  runtimeSnapshot(): Promise<RuntimeSnapshot>;
  ensureAgentRuntime(): Promise<RuntimeSnapshot>;
  stopAgentRuntime(): Promise<RuntimeSnapshot>;
  listArticles(): Promise<StoredArticleSummary[]>;
  saveDraft(request: SaveDraftRequest): Promise<SaveDraftReceipt>;
  runWorkflow(request: RunWorkflowRequest): Promise<RunWorkflowSummary>;
  getWorkflowActivity(articleId: string): Promise<WorkflowActivitySummary | null>;
  createPublishPlan(request: CreatePublishPlanRequest): Promise<PublishPlanSummary>;
  getPublishPlan(request: PublishPlanRequest): Promise<PublishPlanSummary>;
  approvePublishPlan(request: PublishPlanRequest): Promise<PublishPlanSummary>;
  enqueuePublishPlan(request: PublishPlanRequest): Promise<PublishPlanSummary>;
  processPublishJob(request: ProcessPublishJobRequest): Promise<ProcessPublishJobSummary>;
  generateImage(request: GenerateImageRequest): Promise<GenerateImageSummary>;
  extractTemplate(request: ExtractTemplateRequest): Promise<TemplateExtractionSummary>;
  listConnectionProfiles(): Promise<ConnectionProfilePublic[]>;
  createConnectionProfile(
    request: CreateConnectionProfileRequest,
  ): Promise<ConnectionProfilePublic>;
  configureModel(request: ConfigureModelRequest): Promise<ModelConfigurationSummary>;
  modelConfiguration(): Promise<ModelConfigurationSummary | null>;
  testModelConnection(): Promise<ModelConnectionTestSummary>;
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
  updatedAt: string;
}

const mockArticles = new Map<string, MockArticleState>();
const mockPublishPlans = new Map<string, PublishPlanSummary>();
const mockPublishReceipts = new Map<string, PublishReceiptSummary>();
let mockModelConfiguration: ModelConfigurationSummary | null = null;

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

const mockTemplateMarkdown = (sourceMarkdown: string) => {
  const normalized = sourceMarkdown.replace(/\r\n?/g, "\n").trim();
  if (!normalized || normalized.length > 60_000) {
    throw new Error("待提取的 Markdown 应为 1–60000 个可见字符。");
  }
  if ([...normalized].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 && character !== "\n" && character !== "\t";
  })) {
    throw new Error("待提取的 Markdown 包含不支持的控制字符。");
  }
  const headingDepths = normalized
    .split("\n")
    .map((line) => line.match(/^(#{1,6})\s+\S/)?.[1].length)
    .filter((depth): depth is number => depth !== undefined)
    .slice(1, 9);
  const sectionDepths = headingDepths.length > 0 ? headingDepths : [2, 2, 2];
  const sections = sectionDepths.flatMap((depth, index) => [
    `${"#".repeat(depth)} {{section_${index + 1}_heading}}`,
    "",
    `{{section_${index + 1}_content}}`,
    "",
  ]);
  return [
    "# {{title}}",
    "",
    "{{lead}}",
    "",
    ...sections,
    "## {{closing_heading}}",
    "",
    "{{closing}}",
  ].join("\n").trim();
};

const mockVisualPlanFor = (
  request: RunWorkflowRequest,
): VisualCompositionPlanSummary | null => {
  const composition = request.visualComposition;
  if (!composition || composition.mode === "none") return null;
  const targetCount = composition.mode === "fixed" ? composition.targetCount : 1;
  return {
    targetCount,
    placements: Array.from({ length: targetCount }, (_, index) => {
      const asset = composition.assets[index];
      if (asset) {
        return {
          afterHeading: null,
          assetId: asset.id,
          alt: asset.alt,
          generationPrompt: null,
        };
      }
      return {
        afterHeading: null,
        assetId: null,
        alt: `模拟文章配图 ${index + 1}`,
        generationPrompt: `为文章生成第 ${index + 1} 张克制的模拟配图。`,
      };
    }),
  };
};

/**
 * In-memory bridge retained solely for unit tests. Production browser previews
 * must use `browserPreviewBridge` below so they cannot appear to run agents.
 */
export const testOnlyMockDesktopBridge: DesktopBridge = {
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
  async listArticles() {
    await pause(40);
    return [...mockArticles.entries()].map(([articleId, article]) => {
      const heading = article.markdown
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.startsWith("# "));
      return {
        articleId,
        title: heading?.replace(/^#\s+/, "").trim() || "未命名文章",
        markdown: article.markdown,
        revisionId: article.revisionId,
        revisionNumber: article.revisionNumber,
        updatedAt: article.updatedAt,
      };
    });
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
      updatedAt: new Date().toISOString(),
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
      updatedAt: new Date().toISOString(),
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
      visualPlan: mockVisualPlanFor(request),
      persistence: "memory",
    };
  },
  async getWorkflowActivity() {
    return null;
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
    const imageId = nextMockId("generated-image");
    return {
      artifactCount: 1,
      provider: "mock",
      model: "deterministic-png-v1",
      mocked: true,
      remoteUrlsIgnored: 0,
      mediaTypes: ["image/png"],
      images: [
        {
          id: imageId,
          mediaType: "image/png",
          // A valid one-pixel PNG lets the browser preview exercise the same asset path.
          dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLZ8QAAAABJRU5ErkJggg==",
        },
      ],
    };
  },
  async extractTemplate(request) {
    await pause(180);
    return {
      name: "文章结构模板",
      description: "从原文层级提取的可复用 Markdown 结构。",
      category: "自定义文章",
      markdown: mockTemplateMarkdown(request.sourceMarkdown),
      provider: "mock",
      model: mockModelConfiguration?.textModel ?? "deterministic-mock-v1",
      mocked: true,
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
  async configureModel(request) {
    await pause(80);
    mockModelConfiguration = {
      name: request.name.trim(),
      baseUrl: request.baseUrl.trim().replace(/\/+$/, ""),
      textModel: request.textModel.trim(),
      imageBaseUrl: request.imageBaseUrl?.trim().replace(/\/+$/, "") || null,
      imageModel: request.imageModel?.trim() || null,
      imageTrustedHosts: request.imageTrustedHosts,
      timeoutSeconds: request.timeoutSeconds,
      secretConfigured: Boolean(request.apiKey.trim()),
      persistence: "session",
    };
    return { ...mockModelConfiguration };
  },
  async modelConfiguration() {
    return mockModelConfiguration ? { ...mockModelConfiguration } : null;
  },
  async testModelConnection() {
    await pause(120);
    return {
      provider: "mock",
      model: mockModelConfiguration?.textModel ?? "deterministic-mock-v1",
      mocked: true,
    };
  },
};

const tauriBridge: DesktopBridge = {
  runtimeSnapshot: () => invoke<RuntimeSnapshot>("runtime_snapshot"),
  ensureAgentRuntime: () => invoke<RuntimeSnapshot>("ensure_agent_runtime"),
  stopAgentRuntime: () => invoke<RuntimeSnapshot>("stop_agent_runtime"),
  listArticles: () => invoke<StoredArticleSummary[]>("list_articles"),
  saveDraft: (request) => invoke<SaveDraftReceipt>("save_draft", { request }),
  runWorkflow: (request) => invoke<RunWorkflowSummary>("run_workflow", { request }),
  getWorkflowActivity: (articleId) =>
    invoke<WorkflowActivitySummary | null>("workflow_activity", { articleId }),
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
  extractTemplate: (request) =>
    invoke<TemplateExtractionSummary>("extract_template", { request }),
  listConnectionProfiles: () =>
    invoke<ConnectionProfilePublic[]>("list_connection_profiles"),
  createConnectionProfile: (request) =>
    invoke<ConnectionProfilePublic>("create_connection_profile", { request }),
  configureModel: (request) =>
    invoke<ModelConfigurationSummary>("configure_model", { request }),
  modelConfiguration: () =>
    invoke<ModelConfigurationSummary | null>("model_configuration"),
  testModelConnection: () =>
    invoke<ModelConnectionTestSummary>("test_model_connection"),
};

const DESKTOP_HOST_REQUIRED =
  "浏览器预览不能调用本地 Agent。请在 Open Publisher 桌面应用中执行此操作。";

const desktopHostRequired = (): Promise<never> =>
  Promise.reject(new Error(DESKTOP_HOST_REQUIRED));

/** Browser previews are read-only and deliberately cannot simulate execution. */
const browserPreviewBridge: DesktopBridge = {
  runtimeSnapshot: async () => ({
    state: "standby",
    bridgeMode: "interface_only",
    generation: 0,
    detail: "浏览器预览不能调用本地 Agent 或访问本地数据。请使用桌面应用。",
  }),
  ensureAgentRuntime: desktopHostRequired,
  stopAgentRuntime: desktopHostRequired,
  listArticles: async () => [],
  saveDraft: desktopHostRequired,
  runWorkflow: desktopHostRequired,
  getWorkflowActivity: desktopHostRequired,
  createPublishPlan: desktopHostRequired,
  getPublishPlan: desktopHostRequired,
  approvePublishPlan: desktopHostRequired,
  enqueuePublishPlan: desktopHostRequired,
  processPublishJob: desktopHostRequired,
  generateImage: desktopHostRequired,
  extractTemplate: desktopHostRequired,
  listConnectionProfiles: async () => [],
  createConnectionProfile: desktopHostRequired,
  configureModel: desktopHostRequired,
  modelConfiguration: async () => null,
  testModelConnection: desktopHostRequired,
};

let testBridgeOverride: DesktopBridge | null = null;

/** Test-only injection point. Never call this from application code. */
export function setDesktopBridgeForTests(bridge: DesktopBridge | null) {
  testBridgeOverride = bridge;
}

const activeBridge = () =>
  testBridgeOverride ?? (isTauriHost() ? tauriBridge : browserPreviewBridge);

/**
 * React only sees this narrow Rust command surface. It receives neither a Python
 * endpoint nor plaintext provider/platform credentials.
 */
export const desktopBridge: DesktopBridge = {
  runtimeSnapshot: () => activeBridge().runtimeSnapshot(),
  ensureAgentRuntime: () => activeBridge().ensureAgentRuntime(),
  stopAgentRuntime: () => activeBridge().stopAgentRuntime(),
  listArticles: () => activeBridge().listArticles(),
  saveDraft: (request) => activeBridge().saveDraft(request),
  runWorkflow: (request) => activeBridge().runWorkflow(request),
  getWorkflowActivity: (articleId) => activeBridge().getWorkflowActivity(articleId),
  createPublishPlan: (request) => activeBridge().createPublishPlan(request),
  getPublishPlan: (request) => activeBridge().getPublishPlan(request),
  approvePublishPlan: (request) => activeBridge().approvePublishPlan(request),
  enqueuePublishPlan: (request) => activeBridge().enqueuePublishPlan(request),
  processPublishJob: (request) => activeBridge().processPublishJob(request),
  generateImage: (request) => activeBridge().generateImage(request),
  extractTemplate: (request) => activeBridge().extractTemplate(request),
  listConnectionProfiles: () => activeBridge().listConnectionProfiles(),
  createConnectionProfile: (request) => activeBridge().createConnectionProfile(request),
  configureModel: (request) => activeBridge().configureModel(request),
  modelConfiguration: () => activeBridge().modelConfiguration(),
  testModelConnection: () => activeBridge().testModelConnection(),
};
