import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type {
  AgentRunEventTypeV2,
  AgentRunEventV2,
  AgentRunStatusV2,
  AgentRunV2,
  JsonValue,
} from "@open-publisher/contracts";
import { describe, expect, it } from "vitest";
import type {
  CreateWriterAgentOptions,
  WriterAgentFactory,
} from "../src/agent/pi-adapter.js";
import { WriterService } from "../src/agent/writer-service.js";
import type {
  CreateRunInput,
  RunJournalPort,
} from "../src/runs/run-journal.js";
import type { SecretProvider } from "../src/security/secret-provider.js";
import { ArticleStore } from "../src/storage/article-store.js";

class MemoryRunJournal implements RunJournalPort {
  private readonly runs = new Map<string, AgentRunV2>();
  private readonly events = new Map<string, AgentRunEventV2[]>();

  createRun(input: CreateRunInput): AgentRunV2 {
    const id = `run:${this.runs.size + 1}`;
    const run: AgentRunV2 = {
      schemaVersion: "2",
      id,
      articleId: input.articleId,
      sessionId: input.sessionId,
      agentId: input.agentId,
      operation: input.operation,
      status: "pending",
      baseRevisionId: input.baseRevisionId,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      error: null,
    };
    this.runs.set(id, run);
    return run;
  }

  getRun(runId: string): AgentRunV2 | null {
    return this.runs.get(runId) ?? null;
  }

  transition(
    runId: string,
    status: AgentRunStatusV2,
    error: AgentRunV2["error"] = null,
  ): AgentRunV2 {
    const current = this.getRun(runId);
    if (!current) throw new Error(`Unknown run: ${runId}`);
    const now = new Date().toISOString();
    const next: AgentRunV2 = {
      ...current,
      status,
      startedAt: current.startedAt ?? (status === "running" ? now : null),
      completedAt: ["completed", "failed", "stopped", "interrupted"].includes(status)
        ? now
        : current.completedAt,
      error,
    };
    this.runs.set(runId, next);
    return next;
  }

  append(
    runId: string,
    type: AgentRunEventTypeV2,
    payload: JsonValue,
  ): AgentRunEventV2 {
    const run = this.getRun(runId);
    if (!run) throw new Error(`Unknown run: ${runId}`);
    const entries = this.events.get(runId) ?? [];
    const sequence = entries.length + 1;
    const event: AgentRunEventV2 = {
      schemaVersion: "2",
      id: `event:${sequence}`,
      runId,
      sequence,
      timestamp: new Date().toISOString(),
      articleId: run.articleId,
      agentId: run.agentId,
      parentAgentId: null,
      operation: run.operation,
      type,
      payload,
    };
    entries.push(event);
    this.events.set(runId, entries);
    return event;
  }

  eventsAfter(runId: string, afterSequence: number): AgentRunEventV2[] {
    return (this.events.get(runId) ?? []).filter((event) => event.sequence > afterSequence);
  }
}

class FauxWriterAgentFactory implements WriterAgentFactory {
  createWriterAgent(options: CreateWriterAgentOptions): Agent {
    const faux = fauxProvider({ provider: "faux-writer", tokensPerSecond: 10_000 });
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("write_article", {
          title: "稿流迁移记录",
          markdown: "# 稿流迁移记录\n\nPi Writer 已通过受控工具保存正文。",
          reason: "完成测试文章",
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

const waitForTerminalRun = async (
  journal: RunJournalPort,
  runId: string,
): Promise<AgentRunV2> => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const run = journal.getRun(runId);
    if (run && ["completed", "failed", "stopped"].includes(run.status)) {
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Writer run did not reach a terminal state");
};

describe("WriterService with Pi Agent", () => {
  it("streams a tool-call preview and commits one canonical revision", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-writer-"));
    const articleStore = new ArticleStore(root);
    await articleStore.initialize();
    const journal = new MemoryRunJournal();
    const secrets: SecretProvider = { resolve: async () => "test-key" };
    const writer = new WriterService(
      journal,
      articleStore,
      secrets,
      new FauxWriterAgentFactory(),
    );

    const started = await writer.startCreate({
      articleId: "article:writer-test",
      prompt: "写一篇稿流迁移记录",
      modelProfile: {
        providerId: "test-provider",
        displayName: "Test Provider",
        protocol: "openai-responses",
        baseUrl: "https://example.invalid/v1",
        modelId: "test-model",
        secretRef: "env://TEST_KEY",
        supportsVision: false,
        reasoning: false,
        thinkingLevel: "off",
        contextWindow: 32_768,
        maxTokens: 8_192,
        timeoutSeconds: 120,
      },
    });
    const completed = await waitForTerminalRun(journal, started.id);
    const article = await articleStore.read("article:writer-test");
    const events = writer.eventsAfter(started.id, 0);

    expect(completed.status).toBe("completed");
    expect(article?.markdown).toContain("Pi Writer 已通过受控工具保存正文");
    expect(events.some((event) => event.type === "article.preview_delta")).toBe(true);
    expect(events.some((event) => event.type === "revision.committed")).toBe(true);
    expect(events.at(-1)?.type).toBe("run.completed");
  });
});
