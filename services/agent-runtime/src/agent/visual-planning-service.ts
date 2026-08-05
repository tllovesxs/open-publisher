import { createHash } from "node:crypto";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { TextModelProfile } from "./model-profile.js";
import { PiAgentAdapter, type WriterAgentFactory } from "./pi-adapter.js";
import { runWithModelDeadline } from "./model-deadline.js";
import type { SecretProvider } from "../security/secret-provider.js";
import {
  isOperationCancelled,
  throwIfOperationCancelled,
} from "../operations/operation-registry.js";

const MAX_PLACEMENTS = 6;
const MAX_ASSETS = 6;
const MAX_CANDIDATES = 5;
const VISUAL_TYPES = ["infographic", "scene", "flowchart", "comparison", "framework", "timeline"] as const;

export type VisualImageMode = "none" | "auto" | "fixed";
export type VisualAssetScope = "selected_only" | "library" | "none";
export type VisualDensity = "minimal" | "balanced" | "per-section" | "rich";
export type VisualType = (typeof VISUAL_TYPES)[number];

export interface VisualAssetInstruction {
  readonly id: string;
  readonly alt: string;
  readonly description: string;
}

export interface VisualCompositionRequest {
  readonly mode: VisualImageMode;
  readonly targetCount: number;
  readonly assets: readonly VisualAssetInstruction[];
  readonly assetScope: VisualAssetScope;
  readonly preferredType: VisualType;
  readonly density: VisualDensity;
  readonly style: string;
  readonly palette: string | null;
  readonly preferredImageBackend: string;
  readonly generationBatchSize: number;
  readonly materialMatchThreshold: number;
  readonly skipConfirmation: boolean;
}

export interface VisualPlanningRequest {
  /** Canonical Markdown from ArticleStore, never an HTML derivative. */
  readonly markdown: string;
  /** Must be the exact `ArticleFileState.contentHash` for markdown. */
  readonly sourceRevisionHash: `sha256:${string}`;
  readonly instruction?: string;
  readonly visualComposition: VisualCompositionRequest;
  /** Omit this to use deterministic local planning without a text model. */
  readonly modelProfile?: TextModelProfile;
}

export interface VisualMaterialCandidate {
  readonly assetId: string;
  /** Integer score on a 0-1000 scale; safe to pass across the native boundary. */
  readonly score: number;
  readonly description: string;
}

export interface VisualPlacement {
  readonly id: `illustration-${number}`;
  readonly blockId: string | null;
  readonly anchorExcerpt: string | null;
  readonly afterHeading: string | null;
  readonly purpose: string;
  readonly visualContent: string;
  readonly visualType: VisualType;
  readonly source: "existing_asset" | "generate";
  readonly assetId: string | null;
  readonly candidates: readonly VisualMaterialCandidate[];
  readonly selectionReason: string;
  readonly alt: string;
  /** Prepared for user changes from material to generation; it does not perform I/O. */
  readonly generationPrompt: string;
  readonly promptFile: string;
}

export interface VisualCompositionPlan {
  readonly sourceRevisionHash: `sha256:${string}`;
  readonly targetCount: number;
  readonly settings: Readonly<Record<string, string>>;
  readonly needsConfirmation: boolean;
  readonly placements: readonly VisualPlacement[];
}

export interface VisualPlanningResult {
  readonly plan: VisualCompositionPlan;
  readonly provider: string;
  readonly model: string;
  /** Always false. Local fallback is disclosed by `provenance`, never called mocked. */
  readonly mocked: false;
  readonly provenance: "pi" | "local_deterministic";
  readonly fallbackReason: string | null;
}

interface MarkdownBlock {
  readonly id: string;
  readonly ordinal: number;
  readonly heading: string | null;
  readonly text: string;
  readonly excerpt: string;
}

interface ModelPlacement {
  readonly position: string;
  readonly purpose: string;
  readonly visualContent: string;
  readonly visualType: VisualType;
  readonly source: "existing_asset" | "generate";
  readonly assetId: string | null;
  readonly selectionReason: string;
  readonly alt: string;
}

const MODEL_PLAN_PARAMETERS = Type.Object({
  placements: Type.Array(Type.Object({
    position: Type.String({ minLength: 1, maxLength: 800 }),
    purpose: Type.String({ minLength: 1, maxLength: 900 }),
    visualContent: Type.String({ minLength: 1, maxLength: 1_500 }),
    visualType: Type.Union(VISUAL_TYPES.map((value) => Type.Literal(value))),
    source: Type.Union([Type.Literal("existing_asset"), Type.Literal("generate")]),
    assetId: Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()]),
    selectionReason: Type.String({ minLength: 1, maxLength: 900 }),
    alt: Type.String({ minLength: 1, maxLength: 180 }),
  }), { maxItems: MAX_PLACEMENTS }),
});

