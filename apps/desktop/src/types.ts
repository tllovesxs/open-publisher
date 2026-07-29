export type NavKey =
  | "workspace"
  | "articles"
  | "workflow"
  | "assets"
  | "publish"
  | "connections"
  | "skills"
  | "tasks";

export type PlatformId = "wechat" | "csdn" | "toutiao";

export type ArticleStatus = "draft" | "review" | "ready";

export interface Article {
  id: string;
  title: string;
  deck: string;
  markdown: string;
  status: ArticleStatus;
  updatedAt: string;
  wordCount: number;
  channels: PlatformId[];
  collection: string;
}

export type WorkflowStageState = "done" | "active" | "pending" | "skipped";

export interface WorkflowStage {
  id: string;
  label: string;
  agent: string;
  state: WorkflowStageState;
  optional?: boolean;
}

export interface EvidenceItem {
  id: string;
  title: string;
  source: string;
  usedAt: string;
  confidence: "高" | "中";
}

export interface RiskItem {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  location: string;
}

export interface PlatformDefinition {
  id: PlatformId;
  name: string;
  shortName: string;
  limit: string;
  status: "connected" | "needs_attention" | "not_connected";
}

export interface TaskRecord {
  id: string;
  title: string;
  platform: PlatformId;
  status: "queued" | "running" | "done" | "blocked";
  scheduledFor: string;
}
