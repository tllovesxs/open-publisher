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
  requiredAssetIds: [],
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
  constructor(
    private readonly longSelectionReason = false,
    private readonly longChineseFields = false,
  ) {}

  createWriterAgent(options: CreateWriterAgentOptions): Agent {
    const faux = fauxProvider({ provider: "faux-visual", tokensPerSecond: 10_000 });
    faux.setResponses([fauxAssistantMessage(fauxToolCall("return_visual_plan", {
      placements: [
        {
          position: "系统架构 / 采集、编排、发布三层",
          purpose: this.longChineseFields ? "目".repeat(900) : "解释三层模块之间的数据流。",
          visualContent: this.longChineseFields
            ? "图".repeat(1_500)
            : "采集、编排、发布三层模块和数据流向的框架图。",
          visualType: "framework",
          source: "existing_asset",
          assetId: "media-architecture",
          selectionReason: this.longChineseFields
            ? "因".repeat(900)
            : this.longSelectionReason
              ? "x".repeat(900)
              : "素材描述准确覆盖三层架构与数据流。",
          alt: this.longChineseFields ? "图".repeat(180) : "采集、编排与发布三层架构图",
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

class FauxRequestedAssetFactory implements WriterAgentFactory {
  createWriterAgent(options: CreateWriterAgentOptions): Agent {
    const faux = fauxProvider({ provider: "faux-requested-asset", tokensPerSecond: 10_000 });
    faux.setResponses([fauxAssistantMessage(fauxToolCall("return_visual_plan", {
      placements: [{
        position: "系统架构 / 采集、编排、发布三层",
        purpose: "使用用户选择的素材补充架构段落。",
        visualContent: "系统架构与职责边界。",
        visualType: "framework",
        source: "existing_asset",
        assetId: "asset-requested",
        selectionReason: "模型明确选择这张用户提供的素材。",
        alt: "用户选择的架构配图",
      }],
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

class CapturingVisualFactory implements WriterAgentFactory {
  readonly prompts: Array<{ text: string; images: unknown }> = [];

  createWriterAgent(options: CreateWriterAgentOptions): Agent {
    return {
      state: { errorMessage: null },
      abort: () => undefined,
      prompt: async (text: string, images: unknown) => {
        this.prompts.push({ text, images });
        const returnTool = options.tools.find((tool) => tool.name === "return_visual_plan");
        if (!returnTool) throw new Error("Visual return tool was not registered");
        await returnTool.execute("captured-visual-plan", {
          placements: [{
            position: "系统架构 / 采集、编排、发布三层",
            purpose: "解释三层模块之间的数据流。",
            visualContent: "采集、编排、发布三层模块和数据流向的框架图。",
            visualType: "framework",
            source: "existing_asset",
            assetId: "media-architecture",
            selectionReason: "已根据用户附图及文章结构选择该素材。",
            alt: "采集、编排与发布三层架构图",
          }],
        });
      },
    } as unknown as Agent;
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
    expect(result.plan.placements[1]?.generationPrompt).toContain("Render no readable text");
    expect(result.plan.placements[1]?.generationPrompt).toContain("at most three visual elements");
    expect(result.plan.placements[1]?.generationPrompt).not.toContain("LABELS: Prefer no in-image text");
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

  it("keeps the generated selection explanation within the desktop bridge limit", async () => {
    const secrets: SecretProvider = { resolve: async () => "test-key" };
    const result = await new VisualPlanningService(secrets, new FauxVisualFactory(true)).plan({
      markdown,
      sourceRevisionHash: contentHash(markdown),
      visualComposition,
      modelProfile: profile,
    });

    expect(result.provenance).toBe("pi");
    expect(result.plan.placements[0]?.selectionReason).toHaveLength(900);
  });

  it("keeps CJK model fields within the shared character limits", async () => {
    const secrets: SecretProvider = { resolve: async () => "test-key" };
    const result = await new VisualPlanningService(secrets, new FauxVisualFactory(false, true)).plan({
      markdown,
      sourceRevisionHash: contentHash(markdown),
      visualComposition,
      modelProfile: profile,
    });

    expect(result.provenance).toBe("pi");
    const placement = result.plan.placements[0];
    expect(placement?.purpose).toHaveLength(900);
    expect(placement?.visualContent).toHaveLength(1_500);
    expect(placement?.selectionReason).toHaveLength(900);
    expect(placement?.alt.length).toBeLessThanOrEqual(48);
    expect(placement?.generationPrompt).toBeTruthy();
    expect(Array.from(placement?.generationPrompt ?? "").length).toBeLessThanOrEqual(12_000);
  });

  it("always uses an explicitly inserted asset even when it falls outside the ranked candidate cap", async () => {
    const assets = [
      "接口、事件和数据流的架构关系图",
      "模块之间的数据流与职责边界",
      "发布流程的状态变化关系",
      "采集、编排、发布三层架构",
      "服务之间的可追踪数据流",
    ].map((description, index) => ({
      id: `asset-related-${index + 1}`,
      alt: description,
      description,
    }));
    const requiredAsset = {
      id: "asset-required",
      alt: "海边风景照片",
      description: "一张与文章架构主题无关的海岸照片。",
    };
    const result = await new VisualPlanningService({ resolve: async () => undefined }).plan({
      markdown,
      sourceRevisionHash: contentHash(markdown),
      visualComposition: {
        ...visualComposition,
        mode: "fixed",
        targetCount: 1,
        assets: [...assets, requiredAsset],
        requiredAssetIds: [requiredAsset.id],
      },
    });

    expect(result.plan.placements).toMatchObject([
      { source: "existing_asset", assetId: requiredAsset.id },
    ]);
    expect(result.plan.placements[0]?.candidates.some((candidate) => candidate.assetId === requiredAsset.id)).toBe(true);
  });

  it("honors a model-selected asset even when the heuristic would rank it outside the candidate cap", async () => {
    const assets = [
      "系统架构图、服务边界和数据流",
      "事件驱动的发布流程",
      "内容采集与审核步骤",
      "模块职责和运行状态",
      "发布任务的可观测性",
    ].map((description, index) => ({
      id: `asset-related-${index + 1}`,
      alt: description,
      description,
    }));
    const requestedAsset = {
      id: "asset-requested",
      alt: "用户明确选择的低相关度素材",
      description: "这张素材由模型基于用户要求主动选择。",
    };
    const result = await new VisualPlanningService(
      { resolve: async () => "test-key" },
      new FauxRequestedAssetFactory(),
    ).plan({
      markdown,
      sourceRevisionHash: contentHash(markdown),
      visualComposition: {
        ...visualComposition,
        mode: "fixed",
        targetCount: 1,
        assets: [...assets, requestedAsset],
        requiredAssetIds: [],
      },
      modelProfile: profile,
    });

    expect(result.plan.placements).toMatchObject([
      { source: "existing_asset", assetId: requestedAsset.id },
    ]);
    expect(result.plan.placements[0]?.candidates.some((candidate) => candidate.assetId === requestedAsset.id)).toBe(true);
  });

  it("gives local attachment bytes to a vision-capable visual planner", async () => {
    const factory = new CapturingVisualFactory();
    const result = await new VisualPlanningService(
      { resolve: async () => "test-key" },
      factory,
    ).plan({
      markdown,
      sourceRevisionHash: contentHash(markdown),
      visualComposition: { ...visualComposition, targetCount: 1 },
      images: [{
        assetId: "media-architecture",
        name: "产品架构截图.png",
        mimeType: "image/png",
        data: "aW1hZ2U=",
        intent: "insert",
      }],
      modelProfile: { ...profile, supportsVision: true },
    });

    expect(result.provenance).toBe("pi");
    expect(factory.prompts).toHaveLength(1);
    expect(factory.prompts[0]?.text).toContain("产品架构截图.png");
    expect(factory.prompts[0]?.images).toEqual([
      expect.objectContaining({ type: "image", mimeType: "image/png", data: "aW1hZ2U=" }),
    ]);
  });

  it("keeps attachment bytes out of a text-only visual planner while retaining an explicit fallback", async () => {
    const factory = new CapturingVisualFactory();
    await new VisualPlanningService(
      { resolve: async () => "test-key" },
      factory,
    ).plan({
      markdown,
      sourceRevisionHash: contentHash(markdown),
      visualComposition: { ...visualComposition, targetCount: 1 },
      images: [{
        assetId: "media-architecture",
        name: "产品架构截图.png",
        mimeType: "image/png",
        data: "aW1hZ2U=",
        intent: "analyze",
      }],
      modelProfile: profile,
    });

    expect(factory.prompts[0]?.images).toEqual([]);
    expect(factory.prompts[0]?.text).toContain("不能编造图片内容");
  });
});
