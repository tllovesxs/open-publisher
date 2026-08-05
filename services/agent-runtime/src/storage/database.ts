import { join } from "node:path";
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.js";

export interface RuntimeDatabase {
  readonly sqlite: Database;
  readonly orm: BunSQLiteDatabase<typeof schema>;
  close(): void;
}

const MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS runtime_schema_versions (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  article_id TEXT,
  agent_id TEXT NOT NULL,
  summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  article_id TEXT,
  session_id TEXT,
  agent_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  base_revision_id TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS agent_run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(run_id, sequence)
);
CREATE TABLE IF NOT EXISTS tool_executions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  error_json TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS agent_runs_article_id_idx ON agent_runs(article_id);
CREATE INDEX IF NOT EXISTS agent_run_events_run_id_idx ON agent_run_events(run_id, sequence);
`;

const MIGRATION_V2 = `
CREATE TABLE IF NOT EXISTS publish_plans_v2 (
  id TEXT PRIMARY KEY, revision_id TEXT NOT NULL, revision_hash TEXT NOT NULL,
  status TEXT NOT NULL, approval_status TEXT NOT NULL, plan_json TEXT NOT NULL,
  approval_binding_hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS publish_variants_v2 (
  id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, platform TEXT NOT NULL, account_ref TEXT NOT NULL,
  title TEXT NOT NULL, markdown TEXT NOT NULL, content_hash TEXT NOT NULL, target_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS publish_jobs_v2 (
  id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, variant_id TEXT NOT NULL, platform TEXT NOT NULL,
  account_ref TEXT NOT NULL, operation TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
  payload_hash TEXT NOT NULL, payload_json TEXT NOT NULL, state TEXT NOT NULL, remote_id TEXT,
  last_error TEXT, reconcile_required INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS publish_attempts_v2 (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL, attempt_number INTEGER NOT NULL, operation TEXT NOT NULL,
  state TEXT NOT NULL, request_json TEXT NOT NULL, response_json TEXT, error TEXT,
  started_at TEXT NOT NULL, completed_at TEXT, UNIQUE(job_id, attempt_number)
);
CREATE TABLE IF NOT EXISTS publish_receipts_v2 (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL UNIQUE, platform TEXT NOT NULL, status TEXT NOT NULL,
  remote_id TEXT NOT NULL, remote_url TEXT, payload_hash TEXT NOT NULL, details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS publish_jobs_v2_plan_idx ON publish_jobs_v2(plan_id);
CREATE INDEX IF NOT EXISTS publish_attempts_v2_job_idx ON publish_attempts_v2(job_id, attempt_number);
`;

export const openRuntimeDatabase = (dataDirectory: string): RuntimeDatabase => {
  const sqlite = new Database(join(dataDirectory, "open-publisher-v2.sqlite"), {
    create: true,
    strict: true,
  });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.transaction(() => {
    sqlite.exec(MIGRATION_V1);
    sqlite
      .query("INSERT OR IGNORE INTO runtime_schema_versions(version, applied_at) VALUES (?, ?)")
      .run(1, new Date().toISOString());
    sqlite.exec(MIGRATION_V2);
    sqlite
      .query("INSERT OR IGNORE INTO runtime_schema_versions(version, applied_at) VALUES (?, ?)")
      .run(2, new Date().toISOString());

    // A runtime restart cannot safely resume an in-memory Pi invocation or
    // determine whether an external publish request reached its destination.
    const recoveredAt = new Date().toISOString();
    sqlite
      .query(
        `UPDATE agent_runs
         SET status = 'interrupted',
             completed_at = COALESCE(completed_at, ?),
             error_json = ?
         WHERE status IN ('pending', 'running', 'waiting_user', 'stopping')`,
      )
      .run(
        recoveredAt,
        JSON.stringify({
          code: "RUNTIME_RESTARTED",
          message: "The local runtime restarted before this agent run completed.",
          retryable: true,
        }),
      );
    sqlite
      .query(
        `UPDATE publish_attempts_v2
         SET state = 'unknown',
             error = COALESCE(error, 'Local runtime restarted while publishing; reconcile before retry.'),
             completed_at = COALESCE(completed_at, ?)
         WHERE state = 'in_progress'`,
      )
      .run(recoveredAt);
    sqlite
      .query(
        `UPDATE publish_jobs_v2
         SET state = 'unknown',
             reconcile_required = 1,
             last_error = COALESCE(last_error, 'Local runtime restarted while publishing; reconcile before retry.'),
             updated_at = ?
         WHERE state = 'in_progress'`,
      )
      .run(recoveredAt);
    sqlite
      .query(
        `UPDATE publish_plans_v2
         SET status = 'needs_attention', updated_at = ?
         WHERE id IN (SELECT DISTINCT plan_id FROM publish_jobs_v2 WHERE state = 'unknown')`,
      )
      .run(recoveredAt);
  })();

  return {
    sqlite,
    orm: drizzle(sqlite, { schema }),
    close: () => sqlite.close(),
  };
};