/**
 * Keep the cross-language visual contract in Unicode scalar characters.
 * JavaScript's String#slice counts UTF-16 code units, which can split an
 * emoji and does not line up with Rust's `str::chars().count()` boundary.
 */
const truncateCharacters = (value: string, maximum: number): string =>
  Array.from(value).slice(0, maximum).join("");

const clean = (value: string, maximum: number): string =>
  truncateCharacters(value.replace(/\s+/g, " ").trim(), maximum);

const truncatePrompt = (value: string, maximum: number): string =>
  truncateCharacters(value, maximum);

const hashMarkdown = (markdown: string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(markdown, "utf8").digest("hex")}`;

const clampInteger = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, Math.round(value)));

const isVisualType = (value: string): value is VisualType =>
  (VISUAL_TYPES as readonly string[]).includes(value);

const slug = (value: string, fallback: string): string => {
  const words = value.toLowerCase().match(/[a-z0-9]+/g)?.slice(0, 4) ?? [];
  return words.length > 0 ? words.join("-") : fallback;
};

export const autoImageCount = (markdown: string): number => {
  const characters = markdown.replace(/\s+/g, "").length;
  if (characters <= 900) return 1;
  if (characters <= 2_000) return 2;
  if (characters <= 3_800) return 3;
  return 4;
};

export const markdownBlocks = (markdown: string): readonly MarkdownBlock[] => {
  const blocks: MarkdownBlock[] = [];
  let heading: string | null = null;
  let paragraph: string[] = [];
  let inFence = false;
  const flush = (): void => {
    const text = clean(paragraph.join("\n"), 2_000);
    paragraph = [];
    if (!text || /^(?:!\[|\||>\s|[-*+]\s)/.test(text)) return;
    const ordinal = blocks.length + 1;
    const digest = createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12);
    blocks.push({
      id: `block-${ordinal}-${digest}`,
      ordinal,
      heading,
      text,
      excerpt: clean(text, 220),
    });
  };
  for (const line of markdown.split(/\r?\n/)) {
    if (line.trimStart().startsWith("```")) {
      flush();
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const matchedHeading = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (matchedHeading?.[1]) {
      flush();
      heading = clean(matchedHeading[1], 180) || null;
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^(?:\s*[-*+]\s+|\s*\d+[.)]\s+|\s*>\s*)/.test(line)) {
      flush();
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
};

const tokens = (value: string): Set<string> => {
  const normalized = value.toLowerCase();
  const latin = normalized.match(/[a-z0-9]{2,}/g) ?? [];
  const cjk: string[] = [];
  for (const sequence of normalized.match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (sequence.length === 1) cjk.push(sequence);
    for (let index = 0; index < sequence.length - 1; index += 1) cjk.push(sequence.slice(index, index + 2));
    for (let index = 0; index < sequence.length - 2; index += 1) cjk.push(sequence.slice(index, index + 3));
  }
  return new Set([...latin, ...cjk]);
};

const similarity = (left: string, right: string): number => {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  if (overlap === 0) return 0;
  const coverage = overlap / leftTokens.size;
  const balanced = (2 * overlap) / (leftTokens.size + rightTokens.size);
  return Math.min(1, coverage * 0.82 + balanced * 0.18);
};

const candidatesFor = (
  visualContent: string,
  purpose: string,
  assets: readonly VisualAssetInstruction[],
): readonly VisualMaterialCandidate[] => [...assets]
  .map((asset) => ({
    assetId: asset.id,
    score: clampInteger(similarity(`${visualContent}\n${purpose}`, `${asset.alt}\n${asset.description}`) * 1_000, 0, 1_000),
    description: clean(`${asset.alt}\n${asset.description}`, 900),
  }))
  .sort((left, right) => right.score - left.score || left.assetId.localeCompare(right.assetId))
  .slice(0, MAX_CANDIDATES);

const pickBlock = (
  position: string,
  visualContent: string,
  blocks: readonly MarkdownBlock[],
  usedIds: ReadonlySet<string>,
): MarkdownBlock | null => {
  const candidates = blocks.filter((block) => !usedIds.has(block.id));
  if (candidates.length === 0) return null;
  const named = candidates.filter((block) => block.heading !== null && position.includes(block.heading));
  return (named.length > 0 ? named : candidates)
    .map((block) => ({ block, score: similarity(`${position}\n${visualContent}`, `${block.heading ?? ""}\n${block.text}`) }))
    .sort((left, right) => right.score - left.score || left.block.ordinal - right.block.ordinal)[0]?.block ?? null;
};

