import { createHash } from "node:crypto";
import { Agent } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import type { CreateWriterAgentOptions, WriterAgentFactory } from "../src/agent/pi-adapter.js";
import type { SecretProvider } from "../src/security/secret-provider.js";
import {
  VisualPlanningService,
  autoImageCount,
} from "../src/agent/visual-planning-service.js";

const markdown = [
  "# 配图文章",
  "",
  "开场说明。",
  "",
  "## 系统架构",
  "",
  "采集、编排、发布三层通过可追踪的数据流协作，确保每一步都有明确的边界。",
  "",
  "```python",
  "never_target_this_code_block()",
  "```",
  "",
  "- 列表不能成为图片锚点",
  "",
  "## 实践",
  "",
  "从一个可回滚的发布流程开始，记录草稿、审核和最终发布的状态变化。",
].join("\n");

const contentHash = (value: string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

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

const visualComposition = {
  mode: "fixed" as const,
  targetCount: 2,
  assets: [
    {
      id: "media-architecture",
      alt: "三层产品架构图",
      description: "采集、编排、发布三层通过可追踪的数据流协作，三个模块之间有清晰的数据流向和明确边界。",
    },
    {
      id: "media-unrelated",
      alt: "海边照片",
      description: "晴天的海岸风景。",
    },
  ],
  assetScope: "selected_only" as const,
  preferredType: "framework" as const,
  density: "balanced" as const,
  style: "sketch-notes",
  palette: "macaron",
  preferredImageBackend: "auto",
  generationBatchSize: 4,
  materialMatchThreshold: 30,
  skipConfirmation: false,
};

class FauxVisualFactory implements WriterAgentFactory {
  createWriterAgent(options: CreateWriterAgentOptions): Agent {
    const faux = fauxProvider({ provider: "faux-visual", tokensPerSecond: 10_000 });
    faux.setResponses([fauxAssistantMessage(fauxToolCall("return_visual_plan", {
      placements: [
        {
          position: "系统架构 / 采集、编排、发布三层",
          purpose: "解释三层模块之间的数据流。",
          visualContent: "采集、编排、发布三层模块和数据流向的框架图。",
          visualType: "framework",
          source: "existing_asset",
          assetId: "media-architecture",
          selectionReason: "素材描述准确覆盖三层架构与数据流。",
          alt: "采集、编排与发布三层架构图",
        },
        {
          position: "实践 / 从一个可回滚的发布流程开始",
          purpose: "解释可回滚的发布步骤。",
          visualContent: "草稿、审核、发布与回滚状态之间的流程图。",
          visualType: "flowchart",
          source: "generate",
          assetId: null,
          selectionReason: "现有素材没有表达发布状态与回滚关系。",
          alt: "草稿到发布再到回滚的状态流程图",
        },
      ],
    }), { stopReason: "toolUse" })]);
    const models = createModels();
    models.setProvider(faux.provider);
    const agent = new Agent({
      initialState: { systemPrompt: options.systemPrompt, model: faux.getModel(), tools: options.tools, messages: [], thinkingLevel: "off" },
      streamFn: models.streamSimple.bind(models),
      sessionId: options.sessionId,
      toolExecution: "sequential",
    });
    agent.subscribe(options.onEvent);
    return agent;
  }
}

describe("VisualPlanningService", () => {
  it("creates an anchored deterministic Baoyu-compatible plan when no secret is available", async () => {
    const secrets: SecretProvider = { resolve: async () => undefined };
    const result = await new VisualPlanningService(secrets).plan({
      markdown,
      sourceRevisionHash: contentHash(markdown),
      visualComposition,
      modelProfile: profile,
    });

    expect(result).toMatchObject({
      mocked: false,
      provenance: "local_deterministic",
      provider: "local-deterministic",
      plan: { sourceRevisionHash: contentHash(markdown), targetCount: 2, needsConfirmation: true },
    });
    expect(result.plan.placements).toHaveLength(2);
    expect(result.plan.placements.every((placement) => placement.blockId !== null)).toBe(true);
    expect(result.plan.placements.every((placement) => placement.generationPrompt.includes("ZONES:"))).toBe(true);
    expect(result.plan.placements[0]?.source).toBe("generate");
    expect(result.plan.placements.every((placement) => placement.assetId === null)).toBe(true);
  });

  it("accepts a Pi structured tool plan while preserving stable anchors and prepared prompts", async () => {
    const secrets: SecretProvider = { resolve: async () => "test-key" };
    const result = await new VisualPlanningService(secrets, new FauxVisualFactory()).plan({
      markdown,
      sourceRevisionHash: contentHash(markdown),
      instruction: "为架构和实践各配一张解释图。",
      visualComposition,
      modelProfile: profile,
    });

    expect(result).toMatchObject({ provenance: "pi", provider: "test-provider", model: "test-model", mocked: false });
    expect(result.plan.placements).toMatchObject([
      { source: "existing_asset", assetId: "media-architecture", afterHeading: "系统架构" },
      { source: "generate", assetId: null, afterHeading: "实践", visualType: "flowchart" },
    ]);
    expect(result.plan.placements[1]?.generationPrompt).toContain("ASPECT: 3:2 landscape.");
  });

  it("keeps the source revision hash contract and conservative automatic density", async () => {
    const service = new VisualPlanningService({ resolve: async () => undefined });
    await expect(service.plan({
      markdown,
      sourceRevisionHash: `sha256:${"0".repeat(64)}`,
      visualComposition,
    })).rejects.toThrow("does not match");
    expect(autoImageCount("字".repeat(1_500))).toBe(2);
    expect(autoImageCount("字".repeat(4_000))).toBe(4);
  });
});
