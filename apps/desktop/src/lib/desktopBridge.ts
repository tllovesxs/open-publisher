import { invoke } from "@tauri-apps/api/core";
import type { PromptImageAttachment } from "./imageAttachments";

export type { PromptImageAttachment, PromptImageIntent } from "./imageAttachments";

export type RuntimeState = "standby" | "starting" | "ready" | "stopped" | "faulted";

export interface RuntimeSnapshot {
  state: RuntimeState;
  bridgeMode: "interface_only" | "pi_sidecar";
  generation: number;
  detail: string;
}

export interface PiRuntimeVersion {
  schemaVersion: "2";
  runtimeVersion: string;
  piAgentVersion: string;
  engine: "pi";
  build: string;
}

export type PiRunStatus =
  | "pending"
  | "running"
  | "waiting_user"
  | "stopping"
  | "stopped"
  | "completed"
  | "failed"
  | "interrupted";

export interface PiRunError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface PiAgentRun {
  schemaVersion: "2";
  id: string;
  articleId: string | null;
  sessionId: string | null;
  agentId: "writer" | "visual" | "reviewer" | "template" | "topic";
  operation: string;
  status: PiRunStatus;
  baseRevisionId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: PiRunError | null;
}

export interface PiRunEvent {
  schemaVersion: "2";
  id: string;
  runId: string;
  sequence: number;
  timestamp: string;
  articleId: string | null;
  agentId: PiAgentRun["agentId"];
  parentAgentId: PiAgentRun["agentId"] | null;
  operation: string;
  type:
    | "run.started"
    | "agent.started"
    | "agent.message_delta"
    | "agent.message_completed"
    | "tool.started"
    | "tool.progress"
    | "tool.completed"
    | "tool.failed"
    | "article.preview_delta"
    | "article.checkpointed"
    | "revision.committed"
    | "run.waiting_user"
    | "run.stopping"
    | "run.stopped"
    | "run.failed"
    | "run.completed";
  payload: unknown;
}

export interface PiArticle {
  schemaVersion: "2";
  articleId: string;
  title: string;
  relativePath: "article.md";
  currentRevisionId: string;
  contentHash: string;
  updatedAt: string;
  markdown: string;
}

export interface PiDiscoveredModel {
  id: string;
  name: string | null;
}

export interface PiModelDiscoverySummary {
  models: PiDiscoveredModel[];
  endpoint: string;
}

export interface StartPiArticleRunRequest {
  articleId: string;
  prompt: string;
  images?: PromptImageAttachment[];
  webSearchMode?: WebSearchMode;
  protocol?: "openai-responses" | "openai-completions";
  supportsVision?: boolean;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
}

export interface SaveDraftRequest {
  articleId: string;
  baseRevision: string | null;
  markdown: string;
  reason?: string;
}

export interface ArticleRevisionSummary {
  schemaVersion: "2";
  articleId: string;
  revisionId: string;
  revisionNumber: number;
  parentRevisionId: string | null;
  title: string;
  contentHash: `sha256:${string}`;
  createdAt: string;
  reason: string;
  isCurrent: boolean;
}