const settingsFor = (request: VisualCompositionRequest): Readonly<Record<string, string>> => ({
  type: request.preferredType,
  density: request.density,
  style: clean(request.style, 80) || "sketch-notes",
  palette: clean(request.palette ?? "default", 80) || "default",
  asset_scope: request.assetScope,
  generation_batch_size: String(request.generationBatchSize),
  material_match_threshold: String(request.materialMatchThreshold),
  image_backend: clean(request.preferredImageBackend, 80) || "auto",
});

const promptFor = (
  placement: Omit<VisualPlacement, "generationPrompt" | "promptFile">,
  settings: Readonly<Record<string, string>>,
  filename: string,
): string => {
  const labelAnchor = placement.anchorExcerpt ?? placement.afterHeading ?? "文章核心观点";
  return truncatePrompt([
    "---",
    `illustration_id: ${placement.id}`,
    `type: ${placement.visualType}`,
    `style: ${settings.style ?? "sketch-notes"}`,
    `palette: ${settings.palette ?? "default"}`,
    "aspect_ratio: 3:2",
    `output_file: ${filename}`,
    "---",
    "",
    `# ${placement.alt}`,
    "",
    `LAYOUT: Create one clear 3:2 ${placement.visualType} that explains the paragraph anchor.`,
    `ZONES: ${placement.visualContent}`,
    `LABELS: Prefer no in-image text. If indispensable, only use exact article terms: ${labelAnchor}`,
    `COLORS: Use the ${settings.palette ?? "default"} palette consistently.`,
    `STYLE: ${settings.style ?? "sketch-notes"}. Keep the composition explanatory, structured, and uncluttered.`,
    "ASPECT: 3:2 landscape.",
    "",
    "Do not include brand marks, watermarks, portraits, fabricated metrics, decorative text, or claims not supported by the article.",
  ].join("\n"), 12_000);
};

const targetCountFor = (markdown: string, request: VisualCompositionRequest): number => {
  if (request.mode === "none") return 0;
  if (request.mode === "fixed") return request.targetCount;
  return autoImageCount(markdown);
};

const assertRequest = (request: VisualPlanningRequest): void => {
  const composition = request.visualComposition;
  if (!request.markdown.trim()) throw new Error("Visual planning requires non-empty Markdown");
  if (hashMarkdown(request.markdown) !== request.sourceRevisionHash) {
    throw new Error("Visual planning markdown does not match the supplied ArticleStore content hash");
  }
  if (!["none", "auto", "fixed"].includes(composition.mode)) throw new Error("Visual image mode is invalid");
  if (!Number.isInteger(composition.targetCount) || composition.targetCount < 0 || composition.targetCount > MAX_PLACEMENTS) throw new Error("Visual targetCount must be between 0 and 6");
  if (composition.mode === "none" && composition.targetCount !== 0) throw new Error("Visual mode none requires targetCount 0");
  if (composition.mode === "auto" && composition.targetCount !== 0) throw new Error("Visual mode auto requires targetCount 0");
  if (composition.mode === "fixed" && composition.targetCount === 0) throw new Error("Visual mode fixed requires a targetCount");
  if (!isVisualType(composition.preferredType)) throw new Error("Visual preferredType is invalid");
  if (!Number.isInteger(composition.generationBatchSize) || composition.generationBatchSize < 1 || composition.generationBatchSize > 8) throw new Error("Visual generationBatchSize must be between 1 and 8");
  if (!Number.isInteger(composition.materialMatchThreshold) || composition.materialMatchThreshold < 0 || composition.materialMatchThreshold > 100) throw new Error("Visual materialMatchThreshold must be between 0 and 100");
  if (composition.assets.length > MAX_ASSETS) throw new Error("Visual planning supports at most 6 assets");
  if (composition.assetScope === "none" && composition.assets.length > 0) throw new Error("Visual assets require a non-none asset scope");
  const ids = new Set<string>();
  for (const asset of composition.assets) {
    if (!/^[a-z][a-z0-9_-]{0,99}$/.test(asset.id) || !clean(asset.alt, 160)) throw new Error("Visual asset metadata is invalid");
    if (ids.has(asset.id)) throw new Error("Visual asset ids must be unique");
    ids.add(asset.id);
  }
};

