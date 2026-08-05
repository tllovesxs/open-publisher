import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const runtimeSchemaVersions = sqliteTable("runtime_schema_versions", {
  version: integer("version").primaryKey(),
  appliedAt: text("applied_at").notNull(),
});

export const agentSessions = sqliteTable("agent_sessions", {
  id: text("id").primaryKey(),
  articleId: text("article_id"),
  agentId: text("agent_id").notNull(),
  summary: text("summary"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const agentRuns = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  articleId: text("article_id"),
  sessionId: text("session_id"),
  agentId: text("agent_id").notNull(),
  operation: text("operation").notNull(),
  status: text("status").notNull(),
  baseRevisionId: text("base_revision_id"),
  errorJson: text("error_json"),
  createdAt: text("created_at").notNull(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
});

export const agentRunEvents = sqliteTable("agent_run_events", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  sequence: integer("sequence").notNull(),
  eventType: text("event_type").notNull(),
  payloadJson: text("payload_json").notNull(),
  createdAt: text("created_at").notNull(),
});

export const toolExecutions = sqliteTable("tool_executions", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  toolName: text("tool_name").notNull(),
  status: text("status").notNull(),
  inputHash: text("input_hash").notNull(),
  errorJson: text("error_json"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
});
