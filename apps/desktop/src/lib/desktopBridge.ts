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
  webSearchMode?: WebSearchMode;
  maxWebSearchCalls?: number;
  visualComposition?: VisualCompositionRequest;
}

export type WebSearchMode = "off" | "auto" | "required";

export interface BatchTopicCandidate {
  title: string;
  topic: string;
  angle: string;
  keyPoints: string[];
}

export interface BatchTopicPlanRequest {
  prompt: string;
  count: number;
  references: string;
  manualTopics: string[];
}

export interface BatchTopicPlanSummary {
  candidates: BatchTopicCandidate[];
  plannedBy: "model" | "manual";
}

export interface CreateGenerationBatchRequest {
  prompt: string;
  candidates: BatchTopicCandidate[];
  sourceMarkdown: string;
  disabledOptionalNodeIds: DisabledOptionalNodeId[];
  agentInstructions: WorkflowAgentInstruction[];
  webSearchMode: WebSearchMode;
  maxWebSearchCalls: number;
  writerConcurrency: number;
}

export interface GenerationBatchRequest {
  batchId: string;
}

export interface GenerationItemRequest {
  itemId: string;
}

export type GenerationBatchStatus =
  | "queued"
  | "running"
  | "completed"
  | "needs_attention"
  | "cancelled";

export type GenerationItemStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface GenerationBatchSummary {
  id: string;
  prompt: string;
  status: GenerationBatchStatus;
  writerConcurrency: number;
  createdAt: string;
  updatedAt: string;
}