const fallbackModelPlacements = (
  markdown: string,
  request: VisualCompositionRequest,
): readonly ModelPlacement[] => {
  const count = targetCountFor(markdown, request);
  const blocks = markdownBlocks(markdown);
  return Array.from({ length: count }, (_, index) => {
    const block = blocks[Math.min(Math.floor((index * blocks.length) / Math.max(count, 1)), Math.max(blocks.length - 1, 0))];
    const section = block?.heading ?? "文章核心观点";
    const excerpt = block?.excerpt ?? "文章核心观点";
    const visualContent = `围绕“${excerpt}”解释关键概念、关系或执行步骤的${request.preferredType}配图`;
    return {
      position: `${section} / ${excerpt}`,
      purpose: "帮助读者在阅读对应段落后快速理解核心关系。",
      visualContent,
      visualType: request.preferredType,
      source: "generate",
      assetId: null,
      selectionReason: "本地确定性规划先按文章结构定位，再依据素材描述进行匹配。",
      alt: clean(visualContent, 180) || `正文配图 ${index + 1}`,
    };
  });
};

const normalizeModelPlacements = (
  candidate: readonly ModelPlacement[] | null,
  markdown: string,
  request: VisualCompositionRequest,
): readonly ModelPlacement[] => {
  const expected = targetCountFor(markdown, request);
  if (!candidate || candidate.length !== expected) return fallbackModelPlacements(markdown, request);
  const normalized = candidate.map((placement) => ({
    position: clean(placement.position, 800),
    purpose: clean(placement.purpose, 900),
    visualContent: clean(placement.visualContent, 1_500),
    visualType: isVisualType(placement.visualType) ? placement.visualType : request.preferredType,
    source: placement.source === "existing_asset" ? "existing_asset" as const : "generate" as const,
    assetId: placement.assetId === null ? null : clean(placement.assetId, 100) || null,
    selectionReason: clean(placement.selectionReason, 900),
    alt: clean(placement.alt, 180),
  }));
  return normalized.every((placement) =>
    placement.position
    && placement.purpose
    && placement.visualContent
    && placement.selectionReason
    && placement.alt,
  )
    ? normalized
    : fallbackModelPlacements(markdown, request);
};

const modelSystemPrompt = [
  "You are the planning phase of the bundled Baoyu Article Illustrator.",
  "You do not generate images and never mutate the article. Return a bounded visual plan only through return_visual_plan.",
  "Every illustration must teach a distinct concrete relationship, comparison, process, framework, or timeline from a safe prose paragraph. Avoid decorative images.",
  "Prefer supplied material only when its written metadata actually serves the visual need; an asset may be used at most once. Otherwise select generate.",
  "Do not invent metrics, logos, brands, people, quotations, or in-image text. Keep images explanatory and use the configured style and palette consistently.",
].join("\n");

export class VisualPlanningService {
  constructor(
    private readonly secrets: SecretProvider,
    private readonly pi: WriterAgentFactory = new PiAgentAdapter(),
  ) {}

  async plan(request: VisualPlanningRequest, signal?: AbortSignal): Promise<VisualPlanningResult> {
    assertRequest(request);
    throwIfOperationCancelled(signal);
    const profile = request.modelProfile;
    if (!profile || request.visualComposition.mode === "none") {
      return this.localPlan(request, profile ? "Visual mode is none" : "No text model profile was supplied");
    }
    const apiKey = await this.secrets.resolve(profile.secretRef);
    if (!apiKey) return this.localPlan(request, "Configured text model secret is unavailable");
    try {
      const modelPlacements = await this.planWithPi(request, profile, apiKey, signal);
      throwIfOperationCancelled(signal);
      const plan = this.buildPlan(request, modelPlacements);
      return { plan, provider: profile.providerId, model: profile.modelId, mocked: false, provenance: "pi", fallbackReason: null };
    } catch (error: unknown) {
      if (isOperationCancelled(error)) throw error;
      return this.localPlan(request, error instanceof Error ? `Pi visual planning failed: ${error.message}` : "Pi visual planning failed");
    }
  }

