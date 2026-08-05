import { randomUUID } from "node:crypto";
import type {
  AgentIdV2,
  AgentRunEventTypeV2,
  AgentRunEventV2,
  AgentRunStatusV2,
  AgentRunV2,
  JsonValue,
} from "@open-publisher/contracts";
import type { Database } from "bun:sqlite";

export interface CreateRunInput {
  readonly articleId: string | null;
  readonly sessionId: string | null;
  readonly agentId: AgentIdV2;
  readonly operation: string;
  readonly baseRevisionId: string | null;
}

export interface RunJournalPort {
  createRun(input: CreateRunInput): AgentRunV2;
  getRun(runId: string): AgentRunV2 | null;
  transition(
    runId: string,
    status: AgentRunStatusV2,
    error?: AgentRunV2["error"],
  ): AgentRunV2;
  append(
    runId: string,
    type: AgentRunEventTypeV2,
    payload: JsonValue,
    options?: { agentId?: AgentIdV2; parentAgentId?: AgentIdV2 | null },
  ): AgentRunEventV2;
  eventsAfter(runId: string, afterSequence: number): AgentRunEventV2[];
}

interface RunRow {
  id: string;
  article_id: string | null;
  session_id: string | null;
  agent_id: AgentIdV2;
  operation: string;
  status: AgentRunStatusV2;
  base_revision_id: string | null;
  error_json: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface EventRow {
  id: string;
  run_id: string;
  sequence: number;
  event_type: AgentRunEventTypeV2;
  payload_json: string;
  created_at: string;
}

const terminalStatuses = new Set<AgentRunStatusV2>([
  "completed",
  "failed",
  "stopped",
  "interrupted",
]);

const allowedTransitions: Readonly<Record<AgentRunStatusV2, readonly AgentRunStatusV2[]>> = {
  pending: ["running", "waiting_user", "stopping", "failed", "interrupted"],
  running: ["waiting_user", "stopping", "completed", "failed", "interrupted"],
  waiting_user: ["running", "stopping", "failed", "interrupted"],
  stopping: ["stopped", "failed", "interrupted"],
  stopped: [],
  completed: [],
  failed: [],
  interrupted: [],
};

export class RunJournal implements RunJournalPort {
  constructor(private readonly database: Database) {}

  createRun(input: CreateRunInput): AgentRunV2 {
    const id = `run:${randomUUID()}`;
    const createdAt = new Date().toISOString();
    this.database
      .query(
        `INSERT INTO agent_runs(
          id, article_id, session_id, agent_id, operation, status,
          base_revision_id, error_json, created_at, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL, ?, NULL, NULL)`,
      )
      .run(
        id,
        input.articleId,
        input.sessionId,
        input.agentId,
        input.operation,
        input.baseRevisionId,
        createdAt,
      );
    return this.getRunOrThrow(id);
  }

  getRun(runId: string): AgentRunV2 | null {
    const row = this.database.query("SELECT * FROM agent_runs WHERE id = ?").get(runId) as
      | RunRow
      | null;
    return row ? this.mapRun(row) : null;
  }

  transition(
    runId: string,
    status: AgentRunStatusV2,
    error: AgentRunV2["error"] = null,
  ): AgentRunV2 {
    const current = this.getRunOrThrow(runId);
    if (current.status === status) return current;
    if (!allowedTransitions[current.status].includes(status)) {
      throw new Error(`Invalid agent run transition: ${current.status} -> ${status}`);
    }
    const now = new Date().toISOString();
    const startedAt = status === "running" ? now : null;
    const completedAt = terminalStatuses.has(status)
      ? now
      : null;
    this.database
      .query(
        `UPDATE agent_runs SET
          status = ?,
          started_at = COALESCE(started_at, ?),
          completed_at = COALESCE(?, completed_at),
          error_json = ?
        WHERE id = ?`,
      )
      .run(status, startedAt, completedAt, error ? JSON.stringify(error) : null, runId);
    return this.getRunOrThrow(runId);
  }

  append(
    runId: string,
    type: AgentRunEventTypeV2,
    payload: JsonValue,
    options?: { agentId?: AgentIdV2; parentAgentId?: AgentIdV2 | null },
  ): AgentRunEventV2 {
    const run = this.getRunOrThrow(runId);
    return this.database.transaction((): AgentRunEventV2 => {
      const sequenceRow = this.database
        .query("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM agent_run_events WHERE run_id = ?")
        .get(runId) as { sequence?: number } | null;
      const sequence = (sequenceRow?.sequence ?? 0) + 1;
      const timestamp = new Date().toISOString();
      const id = `event:${randomUUID()}`;
      this.database
        .query(
          `INSERT INTO agent_run_events(
            id, run_id, sequence, event_type, payload_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(id, runId, sequence, type, JSON.stringify(payload), timestamp);
      return {
        schemaVersion: "2",
        id,
        runId,
        sequence,
        timestamp,
        articleId: run.articleId,
        agentId: options?.agentId ?? run.agentId,
        parentAgentId: options?.parentAgentId ?? null,
        operation: run.operation,
        type,
        payload,
      };
    })();
  }

  eventsAfter(runId: string, afterSequence: number): AgentRunEventV2[] {
    const run = this.getRunOrThrow(runId);
    const rows = this.database
      .query(
        `SELECT * FROM agent_run_events
         WHERE run_id = ? AND sequence > ? ORDER BY sequence ASC`,
      )
      .all(runId, afterSequence) as EventRow[];
    return rows.map((row) => ({
      schemaVersion: "2",
      id: row.id,
      runId: row.run_id,
      sequence: row.sequence,
      timestamp: row.created_at,
      articleId: run.articleId,
      agentId: run.agentId,
      parentAgentId: null,
      operation: run.operation,
      type: row.event_type,
      payload: JSON.parse(row.payload_json) as JsonValue,
    }));
  }

  private getRunOrThrow(runId: string): AgentRunV2 {
    const run = this.getRun(runId);
    if (!run) {
      throw new Error(`Unknown run: ${runId}`);
    }
    return run;
  }

  private mapRun(row: RunRow): AgentRunV2 {
    return {
      schemaVersion: "2",
      id: row.id,
      articleId: row.article_id,
      sessionId: row.session_id,
      agentId: row.agent_id,
      operation: row.operation,
      status: row.status,
      baseRevisionId: row.base_revision_id,
      createdAt: row.created_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      error: row.error_json ? (JSON.parse(row.error_json) as AgentRunV2["error"]) : null,
    };
  }
}
