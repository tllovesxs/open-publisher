import type { JsonValue } from "./types.js";

export const CONTRACT_SCHEMA_VERSION_V2 = "2" as const;

export type AgentIdV2 = "writer" | "visual" | "reviewer" | "template" | "topic";
export type AgentRunStatusV2 =
  | "pending"
  | "running"
  | "waiting_user"
  | "stopping"
  | "stopped"
  | "completed"
  | "failed"
  | "interrupted";

export type AgentRunEventTypeV2 =
  | "run.started"
  | "agent.started"
  | "agent.message_delta"
  | "agent.message_completed"
  | "tool.started"
  | "tool.progress"
  | "tool.completed"
  | "tool.failed"
  | "rewrite.candidate_ready"
  | "article.preview_delta"
  | "article.checkpointed"
  | "revision.committed"
  | "run.waiting_user"
  | "run.stopping"
  | "run.stopped"
  | "run.failed"
  | "run.completed";

export interface AgentRunV2 {
  schemaVersion: "2";
  id: string;
  articleId: string | null;
  sessionId: string | null;
  agentId: AgentIdV2;
  operation: string;
  status: AgentRunStatusV2;
  baseRevisionId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: { code: string; message: string; retryable: boolean } | null;
}

export interface AgentRunEventV2 {
  schemaVersion: "2";
  id: string;
  runId: string;
  sequence: number;
  timestamp: string;
  articleId: string | null;
  agentId: AgentIdV2;
  parentAgentId: AgentIdV2 | null;
  operation: string;
  type: AgentRunEventTypeV2;
  payload: JsonValue;
}

export interface ArticleWriteRequestV2 {
  schemaVersion: "2";
  articleId: string;
  baseRevisionId: string | null;
  baseContentHash: string | null;
  title: string;
  markdown: string;
  reason: string;
}

export interface ArticlePatchOperationV2 {
  selectionId: string;
  expectedText: string;
  replacementText: string;
}

export interface ArticlePatchRequestV2 {
  schemaVersion: "2";
  articleId: string;
  baseRevisionId: string;
  baseContentHash: string;
  operations: ArticlePatchOperationV2[];
  reason: string;
}
