import type { Agent, AgentEvent, AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type {
  AgentRunEventTypeV2,
  AgentRunEventV2,
  AgentRunV2,
  JsonValue,
} from "@open-publisher/contracts";
import type { TextModelProfile } from "./model-profile.js";
import { PiAgentAdapter, type WriterAgentFactory } from "./pi-adapter.js";
import { ModelDeadlineExceededError, runWithModelDeadline } from "./model-deadline.js";
import type { RunJournalPort } from "../runs/run-journal.js";
import type { SecretProvider } from "../security/secret-provider.js";

/**
 * A rewrite is deliberately a candidate, never an ArticleStore mutation. The
 * editor owns selection offsets and writes a revision only after the user
 * explicitly applies the candidate.
 */
export interface RewriteCandidateRequest {
  readonly articleId: string;
  readonly requestId: string;
  readonly markdown: string;
  readonly instruction: string;
  readonly selectedTexts: readonly string[];
  readonly conversation: readonly { role: "user" | "assistant"; text: string }[];
  readonly modelProfile: TextModelProfile;
}

export interface RewriteCandidateSummary {
  readonly replacements: readonly string[];
  readonly summary: string;
  readonly provider: string;
  readonly model: string;
  readonly mocked: false;
}

interface ActiveRewrite {
  agent: Agent | null;
}

const CANDIDATE_PARAMETERS = Type.Object({
  replacements: Type.Array(Type.String({ minLength: 1, maxLength: 2_000_000 }), {
    minItems: 1,
    maxItems: 32,
  }),
  summary: Type.String({ minLength: 1, maxLength: 2_000 }),
});

const isTerminal = (status: AgentRunV2["status"]): boolean =>
  ["completed", "failed", "stopped", "interrupted"].includes(status);

const bounded = (value: string, limit: number): string =>
  Array.from(value).slice(0, limit).join("");

const conversationPrompt = (
  conversation: RewriteCandidateRequest["conversation"],
): string => conversation
  .slice(-16)
  .map((message) => `${message.role === "assistant" ? "编辑" : "用户"}：${bounded(message.text, 8_000)}`)
  .join("\n\n");

export class RewriteService {
  private readonly activeRuns = new Map<string, ActiveRewrite>();
  private readonly listeners = new Map<string, Set<(event: AgentRunEventV2) => void>>();

  constructor(
    private readonly journal: RunJournalPort,
    private readonly secretProvider: SecretProvider,
    private readonly pi: WriterAgentFactory = new PiAgentAdapter(),
  ) {}

  async startRewrite(request: RewriteCandidateRequest): Promise<AgentRunV2> {
    const expectedCount = request.selectedTexts.length || 1;
    if (!request.articleId || !request.requestId || !request.markdown || !request.instruction.trim()) {
      throw new Error("A complete rewrite candidate request is required");
    }
    if (request.selectedTexts.length > 32 || request.selectedTexts.some((text) => !text.trim())) {
      throw new Error("Selected text must contain one to 32 non-empty sections");
    }
    const run = this.journal.createRun({
      articleId: request.articleId,
      sessionId: `rewrite:${request.articleId}:${request.requestId}`,
      agentId: "writer",
      operation: "rewrite_candidate",
      baseRevisionId: null,
    });
    this.activeRuns.set(run.id, { agent: null });
    void this.execute(run, request, expectedCount).catch((error: unknown) => void this.fail(run.id, error));
    return run;
  }

  getRun(runId: string): AgentRunV2 | null { return this.journal.getRun(runId); }
  eventsAfter(runId: string, afterSequence: number): AgentRunEventV2[] {
    return this.journal.eventsAfter(runId, afterSequence);
  }
  subscribe(runId: string, listener: (event: AgentRunEventV2) => void): () => void {
    const listeners = this.listeners.get(runId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(runId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(runId);
    };
  }

  async stop(runId: string): Promise<AgentRunV2> {
    const run = this.journal.getRun(runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    if (isTerminal(run.status)) return run;
    this.journal.transition(runId, "stopping");
    this.emit(runId, "run.stopping", { reason: "user_requested" });
    const active = this.activeRuns.get(runId);
    active?.agent?.abort();
    if (!active?.agent) {
      this.journal.transition(runId, "stopped");
      this.emit(runId, "run.stopped", { reason: "stopped_before_model_start" });
      this.cleanup(runId);
    }
    return this.journal.getRun(runId) ?? run;
  }

  private async execute(
    run: AgentRunV2,
    request: RewriteCandidateRequest,
    expectedCount: number,
  ): Promise<void> {
    const beforeStart = this.journal.getRun(run.id);
    if (!beforeStart || isTerminal(beforeStart.status)) return this.cleanup(run.id);
    if (beforeStart.status === "stopping") {
      this.journal.transition(run.id, "stopped");
      this.emit(run.id, "run.stopped", { reason: "stopped_before_model_start" });
      return this.cleanup(run.id);
    }
    this.journal.transition(run.id, "running");
    this.emit(run.id, "run.started", { modelId: request.modelProfile.modelId });
    this.emit(run.id, "agent.started", { agent: "writer", operation: "rewrite_candidate" });
    const apiKey = await this.secretProvider.resolve(request.modelProfile.secretRef);
    if (!apiKey) throw new Error(`Model secret is unavailable: ${request.modelProfile.secretRef}`);

    let candidate: RewriteCandidateSummary | null = null;
    const submitCandidate: AgentTool<typeof CANDIDATE_PARAMETERS> = {
      name: "submit_rewrite_candidate",
      label: "提交改写建议",
      description: "提交可供用户确认的改写建议，不会修改文章。replacements 必须与目标段落数量完全一致。",
      parameters: CANDIDATE_PARAMETERS,
      executionMode: "sequential",
      execute: async (_toolCallId, parameters, signal) => {
        const current = this.journal.getRun(run.id);
        if (signal?.aborted || !current || current.status !== "running") {
          throw new Error("Article rewrite was stopped");
        }
        if (parameters.replacements.length !== expectedCount) {
          throw new Error(`Expected ${expectedCount} replacements, received ${parameters.replacements.length}`);
        }
        candidate = {
          replacements: parameters.replacements,
          summary: parameters.summary,
          provider: request.modelProfile.providerId,
          model: request.modelProfile.modelId,
          mocked: false,
        };
        this.emit(run.id, "rewrite.candidate_ready", candidate as unknown as JsonValue);
        return {
          content: [{ type: "text", text: "改写建议已生成，等待用户确认后才会写入文章。" }],
          details: { replacementCount: parameters.replacements.length },
          terminate: true,
        };
      },
    };
    const agent = this.pi.createWriterAgent({
      profile: request.modelProfile,
      apiKey,
      systemPrompt: [
        "你是稿流编辑助手。你只能提出修改建议，绝不能声称或尝试保存、发布、修改文章。",
        "保持原文事实、Markdown 结构、链接、图片与代码块，除非用户明确要求修改它们。",
        "完成后必须调用 submit_rewrite_candidate 一次。",
      ].join("\n"),
      sessionId: run.sessionId ?? run.id,
      tools: [submitCandidate],
      onEvent: async (event, signal) => this.handleAgentEvent(run.id, event, signal),
    });
    const active = this.activeRuns.get(run.id);
    if (!active) { agent.abort(); return; }
    active.agent = agent;
    const targets = request.selectedTexts.length ? request.selectedTexts : [request.markdown];
    await runWithModelDeadline(agent, request.modelProfile, "Article rewrite", () => agent.prompt([
      `修改要求：\n${request.instruction.trim()}`,
      request.conversation.length ? `既有对话（仅作上下文）：\n${conversationPrompt(request.conversation)}` : "",
      `完整文章（只用于理解上下文）：\n---\n${bounded(request.markdown, 2_000_000)}\n---`,
      `待替换目标（共 ${targets.length} 段，按顺序逐一给出完整替换文本）：\n${targets.map((text, index) => `目标 ${index + 1}：\n---\n${text}\n---`).join("\n\n")}`,
    ].filter(Boolean).join("\n\n")));
    const latest = this.journal.getRun(run.id);
    if (latest?.status === "stopping" || agent.state.errorMessage === "Aborted") {
      if (latest && !isTerminal(latest.status)) this.journal.transition(run.id, "stopped");
      this.emit(run.id, "run.stopped", { reason: "user_requested" });
    } else if (agent.state.errorMessage) {
      throw new Error(agent.state.errorMessage);
    } else if (!candidate) {
      throw new Error("Writer finished without submitting a rewrite candidate");
    } else if (latest && !isTerminal(latest.status)) {
      this.journal.transition(run.id, "completed");
      this.emit(run.id, "run.completed", { candidateReady: true });
    }
    this.cleanup(run.id);
  }

  private async handleAgentEvent(runId: string, event: AgentEvent, signal: AbortSignal): Promise<void> {
    if (signal.aborted && event.type !== "agent_end") return;
    if (event.type === "message_update") {
      const update = event.assistantMessageEvent;
      if (update.type === "text_delta") this.emit(runId, "agent.message_delta", { text: update.delta });
    } else if (event.type === "message_end" && event.message.role === "assistant") {
      this.emit(runId, "agent.message_completed", { stopReason: event.message.stopReason });
    } else if (event.type === "tool_execution_start") {
      this.emit(runId, "tool.started", { toolCallId: event.toolCallId, toolName: event.toolName });
    } else if (event.type === "tool_execution_update") {
      this.emit(runId, "tool.progress", { toolCallId: event.toolCallId, toolName: event.toolName });
    } else if (event.type === "tool_execution_end") {
      this.emit(runId, event.isError ? "tool.failed" : "tool.completed", {
        toolCallId: event.toolCallId, toolName: event.toolName,
      });
    }
  }

  private async fail(runId: string, error: unknown): Promise<void> {
    const run = this.journal.getRun(runId);
    if (!run || isTerminal(run.status)) return;
    if (run.status === "stopping") {
      this.journal.transition(runId, "stopped");
      this.emit(runId, "run.stopped", { reason: "user_requested" });
    } else {
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof ModelDeadlineExceededError ? error.code : "REWRITE_RUN_FAILED";
      this.journal.transition(runId, "failed", { code, message, retryable: true });
      this.emit(runId, "run.failed", { code, message });
    }
    this.cleanup(runId);
  }

  private emit(runId: string, type: AgentRunEventTypeV2, payload: JsonValue): void {
    const event = this.journal.append(runId, type, payload);
    for (const listener of this.listeners.get(runId) ?? []) listener(event);
  }
  private cleanup(runId: string): void { this.activeRuns.delete(runId); }
}