export interface ArticleRevisionDetail extends ArticleRevisionSummary {
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

export type WebSearchMode = "off" | "auto" | "required";

export type DisabledOptionalNodeId =
  | "research"
  | "outline"
  | "natural-style"
  | "review"
  | "visual";

/** Nodes the user can configure as part of a workflow instruction. */
export type WorkflowNodeId = DisabledOptionalNodeId | "draft" | "risk";

/**
 * The runtime may also report its internal reference-safety gate in activity
 * events. It is intentionally not configurable from the desktop UI.
 */
export type WorkflowActivityNodeId = WorkflowNodeId | "reference-safety";

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
  /** Asset ids the user explicitly asked to place in the article. */
  requiredAssetIds: string[];
  assetScope: VisualAssetScope;
  preferredType: "infographic" | "scene" | "flowchart" | "comparison" | "framework" | "timeline";
  density: VisualDensity;
  style: string;
  palette: string | null;
  preferredImageBackend: string;
  generationBatchSize: number;
  /** Candidate score (0-100) required before local material is preferred by default. */
  materialMatchThreshold: number;
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

/**
 * Desktop-only aggregation of a completed Pi writer run and its optional
 * visual plan. It is intentionally not a Sidecar endpoint or a legacy
 * workflow contract; App.tsx builds it from canonical Pi revisions.
 */
export interface RunWorkflowSummary {
  runId: string;
  status: "completed";
  workflowName: string;
  workflowVersion: string;
  inputRevisionId: string;
  outputRevisionId: string;
  outputRevisionNumber: number;
  outputMarkdown: string;
  outputContentHash: string;
  artifacts: Array<{ id: string; kind: string }>;
  visualPlan: VisualCompositionPlanSummary | null;
  persistence: "local_database";
}

/** A side-effect-free visual Agent request for an already-open article. */
export interface ComposeVisualRequest {
  /** Scoped cancellation id for this non-run Pi operation. */
  operationId?: string;
  articleId: string;
  markdown: string;
  instruction: string;
  /** Locally retained prompt attachments; never remote image URLs. */
  images?: PromptImageAttachment[];
  visualComposition: VisualCompositionRequest;
}

export interface ComposeVisualSummary {
  plan: VisualCompositionPlanSummary;
  provider: string;
  model: string;
  mocked: boolean;
}

/** Safe, backend-originated lifecycle data for a currently running workflow. */
export interface WorkflowActivityEvent {
  id: string;
  eventType: string;
  nodeId: WorkflowActivityNodeId | null;
  createdAt: string;
  /** Bounded text chunk emitted only by the writing Agent. */
  draftDelta?: string;
  /** Present only when the writer called a reviewed workflow tool. */
  toolName?: "web_search" | "github_repository" | "local_project";
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

export interface ResolveUnknownPublishJobRequest extends ProcessPublishJobRequest {
  resolution: "draft_exists" | "draft_missing";
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
  images?: PromptImageAttachment[];
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
  /** Present from the native start event onward and safe to pass to stopPiRun. */
  runId: string | null;
  eventType: "started" | "status" | "delta";
  detail: string | null;
  delta: string | null;
}

export interface GenerateImageRequest {
  /** Scoped cancellation id for this image request. */
  operationId?: string;
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
  /** Scoped cancellation id for this template extraction. */
  operationId?: string;
  sourceMarkdown: string;
}

export interface TemplateExtractionProgressEvent {
  eventType: "started" | "heartbeat" | "completed" | "failed";
  elapsedSeconds: number;
  detail: string;
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

export interface ConfigureModelRequest {
  profileId?: string | null;
  name: string;
  baseUrl: string;
  textProtocol: "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";
  /** Legacy shared key retained for migration. New settings use independent keys. */
  apiKey?: string;
  textApiKey: string;
  textModel: string;
  textSupportsVision: boolean;
  textReasoning: boolean;
  textThinkingLevel: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  textContextWindow: number;
  textMaxTokens: number;
  nativeWebSearch?: "auto" | "enabled" | "disabled";
  imageBaseUrl: string | null;
  imageModel: string | null;
  imageApiKey: string;
  imageTrustedHosts: string[];
  tavilyApiKey: string;
  githubToken: string;
  timeoutSeconds: number;
}

export interface ModelConfigurationSummary {
  profileId: string;
  name: string;
  baseUrl: string;
  textProtocol: ConfigureModelRequest["textProtocol"];
  textModel: string;
  textSupportsVision: boolean;
  textReasoning: boolean;
  textThinkingLevel: ConfigureModelRequest["textThinkingLevel"];
  textContextWindow: number;
  textMaxTokens: number;
  nativeWebSearch?: "auto" | "enabled" | "disabled";
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

export interface ModelProfileSummary {
  id: string;
  name: string;
  baseUrl: string;
  textProtocol: ConfigureModelRequest["textProtocol"];
  textModel: string;
  textSupportsVision: boolean;
  textReasoning: boolean;
  textThinkingLevel: ConfigureModelRequest["textThinkingLevel"];
  textContextWindow: number;
  textMaxTokens: number;
  nativeWebSearch?: "auto" | "enabled" | "disabled";
  timeoutSeconds: number;
  secretConfigured: boolean;
  textKeyMasked: string | null;
  active: boolean;
}

export type ModelSecretKind = "text" | "image" | "web_search" | "github";

export interface ModelConnectionTestSummary {
  provider: string;
  model: string;
  mocked: boolean;
  latencyMs?: number | null;
  responseText?: string | null;
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
  state: "connected" | "token_required" | "token_rejected" | "extension_waiting" | "service_unreachable" | "bridge_error";
  /** A last-known snapshot retained only while a fresh bridge probe recovers. */
  stale?: boolean;
  detail: string;
  platforms: Array<{
    id: string;
    authenticated: boolean;
    accountLabel: string | null;
  }>;
}

export interface ConfigurePublisherBridgeRequest {
  serverUrl: string;
  token: string;
}

export interface PublisherBridgeConfigurationSummary {
  serverUrl: string;
  tokenConfigured: boolean;
  tokenMasked: string | null;
  persistence: "encrypted_local_database";
}

export interface DesktopBridge {
  piRuntimeSnapshot(): Promise<RuntimeSnapshot>;
  ensurePiRuntime(): Promise<RuntimeSnapshot>;
  stopPiRuntime(): Promise<RuntimeSnapshot>;
  piRuntimeVersion(): Promise<PiRuntimeVersion>;
  discoverPiModels(): Promise<PiModelDiscoverySummary>;
  startPiArticleRun(request: StartPiArticleRunRequest): Promise<PiAgentRun>;
  getPiRun(runId: string): Promise<PiAgentRun>;
  getPiRunEvents(runId: string, afterSequence?: number): Promise<PiRunEvent[]>;
  stopPiRun(runId: string): Promise<PiAgentRun>;
  stopPiOperation(operationId: string): Promise<void>;
  getPiArticle(articleId: string): Promise<PiArticle>;
  listArticles(): Promise<StoredArticleSummary[]>;
  listArticleRevisions(articleId: string): Promise<ArticleRevisionSummary[]>;
  getArticleRevision(articleId: string, revisionId: string): Promise<ArticleRevisionDetail>;
  restoreArticleRevision(articleId: string, revisionId: string): Promise<ArticleRevisionDetail>;
  saveDraft(request: SaveDraftRequest): Promise<SaveDraftReceipt>;
  createPublishPlan(request: CreatePublishPlanRequest): Promise<PublishPlanSummary>;
  getPublishPlan(request: PublishPlanRequest): Promise<PublishPlanSummary>;
  approvePublishPlan(request: PublishPlanRequest): Promise<PublishPlanSummary>;
  enqueuePublishPlan(request: PublishPlanRequest): Promise<PublishPlanSummary>;
  processPublishJob(request: ProcessPublishJobRequest): Promise<ProcessPublishJobSummary>;
  reconcilePublishJob(request: ProcessPublishJobRequest): Promise<ProcessPublishJobSummary>;
  resolveUnknownPublishJob(request: ResolveUnknownPublishJobRequest): Promise<ProcessPublishJobSummary>;
  rewriteArticle(request: RewriteArticleRequest): Promise<RewriteArticleSummary>;
  composeVisual(request: ComposeVisualRequest): Promise<ComposeVisualSummary>;
  generateImage(request: GenerateImageRequest): Promise<GenerateImageSummary>;
  extractTemplate(request: ExtractTemplateRequest): Promise<TemplateExtractionSummary>;
  configureModel(request: ConfigureModelRequest): Promise<ModelConfigurationSummary>;
  modelConfiguration(): Promise<ModelConfigurationSummary | null>;
  listModelProfiles(): Promise<ModelProfileSummary[]>;
  activateModelProfile(profileId: string): Promise<ModelConfigurationSummary>;
  revealModelSecret(kind: ModelSecretKind): Promise<string | null>;
  testModelConnection(): Promise<ModelConnectionTestSummary>;
  githubApplicationInfo(): Promise<GitHubApplicationInfo>;
  publisherBridgeConfiguration(): Promise<PublisherBridgeConfigurationSummary>;
  configurePublisherBridge(request: ConfigurePublisherBridgeRequest): Promise<PublisherBridgeConfigurationSummary>;
  revealPublisherBridgeToken(): Promise<string | null>;
  wechatSyncStatus(request?: { forceRefresh?: boolean }): Promise<WechatSyncBridgeStatus>;
}

const isTauriHost = () => typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

let mockSequence = 0;

interface MockArticleState {
  revisionId: string;
  markdown: string;
  revisionNumber: number;
  updatedAt: string;
}

const mockArticles = new Map<string, MockArticleState>();
const mockArticleRevisions = new Map<string, ArticleRevisionDetail[]>();
const mockPublishPlans = new Map<string, PublishPlanSummary>();
const mockPublishReceipts = new Map<string, PublishReceiptSummary>();
let mockModelConfiguration: ModelConfigurationSummary | null = null;
let mockPublisherBridgeConfiguration: PublisherBridgeConfigurationSummary = {
  serverUrl: "ws://localhost:9527",
  tokenConfigured: false,
  tokenMasked: null,
  persistence: "encrypted_local_database",
};
const mockModelProfiles = new Map<string, ModelProfileSummary>();

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
  if (!normalized) {
    throw new Error("待提取的 Markdown 不能为空。");
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
  composition: VisualCompositionRequest,
  outputMarkdown: string,
): VisualCompositionPlanSummary | null => {
  if (composition.mode === "none") return null;
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
  async piRuntimeSnapshot() {
    return {
      state: "standby",
      bridgeMode: "interface_only",
      generation: 0,
      detail: "单元测试默认不启用 Pi Runtime。",
    };
  },
  async ensurePiRuntime() {
    throw new Error("单元测试未配置 Pi Runtime。");
  },
  async stopPiRuntime() {
    return {
      state: "stopped",
      bridgeMode: "interface_only",
      generation: 0,
      detail: "单元测试 Pi Runtime 已停止。",
    };
  },
  async piRuntimeVersion() {
    throw new Error("单元测试未配置 Pi Runtime。");
  },
  async discoverPiModels() {
    return {
      models: mockModelConfiguration
        ? [{ id: mockModelConfiguration.textModel, name: mockModelConfiguration.textModel }]
        : [],
      endpoint: mockModelConfiguration?.baseUrl ?? "",
    };
  },
  async startPiArticleRun() {
    throw new Error("单元测试未配置 Pi Writer。");
  },
  async getPiRun() {
    throw new Error("单元测试未配置 Pi Writer。");
  },
  async getPiRunEvents() {
    return [];
  },
  async stopPiRun() {
    throw new Error("单元测试未配置 Pi Writer。");
  },
  async stopPiOperation() {
    return undefined;
  },
  async getPiArticle() {
    throw new Error("单元测试未配置 Pi ArticleStore。");
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
  async listArticleRevisions(articleId) {
    await pause(25);
    const current = mockArticles.get(articleId);
    return (mockArticleRevisions.get(articleId) ?? []).map(({ markdown: _markdown, ...revision }) => ({
      ...revision,
      isCurrent: revision.revisionId === current?.revisionId,
    }));
  },
  async getArticleRevision(articleId, revisionId) {
    await pause(20);
    const revision = (mockArticleRevisions.get(articleId) ?? []).find(
      (candidate) => candidate.revisionId === revisionId,
    );
    if (!revision) throw new Error("文章修订不存在");
    return { ...revision, isCurrent: mockArticles.get(articleId)?.revisionId === revisionId };
  },
  async restoreArticleRevision(articleId, revisionId) {
    const target = await this.getArticleRevision(articleId, revisionId);
    const current = mockArticles.get(articleId);
    if (!current) throw new Error("文章不存在");
    const restoredRevisionId = nextMockId(`${articleId}-restore`);
    const createdAt = new Date().toISOString();
    const revisionNumber = current.revisionNumber + 1;
    const restored: ArticleRevisionDetail = {
      ...target,
      revisionId: restoredRevisionId,
      revisionNumber,
      parentRevisionId: current.revisionId,
      contentHash: `sha256:${mockHash(target.markdown)}`,
      createdAt,
      reason: `restore:${revisionId}`,
      isCurrent: true,
    };
    mockArticles.set(articleId, {
      revisionId: restoredRevisionId,
      markdown: target.markdown,
      revisionNumber,
      updatedAt: createdAt,
    });
    mockArticleRevisions.set(articleId, [
      restored,
      ...(mockArticleRevisions.get(articleId) ?? []).map((revision) => ({
        ...revision,
        isCurrent: false,
      })),
    ]);
    return restored;
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
    const updatedAt = new Date().toISOString();
    const revisionNumber = (current?.revisionNumber ?? 0) + 1;
    mockArticles.set(request.articleId, {
      revisionId,
      markdown: request.markdown,
      revisionNumber,
      updatedAt,
    });
    const heading = request.markdown.split("\n").find((line) => line.trim().startsWith("# "));
    const revision: ArticleRevisionDetail = {
      schemaVersion: "2",
      articleId: request.articleId,
      revisionId,
      revisionNumber,
      parentRevisionId: current?.revisionId ?? null,
      title: heading?.replace(/^\s*#\s+/, "").trim() || "未命名文章",
      contentHash: `sha256:${mockHash(request.markdown)}`,
      createdAt: updatedAt,
      reason: request.reason ?? "editor-save",
      isCurrent: true,
      markdown: request.markdown,
    };
    mockArticleRevisions.set(request.articleId, [
      revision,
      ...(mockArticleRevisions.get(request.articleId) ?? []).map((candidate) => ({
        ...candidate,
        isCurrent: false,
      })),
    ]);
    return {
      revisionId,
      savedAtEpochMs: Date.now(),
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
  async reconcilePublishJob(request) {
    await pause(80);
    const plan = [...mockPublishPlans.values()].find((candidate) =>
      candidate.jobs.some((job) => job.id === request.jobId),
    );
    const job = plan?.jobs.find((candidate) => candidate.id === request.jobId);
    if (!plan || !job) throw new Error(`publish job ${request.jobId} not found`);
    if (job.state !== "unknown") throw new Error("only UNKNOWN publish jobs can be reconciled");
    job.lastError = "当前通道不支持草稿查询。请在平台草稿箱确认；系统不会自动重试。";
    job.reconcileRequired = true;
    job.updatedAt = new Date().toISOString();
    plan.status = "needs_attention";
    plan.updatedAt = job.updatedAt;
    return { job: { ...job }, receipt: null };
  },
  async resolveUnknownPublishJob(request) {
    await pause(80);
    const plan = [...mockPublishPlans.values()].find((candidate) =>
      candidate.jobs.some((job) => job.id === request.jobId),
    );
    const job = plan?.jobs.find((candidate) => candidate.id === request.jobId);
    if (!plan || !job) throw new Error(`publish job ${request.jobId} not found`);
    if (job.state !== "unknown") throw new Error("only UNKNOWN publish jobs can be resolved");
    job.updatedAt = new Date().toISOString();
    job.reconcileRequired = false;
    if (request.resolution === "draft_exists") {
      job.state = "succeeded";
      job.remoteId = `manual-confirmed-${job.id.slice(-8)}`;
      job.lastError = null;
      const receipt = {
        id: `${job.id}-manual-receipt`,
        jobId: job.id,
        status: "draft_saved",
        remoteId: job.remoteId,
        contentHash: job.payloadHash,
        createdAt: job.updatedAt,
      };
      mockPublishReceipts.set(job.id, receipt);
      plan.status = plan.jobs.every((candidate) => candidate.state === "succeeded")
        ? "completed"
        : "queued";
      plan.updatedAt = job.updatedAt;
      return { job: { ...job }, receipt: { ...receipt } };
    }
    job.state = "pending";
    job.remoteId = null;
    job.lastError = "用户已确认平台草稿未创建；可手动再次执行发布。";
    plan.status = "queued";
    plan.updatedAt = job.updatedAt;
    return { job: { ...job }, receipt: null };
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
  async composeVisual(request) {
    await pause(120);
    const plan = mockVisualPlanFor(request.visualComposition, request.markdown);
    if (!plan) {
      throw new Error("请先选择自动配图或指定配图数量。");
    }
    return {
      plan,
      provider: "mock",
      model: mockModelConfiguration?.textModel ?? "deterministic-mock-v1",
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
  async configureModel(request) {
    await pause(80);
    mockModelConfiguration = {
      profileId: request.profileId || "default",
      name: request.name.trim(),
      baseUrl: request.baseUrl.trim().replace(/\/+$/, ""),
      textProtocol: request.textProtocol,
      textModel: request.textModel.trim(),
      textSupportsVision: request.textSupportsVision,
      textReasoning: request.textReasoning,
      textThinkingLevel: request.textThinkingLevel,
      textContextWindow: request.textContextWindow,
      textMaxTokens: request.textMaxTokens,
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
    mockModelProfiles.set(mockModelConfiguration.profileId, {
      id: mockModelConfiguration.profileId,
      name: mockModelConfiguration.name,
      baseUrl: mockModelConfiguration.baseUrl,
      textProtocol: mockModelConfiguration.textProtocol,
      textModel: mockModelConfiguration.textModel,
      textSupportsVision: mockModelConfiguration.textSupportsVision,
      textReasoning: mockModelConfiguration.textReasoning,
      textThinkingLevel: mockModelConfiguration.textThinkingLevel,
      textContextWindow: mockModelConfiguration.textContextWindow,
      textMaxTokens: mockModelConfiguration.textMaxTokens,
      timeoutSeconds: mockModelConfiguration.timeoutSeconds,
      secretConfigured: mockModelConfiguration.secretConfigured,
      textKeyMasked: mockModelConfiguration.textKeyMasked,
      active: true,
    });
    return { ...mockModelConfiguration };
  },
  async modelConfiguration() {
    return mockModelConfiguration ? { ...mockModelConfiguration } : null;
  },
  async listModelProfiles() {
    return [...mockModelProfiles.values()].map((profile) => ({ ...profile }));
  },
  async activateModelProfile(profileId) {
    const profile = mockModelProfiles.get(profileId);
    if (!profile) throw new Error("模型档案不存在");
    if (!mockModelConfiguration) throw new Error("没有可用的活动配置");
    mockModelConfiguration = {
      ...mockModelConfiguration,
      profileId: profile.id,
      name: profile.name,
      baseUrl: profile.baseUrl,
      textProtocol: profile.textProtocol,
      textModel: profile.textModel,
      textSupportsVision: profile.textSupportsVision,
      textReasoning: profile.textReasoning,
      textThinkingLevel: profile.textThinkingLevel,
      textContextWindow: profile.textContextWindow,
      textMaxTokens: profile.textMaxTokens,
      timeoutSeconds: profile.timeoutSeconds,
    };
    for (const [id, value] of mockModelProfiles) mockModelProfiles.set(id, { ...value, active: id === profile.id });
    return { ...mockModelConfiguration };
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
  async publisherBridgeConfiguration() {
    return { ...mockPublisherBridgeConfiguration };
  },
  async configurePublisherBridge(request) {
    mockPublisherBridgeConfiguration = {
      serverUrl: request.serverUrl,
      tokenConfigured: Boolean(request.token.trim()) || mockPublisherBridgeConfiguration.tokenConfigured,
      tokenMasked: request.token.trim() ? "****" : mockPublisherBridgeConfiguration.tokenMasked,
      persistence: "encrypted_local_database",
    };
    return { ...mockPublisherBridgeConfiguration };
  },
  async revealPublisherBridgeToken() {
    return null;
  },
  async wechatSyncStatus() {
    return {
      available: false,
      connected: false,
      state: "service_unreachable",
      detail: "浏览器预览不会连接 WechatSync。",
      platforms: [],
    };
  },
};

const tauriBridge: DesktopBridge = {
  piRuntimeSnapshot: () => invoke<RuntimeSnapshot>("pi_runtime_snapshot"),
  ensurePiRuntime: () => invoke<RuntimeSnapshot>("ensure_pi_runtime"),
  stopPiRuntime: () => invoke<RuntimeSnapshot>("stop_pi_runtime"),
  piRuntimeVersion: () => invoke<PiRuntimeVersion>("pi_runtime_version"),
  discoverPiModels: () => invoke<PiModelDiscoverySummary>("discover_pi_models"),
  startPiArticleRun: (request) =>
    invoke<PiAgentRun>("start_pi_article_run", { request }),
  getPiRun: (runId) => invoke<PiAgentRun>("get_pi_run", { runId }),
  getPiRunEvents: (runId, afterSequence = 0) =>
    invoke<PiRunEvent[]>("pi_run_events", { runId, afterSequence }),
  stopPiRun: (runId) => invoke<PiAgentRun>("stop_pi_run", { runId }),
  stopPiOperation: (operationId) => invoke<void>("stop_pi_operation", { operationId }),
  getPiArticle: (articleId) => invoke<PiArticle>("get_pi_article", { articleId }),
  listArticles: () => invoke<StoredArticleSummary[]>("list_articles"),
  listArticleRevisions: (articleId) =>
    invoke<ArticleRevisionSummary[]>("list_article_revisions", { articleId }),
  getArticleRevision: (articleId, revisionId) =>
    invoke<ArticleRevisionDetail>("get_article_revision", { articleId, revisionId }),
  restoreArticleRevision: (articleId, revisionId) =>
    invoke<ArticleRevisionDetail>("restore_article_revision", { articleId, revisionId }),
  saveDraft: (request) => invoke<SaveDraftReceipt>("save_draft", { request }),
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
  reconcilePublishJob: (request) =>
    invoke<ProcessPublishJobSummary>("reconcile_publish_job", { request }),
  resolveUnknownPublishJob: (request) =>
    invoke<ProcessPublishJobSummary>("resolve_unknown_publish_job", { request }),
  rewriteArticle: (request) =>
    invoke<RewriteArticleSummary>("rewrite_article", { request }),
  composeVisual: (request) =>
    invoke<ComposeVisualSummary>("compose_visual", { request }),
  generateImage: (request) =>
    invoke<GenerateImageSummary>("generate_image", { request }),
  extractTemplate: (request) =>
    invoke<TemplateExtractionSummary>("extract_template", { request }),
  configureModel: (request) =>
    invoke<ModelConfigurationSummary>("configure_model", { request }),
  modelConfiguration: () =>
    invoke<ModelConfigurationSummary | null>("model_configuration"),
  listModelProfiles: () => invoke<ModelProfileSummary[]>("list_model_profiles"),
  activateModelProfile: (profileId) =>
    invoke<ModelConfigurationSummary>("activate_model_profile", { profileId }),
  revealModelSecret: (kind) =>
    invoke<string | null>("reveal_model_secret", { kind }),
  testModelConnection: () =>
    invoke<ModelConnectionTestSummary>("test_model_connection"),
  githubApplicationInfo: () =>
    invoke<GitHubApplicationInfo>("github_application_info"),
  publisherBridgeConfiguration: () =>
    invoke<PublisherBridgeConfigurationSummary>("publisher_bridge_configuration"),
  configurePublisherBridge: (request) =>
    invoke<PublisherBridgeConfigurationSummary>("configure_publisher_bridge", { request }),
  revealPublisherBridgeToken: () =>
    invoke<string | null>("reveal_publisher_bridge_token"),
  wechatSyncStatus: (request) => invoke<WechatSyncBridgeStatus>("wechat_sync_status", {
    forceRefresh: request?.forceRefresh ?? false,
  }),
};

const DESKTOP_HOST_REQUIRED =
  "浏览器预览不能调用本地 Agent。请在 Open Publisher 桌面应用中执行此操作。";

const desktopHostRequired = (): Promise<never> =>
  Promise.reject(new Error(DESKTOP_HOST_REQUIRED));

/** Browser previews are read-only and deliberately cannot simulate execution. */
const browserPreviewBridge: DesktopBridge = {
  piRuntimeSnapshot: async () => ({
    state: "standby",
    bridgeMode: "interface_only",
    generation: 0,
    detail: "浏览器预览不能调用 Pi Agent Runtime。",
  }),
  ensurePiRuntime: desktopHostRequired,
  stopPiRuntime: desktopHostRequired,
  piRuntimeVersion: desktopHostRequired,
  discoverPiModels: desktopHostRequired,
  startPiArticleRun: desktopHostRequired,
  getPiRun: desktopHostRequired,
  getPiRunEvents: desktopHostRequired,
  stopPiRun: desktopHostRequired,
  stopPiOperation: desktopHostRequired,
  getPiArticle: desktopHostRequired,
  listArticles: async () => [],
  listArticleRevisions: desktopHostRequired,
  getArticleRevision: desktopHostRequired,
  restoreArticleRevision: desktopHostRequired,
  saveDraft: desktopHostRequired,
  createPublishPlan: desktopHostRequired,
  getPublishPlan: desktopHostRequired,
  approvePublishPlan: desktopHostRequired,
  enqueuePublishPlan: desktopHostRequired,
  processPublishJob: desktopHostRequired,
  reconcilePublishJob: desktopHostRequired,
  resolveUnknownPublishJob: desktopHostRequired,
  rewriteArticle: desktopHostRequired,
  composeVisual: desktopHostRequired,
  generateImage: desktopHostRequired,
  extractTemplate: desktopHostRequired,
  configureModel: desktopHostRequired,
  modelConfiguration: async () => null,
  listModelProfiles: async () => [],
  activateModelProfile: desktopHostRequired,
  revealModelSecret: desktopHostRequired,
  testModelConnection: desktopHostRequired,
  githubApplicationInfo: desktopHostRequired,
  publisherBridgeConfiguration: async () => ({
    serverUrl: "ws://localhost:9527",
    tokenConfigured: false,
    tokenMasked: null,
    persistence: "encrypted_local_database",
  }),
  configurePublisherBridge: desktopHostRequired,
  revealPublisherBridgeToken: desktopHostRequired,
  wechatSyncStatus: desktopHostRequired,
};

let testBridgeOverride: DesktopBridge | null = null;

/** Test-only injection point. Never call this from application code. */
export function setDesktopBridgeForTests(bridge: DesktopBridge | null) {
  testBridgeOverride = bridge;
}

const activeBridge = () =>
  testBridgeOverride ?? (isTauriHost() ? tauriBridge : browserPreviewBridge);

/** Synchronizes the app's persisted theme with the native window frame. */
export async function syncNativeWindowTheme(theme: "light" | "dark"): Promise<void> {
  if (!isTauriHost()) return;
  await invoke<void>("sync_window_theme", { theme });
}

export async function subscribeToRewriteEvents(
  listener: (event: RewriteStreamEvent) => void,
): Promise<() => void> {
  if (!isTauriHost()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<RewriteStreamEvent>("article-rewrite-stream", (event) => listener(event.payload));
}

export async function subscribeToTemplateExtractionEvents(
  listener: (event: TemplateExtractionProgressEvent) => void,
): Promise<() => void> {
  if (!isTauriHost()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<TemplateExtractionProgressEvent>("template-extraction-progress", (event) =>
    listener(event.payload),
  );
}

/**
 * React only sees this narrow Rust command surface. It receives neither a Python
 * endpoint nor plaintext provider/platform credentials.
 */
export const desktopBridge: DesktopBridge = {
  piRuntimeSnapshot: () => activeBridge().piRuntimeSnapshot(),
  ensurePiRuntime: () => activeBridge().ensurePiRuntime(),
  stopPiRuntime: () => activeBridge().stopPiRuntime(),
  piRuntimeVersion: () => activeBridge().piRuntimeVersion(),
  discoverPiModels: () => activeBridge().discoverPiModels(),
  startPiArticleRun: (request) => activeBridge().startPiArticleRun(request),
  getPiRun: (runId) => activeBridge().getPiRun(runId),
  getPiRunEvents: (runId, afterSequence) =>
    activeBridge().getPiRunEvents(runId, afterSequence),
  stopPiRun: (runId) => activeBridge().stopPiRun(runId),
  stopPiOperation: (operationId) => activeBridge().stopPiOperation(operationId),
  getPiArticle: (articleId) => activeBridge().getPiArticle(articleId),
  listArticles: () => activeBridge().listArticles(),
  listArticleRevisions: (articleId) => activeBridge().listArticleRevisions(articleId),
  getArticleRevision: (articleId, revisionId) =>
    activeBridge().getArticleRevision(articleId, revisionId),
  restoreArticleRevision: (articleId, revisionId) =>
    activeBridge().restoreArticleRevision(articleId, revisionId),
  saveDraft: (request) => activeBridge().saveDraft(request),
  createPublishPlan: (request) => activeBridge().createPublishPlan(request),
  getPublishPlan: (request) => activeBridge().getPublishPlan(request),
  approvePublishPlan: (request) => activeBridge().approvePublishPlan(request),
  enqueuePublishPlan: (request) => activeBridge().enqueuePublishPlan(request),
  processPublishJob: (request) => activeBridge().processPublishJob(request),
  reconcilePublishJob: (request) => activeBridge().reconcilePublishJob(request),
  resolveUnknownPublishJob: (request) => activeBridge().resolveUnknownPublishJob(request),
  rewriteArticle: (request) => activeBridge().rewriteArticle(request),
  composeVisual: (request) => activeBridge().composeVisual(request),
  generateImage: (request) => activeBridge().generateImage(request),
  extractTemplate: (request) => activeBridge().extractTemplate(request),
  configureModel: (request) => activeBridge().configureModel(request),
  modelConfiguration: () => activeBridge().modelConfiguration(),
  listModelProfiles: () => activeBridge().listModelProfiles(),
  activateModelProfile: (profileId) => activeBridge().activateModelProfile(profileId),
  revealModelSecret: (kind) => activeBridge().revealModelSecret(kind),
  testModelConnection: () => activeBridge().testModelConnection(),
  githubApplicationInfo: () => activeBridge().githubApplicationInfo(),
  publisherBridgeConfiguration: () => activeBridge().publisherBridgeConfiguration(),
  configurePublisherBridge: (request) => activeBridge().configurePublisherBridge(request),
  revealPublisherBridgeToken: () => activeBridge().revealPublisherBridgeToken(),
  wechatSyncStatus: (request) => activeBridge().wechatSyncStatus(request),
};
