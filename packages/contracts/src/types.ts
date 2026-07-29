export const CONTRACT_SCHEMA_VERSION = "1.0" as const;

export type ContractSchemaVersion = typeof CONTRACT_SCHEMA_VERSION;
export type Identifier = string;
export type Sha256 = `sha256:${string}`;
export type IsoTimestamp = string;
export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ContractBase {
  schemaVersion: ContractSchemaVersion;
  id: Identifier;
}

export interface Actor {
  kind: "user" | "agent" | "skill" | "system" | "import";
  id: Identifier;
}

export interface ContractError {
  code: Identifier;
  message: string;
  retryable: boolean;
  details?: JsonValue;
}

export interface ArticleRevision extends ContractBase {
  articleId: Identifier;
  revisionNumber: number;
  parentRevisionId?: Identifier | null;
  title: string;
  summary?: string;
  markdown: string;
  frontMatter?: Record<string, JsonValue>;
  contentHash: Sha256;
  status: "draft" | "reviewed" | "approved" | "archived";
  createdAt: IsoTimestamp;
  createdBy: Actor;
}

export interface ArtifactProducer {
  kind: "workflow-node" | "skill" | "user" | "system";
  id: Identifier;
  version: string;
}

export interface Artifact extends ContractBase {
  runId?: Identifier;
  sourceRevisionId?: Identifier;
  artifactType: string;
  mediaType: string;
  uri?: string;
  inlineData?: JsonValue;
  contentHash: Sha256;
  producer: ArtifactProducer;
  metadata?: Record<string, JsonValue>;
  createdAt: IsoTimestamp;
}

export type WorkflowNodeKind =
  | "agent"
  | "skill"
  | "tool"
  | "human"
  | "condition"
  | "fanout"
  | "join";

export interface WorkflowNode {
  id: Identifier;
  kind: WorkflowNodeKind;
  handler: string;
  optional?: boolean;
  concurrencyKey?: string;
  config?: Record<string, JsonValue>;
}

export interface WorkflowEdge {
  from: Identifier;
  to: Identifier;
  when?: string;
  label?: string;
}