  private async planWithPi(
    request: VisualPlanningRequest,
    profile: TextModelProfile,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<readonly ModelPlacement[]> {
    let returned: readonly ModelPlacement[] | null = null;
    const returnTool: AgentTool<typeof MODEL_PLAN_PARAMETERS, { readonly accepted: true }> = {
      name: "return_visual_plan",
      label: "返回配图方案",
      description: "返回完整且唯一的文章配图计划；不生成图片，也不修改文章。",
      parameters: MODEL_PLAN_PARAMETERS,
      executionMode: "sequential",
      execute: async (_toolCallId, parameters) => {
        returned = parameters.placements as readonly ModelPlacement[];
        return { content: [{ type: "text", text: "Visual plan accepted." }], details: { accepted: true }, terminate: true };
      },
    };
    const agent = this.pi.createWriterAgent({
      profile,
      apiKey,
      systemPrompt: modelSystemPrompt,
      sessionId: `visual:${crypto.randomUUID()}`,
      tools: [returnTool],
      onEvent: () => undefined,
    });
    const composition = request.visualComposition;
    const prompt = {
      instruction: request.instruction?.slice(0, 4_000) ?? "为文章安排解释性正文配图。",
      imageCount: targetCountFor(request.markdown, composition),
      configuration: { type: composition.preferredType, density: composition.density, style: composition.style.slice(0, 80), palette: composition.palette ?? "default", materialMatchThreshold: composition.materialMatchThreshold },
      assets: composition.assetScope === "none" ? [] : composition.assets.map((asset) => ({ id: asset.id, alt: asset.alt, description: asset.description.slice(0, 600) })),
      markdown: request.markdown.slice(0, 120_000),
    };
    throwIfOperationCancelled(signal);
    await runWithModelDeadline(
      agent,
      profile,
      "Visual planning",
      () => agent.prompt(`Plan the requested illustrations from this JSON data. Use return_visual_plan now; do not answer with prose.\n${JSON.stringify(prompt)}`),
      signal,
    );
    throwIfOperationCancelled(signal);
    if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
    if (!returned) throw new Error("Pi finished without returning a structured visual plan");
    return returned;
  }

  private localPlan(request: VisualPlanningRequest, reason: string): VisualPlanningResult {
    return {
      plan: this.buildPlan(request, fallbackModelPlacements(request.markdown, request.visualComposition)),
      provider: "local-deterministic",
      model: "baoyu-article-illustrator-rules-v1",
      mocked: false,
      provenance: "local_deterministic",
      fallbackReason: reason,
    };
  }

  private buildPlan(request: VisualPlanningRequest, proposed: readonly ModelPlacement[]): VisualCompositionPlan {
    const composition = request.visualComposition;
    const settings = settingsFor(composition);
    const blocks = markdownBlocks(request.markdown);
    const normalized = normalizeModelPlacements(proposed, request.markdown, composition);
    const usedBlocks = new Set<string>();
    const usedAssets = new Set<string>();
    const assets = composition.assetScope === "none" ? [] : composition.assets;
    const placements = normalized.map((item, index): VisualPlacement => {
      const ordinal = index + 1;
      const block = pickBlock(item.position, item.visualContent, blocks, usedBlocks);
      if (block) usedBlocks.add(block.id);
      const candidates = candidatesFor(item.visualContent, item.purpose, assets);
      const requestedAsset = item.source === "existing_asset" && item.assetId !== null
        ? candidates.find((candidate) => candidate.assetId === item.assetId) ?? null
        : null;
      const defaultCandidate = candidates.find((candidate) => candidate.score >= composition.materialMatchThreshold * 10 && !usedAssets.has(candidate.assetId)) ?? null;
      const selected = requestedAsset && !usedAssets.has(requestedAsset.assetId) ? requestedAsset : defaultCandidate;
      if (selected) usedAssets.add(selected.assetId);
      const placementBase = {
        id: `illustration-${ordinal}` as `illustration-${number}`,
        blockId: block?.id ?? null,
        anchorExcerpt: block?.excerpt ?? null,
        afterHeading: block?.heading ?? null,
        purpose: item.purpose,
        visualContent: item.visualContent,
        visualType: item.visualType,
        source: selected ? "existing_asset" as const : "generate" as const,
        assetId: selected?.assetId ?? null,
        candidates,
        // The public desktop bridge enforces the same 900-character contract
        // as the model tool. Keep the explanatory suffix inside that boundary.
        selectionReason: clean(selected
          ? `${item.selectionReason} 已选素材与视觉目标匹配度为 ${Math.round(selected.score / 10)}%。`
          : `${item.selectionReason} 没有达到阈值且未重复使用的素材，准备生成新图片。`, 900),
        alt: item.alt,
      };
      const filename = `${String(ordinal).padStart(2, "0")}-${item.visualType}-${slug(block?.heading ?? item.alt, `concept-${ordinal}`)}.png`;
      const promptFile = `prompts/${String(ordinal).padStart(2, "0")}-${item.visualType}-${slug(block?.heading ?? item.alt, `concept-${ordinal}`)}.md`;
      return { ...placementBase, generationPrompt: promptFor(placementBase, settings, filename), promptFile };
    });
    return {
      sourceRevisionHash: request.sourceRevisionHash,
      targetCount: targetCountFor(request.markdown, composition),
      settings,
      needsConfirmation: !composition.skipConfirmation,
      placements,
    };
  }
}
