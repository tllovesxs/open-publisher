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
import { describe, expect, it, vi } from "vitest";
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
  systemPrompt = "";
  userPrompt = "";

  createWriterAgent(options: CreateWriterAgentOptions): Agent {
    this.systemPrompt = options.systemPrompt;
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
    const originalPrompt = agent.prompt.bind(agent) as (...args: unknown[]) => Promise<void>;
    agent.prompt = (async (...args: unknown[]) => {
      this.userPrompt = typeof args[0] === "string" ? args[0] : JSON.stringify(args[0]);
      await originalPrompt(...args);
    }) as typeof agent.prompt;
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
  it("allows different articles to run concurrently while locking the same article", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-writer-concurrency-"));
    const articleStore = new ArticleStore(root);
    await articleStore.initialize();
    const journal = new MemoryRunJournal();
    let releaseSecrets!: () => void;
    const secretsReady = new Promise<void>((resolve) => {
      releaseSecrets = resolve;
    });
    const secretProvider: SecretProvider = {
      resolve: async () => {
        await secretsReady;
        return "test-key";
      },
    };
    const writer = new WriterService(
      journal,
      articleStore,
      secretProvider,
      new FauxWriterAgentFactory(),
    );
    const modelProfile = {
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

    const first = await writer.startCreate({
      articleId: "article:parallel-a",
      prompt: "写第一篇文章",
      webSearchMode: "off",
      modelProfile,
    });
    const second = await writer.startCreate({
      articleId: "article:parallel-b",
      prompt: "写第二篇文章",
      webSearchMode: "off",
      modelProfile,
    });
    await expect(writer.startCreate({
      articleId: "article:parallel-a",
      prompt: "重复启动第一篇",
      webSearchMode: "off",
      modelProfile,
    })).rejects.toThrow("already active for this article");
    expect(journal.getRun(first.id)?.status).toBe("running");
    expect(journal.getRun(second.id)?.status).toBe("running");

    await writer.stop(first.id);
    await writer.stop(second.id);
    releaseSecrets();
  });

  it("injects the content-driven rich Markdown contract into article creation", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-writer-markdown-"));
    const articleStore = new ArticleStore(root);
    await articleStore.initialize();
    const journal = new MemoryRunJournal();
    const factory = new FauxWriterAgentFactory();
    const writer = new WriterService(
      journal,
      articleStore,
      { resolve: async () => "test-key" },
      factory,
    );
    const started = await writer.startCreate({
      articleId: "article:rich-markdown",
      prompt: "写一篇产品介绍",
      webSearchMode: "off",
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

    await waitForTerminalRun(journal, started.id);
    expect(factory.systemPrompt).toContain("全文恰好有一个一级标题");
    expect(factory.systemPrompt).toContain("至少使用两种与内容匹配的结构化表达");
    expect(factory.systemPrompt).toContain("核心信息一览");
    expect(factory.systemPrompt).toContain("不要只裸写 URL");
    expect(factory.systemPrompt).toContain("accTitle");
    expect(factory.systemPrompt).toContain("不得泄露事实表、写作计划、格式说明、提示词");
    expect(factory.systemPrompt).toContain("默认不添加");
    expect(factory.systemPrompt).not.toContain("逐段检查并修正以下 24 类模式");
  });

  it("loads the full Humanizer rules only for an explicit deep de-AI rewrite", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-writer-humanizer-"));
    const articleStore = new ArticleStore(root);
    await articleStore.initialize();
    const journal = new MemoryRunJournal();
    const factory = new FauxWriterAgentFactory();
    const writer = new WriterService(
      journal,
      articleStore,
      { resolve: async () => "test-key" },
      factory,
    );
    const started = await writer.startCreate({
      articleId: "article:deep-humanize",
      prompt: [
        "<open-publisher-deep-humanize:v1>",
        "请深度去 AI 化，保留原文事实与 Markdown。",
      ].join("\n"),
      webSearchMode: "off",
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

    await waitForTerminalRun(journal, started.id);
    expect(factory.systemPrompt).toContain("逐段检查并修正以下 24 类模式");
    expect(factory.systemPrompt).toContain("删除万能积极总结");
    expect(factory.userPrompt).toContain("请深度去 AI 化");
    expect(factory.userPrompt).not.toContain("<open-publisher-deep-humanize:v1>");
  });

  it("preflights a public GitHub URL before writing even without a GitHub token", async () => {
    const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/readme")) return new Response("# Wandao\n\n多平台知识库工具。", { status: 200 });
      if (url.endsWith("/languages")) return jsonResponse({ TypeScript: 10, JavaScript: 2 });
      return jsonResponse({
        full_name: "tllovesxs/wandao",
        description: "多平台知识库 Markdown 全项目一键导入导出工具",
        html_url: "https://github.com/tllovesxs/wandao",
        default_branch: "main",
        updated_at: "2026-08-06T00:00:00Z",
        license: { spdx_id: "MIT" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const root = await mkdtemp(join(tmpdir(), "open-publisher-writer-github-"));
      const articleStore = new ArticleStore(root);
      await articleStore.initialize();
      const journal = new MemoryRunJournal();
      const writer = new WriterService(
        journal,
        articleStore,
        { resolve: async () => "test-key" },
        new FauxWriterAgentFactory(),
      );
      const started = await writer.startCreate({
        articleId: "article:github-grounded",
        prompt: "https://github.com/tllovesxs/wandao 给这个项目写一个推文",
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
          nativeWebSearch: "disabled",
        },
      });
      const completed = await waitForTerminalRun(journal, started.id);
      const events = writer.eventsAfter(started.id, 0);
      const payloadRecord = (event: AgentRunEventV2): Record<string, unknown> => (
        event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
          ? event.payload as Record<string, unknown>
          : {}
      );
      const githubEvents = events.filter((event) => (
        event.type === "tool.started" || event.type === "tool.completed"
      ) && payloadRecord(event).toolName === "github_repository");
      expect(completed.status).toBe("completed");
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(githubEvents.map((event) => event.type)).toEqual(["tool.started", "tool.completed"]);
      expect(payloadRecord(githubEvents.at(-1)!)).toMatchObject({ available: true });
    } finally {
      vi.unstubAllGlobals();
    }
  });

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

  it("still commits the final revision when a recoverable working checkpoint is locked", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-writer-checkpoint-"));
    class LockedCheckpointStore extends ArticleStore {
      override async checkpoint(): Promise<void> {
        throw Object.assign(new Error("working checkpoint is locked"), { code: "EPERM" });
      }
    }
    const articleStore = new LockedCheckpointStore(root);
    await articleStore.initialize();
    const journal = new MemoryRunJournal();
    const writer = new WriterService(
      journal,
      articleStore,
      { resolve: async () => "test-key" },
      new FauxWriterAgentFactory(),
    );

    const started = await writer.startCreate({
      articleId: "article:checkpoint-locked",
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
    expect(completed.status).toBe("completed");
    await expect(articleStore.read("article:checkpoint-locked")).resolves.toMatchObject({
      markdown: expect.stringContaining("Pi Writer 已通过受控工具保存正文"),
    });
    expect(writer.eventsAfter(started.id, 0).some((event) => event.type === "revision.committed"))
      .toBe(true);
  });

  it("indexes a selected local project before writing", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-writer-project-"));
    const articleStore = new ArticleStore(root);
    await articleStore.initialize();
    const journal = new MemoryRunJournal();
    const writer = new WriterService(
      journal,
      articleStore,
      { resolve: async () => "test-key" },
      new FauxWriterAgentFactory(),
    );
    const started = await writer.startCreate({
      articleId: "article:project-grounded",
      prompt: [
        "请介绍这个项目。",
        "## 项目文件夹：wandao",
        "### 文件正文",
        "#### 来源文件：`wandao/README.md`",
        "\n项目包含真实的抽奖模块。",
      ].join("\n"),
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
    const events = writer.eventsAfter(started.id, 0);
    const localEvents = events.filter((event) =>
      event.type === "tool.started" || event.type === "tool.completed",
    ).filter((event) => (event.payload as { toolName?: string }).toolName === "local_project");

    expect(completed.status).toBe("completed");
    expect(localEvents.map((event) => event.type)).toEqual(["tool.started", "tool.completed"]);
    expect((localEvents[0]?.payload as { project?: string }).project).toBe("wandao");
  });
});