export interface WorkflowDefinition extends ContractBase {
  name: string;
  description?: string;
  version: string;
  inputArtifactTypes?: string[];
  outputArtifactTypes?: string[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  entryNodeIds: Identifier[];
  policy: {
    maxParallel: number;
    requiresApprovalBeforePublish: boolean;
    failFast?: boolean;
  };
}

export interface WorkflowSnapshot extends ContractBase {
  definitionId: Identifier;
  definitionVersion: string;
  definitionHash: Sha256;
  definition: WorkflowDefinition;
  inputArtifactIds?: Identifier[];
  createdAt: IsoTimestamp;
}

export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "waiting_for_user"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface WorkflowRun extends ContractBase {
  snapshotId: Identifier;
  status: WorkflowRunStatus;
  inputArtifactIds: Identifier[];
  outputArtifactIds: Identifier[];
  currentNodeIds?: Identifier[];
  createdAt: IsoTimestamp;
  startedAt?: IsoTimestamp;
  completedAt?: IsoTimestamp;
  error?: ContractError;
}

export type ConnectionAuthMethod =
  | "none"
  | "api_key"
  | "oauth"
  | "browser_session"
  | "custom";

export interface ConnectionProfile extends ContractBase {
  providerKind: "platform" | "model" | "image" | "search";
  providerId: Identifier;
  displayName: string;
  endpoint?: string;
  authMethod: ConnectionAuthMethod;
  credentialRef?: `secret://${string}`;
  browserProfileRef?: `browser-profile://${string}`;
  capabilities: Identifier[];
  status: "unknown" | "ready" | "expired" | "needs_user" | "disabled";
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface PlatformVariant extends ContractBase {
  revisionId: Identifier;
  platform: Identifier;
  title: string;
  excerpt?: string;
  body: {
    format: "markdown" | "html" | "plain";
    content: string;
  };
  coverArtifactId?: Identifier;
  inlineArtifactIds?: Identifier[];
  tags: string[];
  platformMetadata?: Record<string, JsonValue>;
  contentHash: Sha256;
  createdAt: IsoTimestamp;
}

export interface PublishTarget {
  id: Identifier;
  platform: Identifier;
  connectionProfileId: Identifier;
  variantId: Identifier;
  accountLabel?: string;
}

export interface PublishPlan extends ContractBase {
  revisionId: Identifier;
  mode: "save_draft" | "publish";
  targets: PublishTarget[];
  scheduleAt?: IsoTimestamp;
  approvedAt?: IsoTimestamp;
  approvedBy?: Actor;
  planHash: Sha256;
  createdAt: IsoTimestamp;
}

export interface PublishAttempt {
  number: number;
  status: "running" | "succeeded" | "failed" | "unknown";
  startedAt: IsoTimestamp;
  completedAt?: IsoTimestamp;
  remoteId?: string;
  error?: ContractError;
}

export interface PublishJob extends ContractBase {
  planId: Identifier;
  targetId: Identifier;
  variantId: Identifier;
  connectionProfileId: Identifier;
  state:
    | "queued"
    | "running"
    | "retry_wait"
    | "needs_user"
    | "succeeded"
    | "failed"
    | "cancelled";
  idempotencyKey: string;
  attempts: PublishAttempt[];
  nextAttemptAt?: IsoTimestamp;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface PublishReceipt extends ContractBase {
  jobId: Identifier;
  platform: Identifier;
  status: "draft_saved" | "published" | "failed" | "unknown";
  remoteId?: string;
  remoteUrl?: string;
  publishedAt?: IsoTimestamp;
  payloadHash: Sha256;
  reconciliation: {
    state: "not_checked" | "matched" | "mismatched" | "not_found" | "unknown";
    checkedAt?: IsoTimestamp;
    details?: JsonValue;
  };
  createdAt: IsoTimestamp;
}

export interface ContentPackageEntry {
  artifactId: Identifier;
  path: string;
  mediaType: string;
  contentHash: Sha256;
  sizeBytes: number;
}

export interface ContentPackageManifest extends ContractBase {
  articleRevisionId: Identifier;
  entries: ContentPackageEntry[];
  platformVariantIds: Identifier[];
  packageHash: Sha256;
  createdAt: IsoTimestamp;
}

export interface SkillPermissions {
  modelAccess: boolean;
  imageGeneration: boolean;
  browserRead: boolean;
  platformWrites: boolean;
  filesystem: "none" | "workspace-read" | "workspace-write";
  networkServices: Identifier[];
}

export interface SkillManifest extends ContractBase {
  name: string;
  version: string;
  description: string;
  license: string;
  runtime: {
    kind: "declarative" | "python" | "typescript" | "external";
    apiVersion: ContractSchemaVersion;
    entrypoint?: string;
  };
  capabilities: Identifier[];
  inputArtifactTypes: string[];
  outputArtifactTypes: string[];
  permissions: SkillPermissions;
  declaration: {
    objective: string;
    instructions: string[];
    guardrails: string[];
  };
  configSchema: Record<string, unknown>;
  source?: {
    kind: "first-party" | "third-party";
    url?: string;
    commit?: string;
    license?: string;
  };
}

export interface PlatformAdapterManifest extends ContractBase {
  platform: Identifier;
  name: string;
  version: string;
  license: string;
  transport: "browser_extension" | "api" | "manual";
  supportedOperations: Array<
    "probe" | "prepare_draft" | "save_draft" | "publish" | "reconcile"
  >;
  requiredAuthMethods: ConnectionAuthMethod[];
  editorUrlPatterns?: string[];
  capabilities: {
    supportsMarkdown: boolean;
    supportsHtml: boolean;
    supportsDrafts: boolean;
    supportsScheduling: boolean;
    maxTitleLength?: number;
    maxTagCount?: number;
  };
  taskSchemaRef?: string;
  permissions: {
    hostPatterns: string[];
    cookieAccess: boolean;
  };
  safeDefaults: {
    defaultMode: "save_draft" | "publish";
    finalPublishRequiresUser: boolean;
    exportsCookies: boolean;
  };
}

export type RunEventType =
  | "run.created"
  | "run.started"
  | "run.waiting_for_user"
  | "run.succeeded"
  | "run.failed"
  | "run.cancelled"
  | "node.started"
  | "node.completed"
  | "node.failed"
  | "artifact.created"
  | "publish.queued"
  | "publish.attempted"
  | "publish.reconciled";

export interface RunEvent extends ContractBase {
  runId: Identifier;
  sequence: number;
  type: RunEventType;
  nodeId?: Identifier;
  actor: Actor;
  payload: JsonValue;
  previousEventHash?: Sha256;
  eventHash: Sha256;
  at: IsoTimestamp;
}