export interface GenerationItemSummary {
  id: string;
  batchId: string;
  position: number;
  title: string;
  topic: string;
  status: GenerationItemStatus;
  articleId: string | null;
  runId: string | null;
  error: string | null;
  retryCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface GenerationBatchDetail {
  batch: GenerationBatchSummary;
  items: GenerationItemSummary[];
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
export type VisualAssetScope = "selected_only" | "library" | "none";
export type VisualDensity = "minimal" | "balanced" | "per-section" | "rich";

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
  assetScope: VisualAssetScope;
  preferredType: "infographic" | "scene" | "flowchart" | "comparison" | "framework" | "timeline";
  density: VisualDensity;
  style: string;
  palette: string | null;
  preferredImageBackend: string;
  generationBatchSize: number;
  skipConfirmation: boolean;
}

export interface VisualMaterialCandidateSummary {
  assetId: string;
  /** Integer score on a 0-1000 scale, avoiding a float across the Rust boundary. */
  score: number;
  description: string;
}

export interface VisualPlacementSummary {
  id: string;
  blockId: string | null;
  anchorExcerpt: string | null;
  afterHeading: string | null;
  purpose: string;
  visualContent: string;
  visualType: string;
  source: "existing_asset" | "generate";
  assetId: string | null;
  candidates: VisualMaterialCandidateSummary[];
  selectionReason: string;
  alt: string;
  generationPrompt: string | null;
  promptFile: string | null;
}

export interface VisualCompositionPlanSummary {
  sourceRevisionHash: string;
  targetCount: number;
  settings: Record<string, string>;
  needsConfirmation: boolean;
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
  /** Present only when the writer called a reviewed workflow tool. */
  toolName?: "web_search" | "github_repository";
  toolQuery?: string;
  sources?: WorkflowSourceSummary[];
}

/** Safe source fields projected from a workflow tool result for the workspace. */
export interface WorkflowSourceSummary {
  sourceId: string;
  title: string;
  url: string;
  excerpt: string;
  publishedDate?: string | null;
}

export interface WorkflowActivitySummary {
  runId: string;
  status: "queued" | "running";
  events: WorkflowActivityEvent[];
}

/** The desktop accepts any adapter ID reported by the local WechatSync bridge. */
export type PublishPlatform = string;

export interface CreatePublishPlanRequest {
  articleId: string;
  revisionId: string;
  platforms: PublishPlatform[];
  deliveryMode?: "dry_run" | "wechat_sync_draft";
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
  operation: "dry_run" | "wechat_sync_draft" | "reconcile";
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

export interface RewriteArticleRequest {
  articleId: string;
  requestId: string;
  markdown: string;
  instruction: string;
  selectedTexts: string[];
  conversation: RewriteConversationMessage[];
}

export interface RewriteConversationMessage {
  role: "user" | "assistant";
  text: string;
}

export interface RewriteArticleSummary {
  replacements: string[];
  summary: string;
  provider: string;
  model: string;
  mocked: boolean;
}

export interface RewriteStreamEvent {
  articleId: string;
  requestId: string;
  eventType: "status" | "delta";
  detail: string | null;
  delta: string | null;
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
  styleProfile: {
    tone: string;
    audience: string;
    perspective: string;
    sentenceStyle: string;
    pacing: string;
    density: string;
  };
  structureProfile: {
    openingPattern: string;
    sectionPattern: string;
    conclusionPattern: string;
    headingDepth: string;
    paragraphPattern: string;
  };
  layoutProfile: {
    useLists: boolean;
    useTables: boolean;
    useBlockquotes: boolean;
    useCodeBlocks: boolean;
    imagePlacement: string;
    emphasisRules: string;
  };
  fixedBlocks: Array<{
    id: string;
    label: string;
    enabled: boolean;
    content: string;
    position: "before_title" | "after_intro" | "before_closing" | "after_article";
  }>;
  variables: string[];
  usageInstructions: string;
  analysisVersion: string;
  sourceFingerprint: string;
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
  /** Legacy shared key retained for migration. New settings use independent keys. */
  apiKey?: string;
  textApiKey: string;
  textModel: string;
  imageBaseUrl: string | null;
  imageModel: string | null;
  imageApiKey: string;
  imageTrustedHosts: string[];
  tavilyApiKey: string;
  githubToken: string;
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
  imageSecretConfigured: boolean;
  webSearchConfigured: boolean;
  githubConfigured: boolean;
  textKeyMasked: string | null;
  imageKeyMasked: string | null;
  tavilyKeyMasked: string | null;
  githubTokenMasked: string | null;
  persistence: "encrypted_local_database";
}

export type ModelSecretKind = "text" | "image" | "web_search" | "github";

export interface ModelConnectionTestSummary {
  provider: string;
  model: string;
  mocked: boolean;
}

export interface GitHubApplicationInfo {
  repository: string;
  authorName: string;
  authorUrl: string;
  installedVersion: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
  updateAvailable: boolean;
  detail: string;
}

/** Public-only status from a locally running WechatSync bridge. */
export interface WechatSyncBridgeStatus {
  available: boolean;
  connected: boolean;
  detail: string;
  platforms: Array<{
    id: string;
    authenticated: boolean;
    accountLabel: string | null;
  }>;
}

export interface DesktopBridge {
  runtimeSnapshot(): Promise<RuntimeSnapshot>;
  ensureAgentRuntime(): Promise<RuntimeSnapshot>;
  stopAgentRuntime(): Promise<RuntimeSnapshot>;
  listArticles(): Promise<StoredArticleSummary[]>;
  saveDraft(request: SaveDraftRequest): Promise<SaveDraftReceipt>;
  runWorkflow(request: RunWorkflowRequest): Promise<RunWorkflowSummary>;
  planGenerationBatch(request: BatchTopicPlanRequest): Promise<BatchTopicPlanSummary>;
  createGenerationBatch(request: CreateGenerationBatchRequest): Promise<GenerationBatchDetail>;
  listGenerationBatches(): Promise<GenerationBatchDetail[]>;
  getGenerationBatch(request: GenerationBatchRequest): Promise<GenerationBatchDetail>;
  cancelGenerationBatch(request: GenerationBatchRequest): Promise<GenerationBatchDetail>;
  retryGenerationItem(request: GenerationItemRequest): Promise<GenerationBatchDetail>;
  getWorkflowActivity(articleId: string): Promise<WorkflowActivitySummary | null>;
  createPublishPlan(request: CreatePublishPlanRequest): Promise<PublishPlanSummary>;
  getPublishPlan(request: PublishPlanRequest): Promise<PublishPlanSummary>;
  approvePublishPlan(request: PublishPlanRequest): Promise<PublishPlanSummary>;
  enqueuePublishPlan(request: PublishPlanRequest): Promise<PublishPlanSummary>;
  processPublishJob(request: ProcessPublishJobRequest): Promise<ProcessPublishJobSummary>;
  rewriteArticle(request: RewriteArticleRequest): Promise<RewriteArticleSummary>;
  generateImage(request: GenerateImageRequest): Promise<GenerateImageSummary>;
  extractTemplate(request: ExtractTemplateRequest): Promise<TemplateExtractionSummary>;
  listConnectionProfiles(): Promise<ConnectionProfilePublic[]>;
  createConnectionProfile(
    request: CreateConnectionProfileRequest,
  ): Promise<ConnectionProfilePublic>;
  configureModel(request: ConfigureModelRequest): Promise<ModelConfigurationSummary>;
  modelConfiguration(): Promise<ModelConfigurationSummary | null>;
  revealModelSecret(kind: ModelSecretKind): Promise<string | null>;
  testModelConnection(): Promise<ModelConnectionTestSummary>;
  githubApplicationInfo(): Promise<GitHubApplicationInfo>;
  wechatSyncStatus(): Promise<WechatSyncBridgeStatus>;
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
const mockGenerationBatches = new Map<string, GenerationBatchDetail>();
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
  outputMarkdown: string,
): VisualCompositionPlanSummary | null => {
  const composition = request.visualComposition;
  if (!composition || composition.mode === "none") return null;
  const targetCount = composition.mode === "fixed" ? composition.targetCount : 1;
  return {
    sourceRevisionHash: mockHash(outputMarkdown),
    targetCount,
    settings: {
      type: composition.preferredType,
      density: composition.density,
      style: composition.style,
      palette: composition.palette ?? "default",
      generation_batch_size: String(composition.generationBatchSize),
    },
    // The test-only browser bridge cannot run the persisted Baoyu confirmation
    // protocol. Native runs always request a visible confirmation.
    needsConfirmation: false,
    placements: Array.from({ length: targetCount }, (_, index) => {
      const asset = composition.assets[index];
      if (asset) {
        return {
          id: `illustration-${index + 1}`,
          blockId: null,
          anchorExcerpt: null,
          afterHeading: null,
          purpose: "模拟素材插入。",
          visualContent: asset.description,
          visualType: composition.preferredType,
          source: "existing_asset" as const,
          assetId: asset.id,
          candidates: [],
          selectionReason: "测试桥接使用已选素材。",
          alt: asset.alt,
          generationPrompt: null,
          promptFile: null,
        };
      }
      return {
        id: `illustration-${index + 1}`,
        blockId: null,
        anchorExcerpt: null,
        afterHeading: null,
        purpose: "模拟生成插图。",
        visualContent: `模拟文章配图 ${index + 1}`,
        visualType: composition.preferredType,
        source: "generate" as const,
        assetId: null,
        candidates: [],
        selectionReason: "测试桥接没有匹配的素材。",
        alt: `模拟文章配图 ${index + 1}`,
        generationPrompt: `# 模拟配图\n\nZONES: 为文章生成第 ${index + 1} 张克制的模拟配图。\nSTYLE: ${composition.style}\nASPECT: 3:2`,
        promptFile: `prompts/${String(index + 1).padStart(2, "0")}-mock.md`,
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
      visualPlan: mockVisualPlanFor(request, outputMarkdown),
      persistence: "memory",
    };
  },
  async planGenerationBatch(request) {
    await pause(80);
    const topics = request.manualTopics.length > 0
      ? request.manualTopics
      : Array.from({ length: request.count }, (_, index) =>
          `${request.prompt.trim()}（切入点 ${index + 1}）`);
    return {
      plannedBy: request.manualTopics.length > 0 ? "manual" : "model",
      candidates: topics.map((topic, index) => ({
        title: topic.slice(0, 180),
        topic,
        angle: `围绕第 ${index + 1} 个独立功能切入。`,
        keyPoints: ["问题与受众", "具体做法", "边界与下一步"],
      })),
    };
  },
  async createGenerationBatch(request) {
    await pause(80);
    const id = nextMockId("generation-batch");
    const now = new Date().toISOString();
    const detail: GenerationBatchDetail = {
      batch: {
        id,
        prompt: request.prompt,
        status: "completed",
        writerConcurrency: request.writerConcurrency,
        createdAt: now,
        updatedAt: now,
      },
      items: request.candidates.map((candidate, index) => ({
        id: `${id}-item-${index + 1}`,
        batchId: id,
        position: index + 1,
        title: candidate.title,
        topic: candidate.topic,
        status: "completed",
        articleId: null,
        runId: null,
        error: null,
        retryCount: 0,
        createdAt: now,
        startedAt: now,
        completedAt: now,
      })),
    };
    mockGenerationBatches.set(id, detail);
    return structuredClone(detail);
  },
  async listGenerationBatches() {
    return [...mockGenerationBatches.values()].map((detail) => structuredClone(detail));
  },
  async getGenerationBatch(request) {
    const detail = mockGenerationBatches.get(request.batchId);
    if (!detail) throw new Error(`generation batch ${request.batchId} not found`);
    return structuredClone(detail);
  },
  async cancelGenerationBatch(request) {
    const detail = mockGenerationBatches.get(request.batchId);
    if (!detail) throw new Error(`generation batch ${request.batchId} not found`);
    detail.batch.status = "cancelled";
    detail.batch.updatedAt = new Date().toISOString();
    detail.items = detail.items.map((item) =>
      item.status === "queued"
        ? { ...item, status: "cancelled", completedAt: detail.batch.updatedAt }
        : item,
    );
    return structuredClone(detail);
  },
  async retryGenerationItem(request) {
    const detail = [...mockGenerationBatches.values()].find((candidate) =>
      candidate.items.some((item) => item.id === request.itemId),
    );
    if (!detail) throw new Error(`generation item ${request.itemId} not found`);
    return structuredClone(detail);
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
  async rewriteArticle(request) {
    const sources = request.selectedTexts.length ? request.selectedTexts : [request.markdown];
    return {
      replacements: sources,
      summary: "本地演示模型保留了原文，未做实际语义改写。",
      provider: "mock",
      model: "deterministic-mock-v1",
      mocked: true,
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
      name: "高保真参考模板",
      description: "保留原文作为本地参考，并提取可迁移的结构与文风规则。",
      category: "参考写作",
      markdown: mockTemplateMarkdown(request.sourceMarkdown),
      styleProfile: {
        tone: "专业、清晰",
        audience: "关注主题的读者",
        perspective: "作者解释视角",
        sentenceStyle: "短段落，先结论后解释",
        pacing: "按章节递进",
        density: "中等",
      },
      structureProfile: {
        openingPattern: "先给结论和背景",
        sectionPattern: "按主题拆分章节",
        conclusionPattern: "总结并给出下一步",
        headingDepth: "二级标题承载章节",
        paragraphPattern: "每段表达一个要点",
      },
      layoutProfile: {
        useLists: true,
        useTables: false,
        useBlockquotes: false,
        useCodeBlocks: false,
        imagePlacement: "放在相关小节之后",
        emphasisRules: "适度强调关键词",
      },
      fixedBlocks: [],
      variables: ["title", "lead", "closing"],
      usageInstructions: "复用结构、表达节奏和排版，根据新的主题完成文章。",
      analysisVersion: "reference-template.v1",
      sourceFingerprint: `sha256:${mockHash(request.sourceMarkdown)}`,
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
      secretConfigured: Boolean(request.textApiKey?.trim() || request.apiKey?.trim()),
      imageSecretConfigured: Boolean(request.imageApiKey?.trim()) && Boolean(request.imageModel),
      webSearchConfigured: Boolean(request.tavilyApiKey.trim()),
      githubConfigured: Boolean(request.githubToken.trim()),
      textKeyMasked: request.textApiKey || request.apiKey ? "tes••••ret" : null,
      imageKeyMasked: request.imageApiKey ? "tes••••ret" : null,
      tavilyKeyMasked: request.tavilyApiKey ? "tav••••key" : null,
      githubTokenMasked: request.githubToken ? "ghp••••ken" : null,
      persistence: "encrypted_local_database",
    };
    return { ...mockModelConfiguration };
  },
  async modelConfiguration() {
    return mockModelConfiguration ? { ...mockModelConfiguration } : null;
  },
  async revealModelSecret() {
    return null;
  },
  async testModelConnection() {
    await pause(120);
    return {
      provider: "mock",
      model: mockModelConfiguration?.textModel ?? "deterministic-mock-v1",
      mocked: true,
    };
  },
  async githubApplicationInfo() {
    return {
      repository: "tllovesxs/open-publisher",
      authorName: "tllovesxs",
      authorUrl: "https://github.com/tllovesxs",
      installedVersion: "0.1.0",
      latestVersion: null,
      releaseUrl: null,
      releaseNotes: null,
      publishedAt: null,
      updateAvailable: false,
      detail: "浏览器预览不会检查 GitHub 更新。",
    };
  },
  async wechatSyncStatus() {
    return {
      available: false,
      connected: false,
      detail: "浏览器预览不会连接 WechatSync。",
      platforms: [],
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
  planGenerationBatch: (request) =>
    invoke<BatchTopicPlanSummary>("plan_generation_batch", { request }),
  createGenerationBatch: (request) =>
    invoke<GenerationBatchDetail>("create_generation_batch", { request }),
  listGenerationBatches: () =>
    invoke<GenerationBatchDetail[]>("list_generation_batches"),
  getGenerationBatch: (request) =>
    invoke<GenerationBatchDetail>("get_generation_batch", { request }),
  cancelGenerationBatch: (request) =>
    invoke<GenerationBatchDetail>("cancel_generation_batch", { request }),
  retryGenerationItem: (request) =>
    invoke<GenerationBatchDetail>("retry_generation_item", { request }),
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
  rewriteArticle: (request) =>
    invoke<RewriteArticleSummary>("rewrite_article", { request }),
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
  revealModelSecret: (kind) =>
    invoke<string | null>("reveal_model_secret", { kind }),
  testModelConnection: () =>
    invoke<ModelConnectionTestSummary>("test_model_connection"),
  githubApplicationInfo: () =>
    invoke<GitHubApplicationInfo>("github_application_info"),
  wechatSyncStatus: () => invoke<WechatSyncBridgeStatus>("wechat_sync_status"),
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
  planGenerationBatch: desktopHostRequired,
  createGenerationBatch: desktopHostRequired,
  listGenerationBatches: desktopHostRequired,
  getGenerationBatch: desktopHostRequired,
  cancelGenerationBatch: desktopHostRequired,
  retryGenerationItem: desktopHostRequired,
  getWorkflowActivity: desktopHostRequired,
  createPublishPlan: desktopHostRequired,
  getPublishPlan: desktopHostRequired,
  approvePublishPlan: desktopHostRequired,
  enqueuePublishPlan: desktopHostRequired,
  processPublishJob: desktopHostRequired,
  rewriteArticle: desktopHostRequired,
  generateImage: desktopHostRequired,
  extractTemplate: desktopHostRequired,
  listConnectionProfiles: async () => [],
  createConnectionProfile: desktopHostRequired,
  configureModel: desktopHostRequired,
  modelConfiguration: async () => null,
  revealModelSecret: desktopHostRequired,
  testModelConnection: desktopHostRequired,
  githubApplicationInfo: desktopHostRequired,
  wechatSyncStatus: desktopHostRequired,
};

let testBridgeOverride: DesktopBridge | null = null;

/** Test-only injection point. Never call this from application code. */
export function setDesktopBridgeForTests(bridge: DesktopBridge | null) {
  testBridgeOverride = bridge;
}

const activeBridge = () =>
  testBridgeOverride ?? (isTauriHost() ? tauriBridge : browserPreviewBridge);

export async function subscribeToRewriteEvents(
  listener: (event: RewriteStreamEvent) => void,
): Promise<() => void> {
  if (!isTauriHost()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<RewriteStreamEvent>("article-rewrite-stream", (event) => listener(event.payload));
}

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
  planGenerationBatch: (request) => activeBridge().planGenerationBatch(request),
  createGenerationBatch: (request) => activeBridge().createGenerationBatch(request),
  listGenerationBatches: () => activeBridge().listGenerationBatches(),
  getGenerationBatch: (request) => activeBridge().getGenerationBatch(request),
  cancelGenerationBatch: (request) => activeBridge().cancelGenerationBatch(request),
  retryGenerationItem: (request) => activeBridge().retryGenerationItem(request),
  getWorkflowActivity: (articleId) => activeBridge().getWorkflowActivity(articleId),
  createPublishPlan: (request) => activeBridge().createPublishPlan(request),
  getPublishPlan: (request) => activeBridge().getPublishPlan(request),
  approvePublishPlan: (request) => activeBridge().approvePublishPlan(request),
  enqueuePublishPlan: (request) => activeBridge().enqueuePublishPlan(request),
  processPublishJob: (request) => activeBridge().processPublishJob(request),
  rewriteArticle: (request) => activeBridge().rewriteArticle(request),
  generateImage: (request) => activeBridge().generateImage(request),
  extractTemplate: (request) => activeBridge().extractTemplate(request),
  listConnectionProfiles: () => activeBridge().listConnectionProfiles(),
  createConnectionProfile: (request) => activeBridge().createConnectionProfile(request),
  configureModel: (request) => activeBridge().configureModel(request),
  modelConfiguration: () => activeBridge().modelConfiguration(),
  revealModelSecret: (kind) => activeBridge().revealModelSecret(kind),
  testModelConnection: () => activeBridge().testModelConnection(),
  githubApplicationInfo: () => activeBridge().githubApplicationInfo(),
  wechatSyncStatus: () => activeBridge().wechatSyncStatus(),
};
