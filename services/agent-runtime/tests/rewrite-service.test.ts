import { Agent } from "@earendil-works/pi-agent-core";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { AgentRunEventTypeV2, AgentRunEventV2, AgentRunStatusV2, AgentRunV2, JsonValue } from "@open-publisher/contracts";
import { describe, expect, it } from "vitest";
import type { CreateWriterAgentOptions, WriterAgentFactory } from "../src/agent/pi-adapter.js";
import { RewriteService } from "../src/agent/rewrite-service.js";
import type { CreateRunInput, RunJournalPort } from "../src/runs/run-journal.js";
import type { SecretProvider } from "../src/security/secret-provider.js";

const profile = {
  providerId: "test-provider",
  displayName: "Test Provider",
  protocol: "openai-responses" as const,
  baseUrl: "https://example.invalid/v1",
  modelId: "test-model",
  secretRef: "env://TEST_KEY",
  supportsVision: false,
  reasoning: false,
  thinkingLevel: "off" as const,
  contextWindow: 32_768,
  maxTokens: 8_192,
  timeoutSeconds: 120,
};

class FauxRewriteAgentFactory implements WriterAgentFactory {
  createWriterAgent(options: CreateWriterAgentOptions): Agent {
    const faux = fauxProvider({ provider: "faux-rewriter", tokensPerSecond: 10_000 });
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("submit_rewrite_candidate", {
          replacements: ["改写后的段落，更清晰也更紧凑。"],
          summary: "按用户要求压缩表达",
        }),
        { stopReason: "toolUse" },
      ),
    ]);
    const models = createModels();
    models.setProvider(faux.provider);
    const agent = new Agent({
      initialState: {
        systemPrompt: options.systemPrompt,
        model: faux.getModel(),
        tools: options.tools,
        messages: [],
        thinkingLevel: "off",
      },
      streamFn: models.streamSimple.bind(models),
      sessionId: options.sessionId,
      toolExecution: "sequential",
    });
    agent.subscribe(options.onEvent);
    return agent;
  }
}

class MemoryRunJournal implements RunJournalPort {
  private readonly runs = new Map<string, AgentRunV2>();
  private readonly events = new Map<string, AgentRunEventV2[]>();

  createRun(input: CreateRunInput): AgentRunV2 {
    const run: AgentRunV2 = {
      schemaVersion: "2", id: `run:${this.runs.size + 1}`, articleId: input.articleId,
      sessionId: input.sessionId, agentId: input.agentId, operation: input.operation,
      status: "pending", baseRevisionId: input.baseRevisionId, createdAt: new Date().toISOString(),
      startedAt: null, completedAt: null, error: null,
    };
    this.runs.set(run.id, run);
    return run;
  }

  getRun(runId: string): AgentRunV2 | null { return this.runs.get(runId) ?? null; }

  transition(runId: string, status: AgentRunStatusV2, error: AgentRunV2["error"] = null): AgentRunV2 {
    const current = this.getRun(runId);
    if (!current) throw new Error(`Unknown run: ${runId}`);
    const now = new Date().toISOString();
    const run: AgentRunV2 = {
      ...current, status, error,
      startedAt: current.startedAt ?? (status === "running" ? now : null),
      completedAt: ["completed", "failed", "stopped", "interrupted"].includes(status) ? now : current.completedAt,
    };
    this.runs.set(runId, run);
    return run;
  }

  append(runId: string, type: AgentRunEventTypeV2, payload: JsonValue): AgentRunEventV2 {
    const run = this.getRun(runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    const events = this.events.get(runId) ?? [];
    const event: AgentRunEventV2 = {
      schemaVersion: "2", id: `event:${events.length + 1}`, runId, sequence: events.length + 1,
      timestamp: new Date().toISOString(), articleId: run.articleId, agentId: run.agentId,
      parentAgentId: null, operation: run.operation, type, payload,
    };
    events.push(event);
    this.events.set(runId, events);
    return event;
  }

  eventsAfter(runId: string, afterSequence: number): AgentRunEventV2[] {
    return (this.events.get(runId) ?? []).filter((event) => event.sequence > afterSequence);
  }
}

const waitForTerminal = async (service: RewriteService, runId: string) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const run = service.getRun(runId);
    if (run && ["completed", "failed", "stopped"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Rewrite run did not reach a terminal state");
};

const createService = (secretProvider: SecretProvider, factory: WriterAgentFactory) =>
  new RewriteService(new MemoryRunJournal(), secretProvider, factory);

describe("RewriteService with Pi Agent", () => {
  it("streams a structured paragraph candidate without mutating an article", async () => {
    const service = createService({ resolve: async () => "test-key" }, new FauxRewriteAgentFactory());
    {
      const run = await service.startRewrite({
        articleId: "article:rewrite",
        requestId: "rewrite:one",
        markdown: "# Rewrite\n\n原始段落，需要改写。\n\n保持不变。",
        instruction: "压缩并提升可读性",
        selectedTexts: ["原始段落，需要改写。"],
        conversation: [],
        modelProfile: profile,
      });
      const completed = await waitForTerminal(service, run.id);
      const events = service.eventsAfter(run.id, 0);

      expect(completed.status).toBe("completed");
      expect(events.find((event) => event.type === "rewrite.candidate_ready")?.payload).toMatchObject({
        replacements: ["改写后的段落，更清晰也更紧凑。"],
        mocked: false,
      });
    }
  });

  it("cancels before model execution without changing the article", async () => {
    let releaseSecret: ((value: string | undefined) => void) | undefined;
    const pendingSecret: SecretProvider = {
      resolve: () => new Promise<string | undefined>((resolve) => { releaseSecret = resolve; }),
    };
    const service = createService(pendingSecret, new FauxRewriteAgentFactory());
    {
      const run = await service.startRewrite({
        articleId: "article:rewrite",
        requestId: "rewrite:stop",
        markdown: "# Rewrite\n\n原始段落，需要改写。\n\n保持不变。",
        instruction: "改写",
        selectedTexts: ["原始段落，需要改写。"],
        conversation: [],
        modelProfile: profile,
      });
      await service.stop(run.id);
      releaseSecret?.(undefined);
      const stopped = await waitForTerminal(service, run.id);

      expect(stopped.status).toBe("stopped");
      expect(service.eventsAfter(run.id, 0).some((event) => event.type === "rewrite.candidate_ready")).toBe(false);
    }
  });
});
