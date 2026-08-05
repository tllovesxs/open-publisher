import { Check, Image, Menu, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppNavigation } from "./components/AppNavigation";
import { AnnouncementsPage } from "./components/AnnouncementsPage";
import { ArticlesPage } from "./components/ArticlesPage";
import type {
  AssistantActivity,
  MarkdownSelection,
  RewriteArticleOutcome,
  RewriteCandidate,
} from "./components/ArticleAssistant";
import { PageErrorBoundary } from "./components/PageErrorBoundary";
import {
  CreatePage,
  type CreationActivity,
  type CreationLogEntry,
  type CreationRequest,
} from "./components/CreatePage";
import { MediaPage } from "./components/MediaPage";
import type { EditorMode } from "./components/MarkdownWorkbench";
import type { WorkflowWorkspaceSnapshot } from "./components/WorkflowWorkspace";
import {
  PublishingPage,
  type PublishAction,
} from "./components/PublishingPage";
import { SettingsPage } from "./components/SettingsPage";
import { TemplatesPage } from "./components/TemplatesPage";
import {
  availableSkills,
  defaultAgents,
  defaultTemplates,
} from "./data/contentStudio";
import { platformDefinitionFor, platforms } from "./data/platforms";
import {
  desktopBridge,
  type ConfigureModelRequest,
  type DisabledOptionalNodeId,
  type GitHubApplicationInfo,
  type ModelConfigurationSummary,
  type ModelConnectionTestSummary,
  type ModelProfileSummary,
  type PiAgentRun,
  type PiModelDiscoverySummary,
  type PiRunEvent,
  type PublishPlanSummary,
  type PublishReceiptSummary,
  type RewriteConversationMessage,
  type RuntimeSnapshot,
  type VisualCompositionPlanSummary,
  type VisualCompositionRequest,
  type VisualPlacementSummary,
  type WorkflowActivityEvent,
  type WorkflowActivityNodeId,
  type WorkflowAgentInstruction,
  type WorkflowNodeId,
  type WechatSyncBridgeStatus,
  type RunWorkflowSummary,
  type StoredArticleSummary,
} from "./lib/desktopBridge";
import { mediaMarkdownReference } from "./lib/mediaReferences";
import {
  loadMediaAssetsFromDatabase,
  saveMediaAssetsToDatabase,
} from "./lib/mediaStorage";
import type {
  Article,
  MarkdownTemplate,
  MediaAsset,
  NavKey,
  PlatformId,
  StudioAgent,
  StudioSkill,
  TemplateFixedBlock,
  TemplateLayoutProfile,
  TemplateStructureProfile,
  TemplateStyleProfile,
} from "./types";

type Theme = "light" | "dark";

interface PublishSession {
  articleId: string;
  revisionId: string;
  plan: PublishPlanSummary;
  receipts: PublishReceiptSummary[];
}

export interface FailedCreationContext {
  articleId: string;
  request: CreationRequest;
  templateId: string | null;
  imageAssetIds: string[];
}

interface PersistedFailedCreationContext {
  schemaVersion: 1;
  articleId: string;
  request: {
    topic: string;
    title: string;
    contentType: string;
    tone: string;
    length: string;
    platforms: PlatformId[];
    preset: "fast" | "standard" | "deep";
    disabledNodeIds: DisabledOptionalNodeId[];
    imagePlan: CreationRequest["imagePlan"];
    webSearchMode: CreationRequest["webSearchMode"];
    templateId: string | null;
    imageAssetIds: string[];
  };
}

interface ArticleProgress {
  articleId: string;
  title: string;
  detail: string;
  value: number | null;
}

interface VisualConfirmationState {
  articleId: string;
  plan: VisualCompositionPlanSummary;
  assets: MediaAsset[];
  matchThreshold: number;
  resolve: (plan: VisualCompositionPlanSummary | null) => void;
}

/**
 * Keeping an indexed character buffer prevents every visual character from
 * copying the entire upstream model delta. The UI still renders exactly one
 * Unicode code point per animation frame.
 */
interface WriterTypewriterQueue {
  characters: string[];
  nextIndex: number;
}

/**
 * A user-edit snapshot taken before an asynchronous Agent request starts.
 * The revision id is retained for diagnostics/CAS calls; edit safety is
 * intentionally based on the local body and monotonically increasing edit
 * version, because a successful background save may legitimately advance the
 * revision without changing the body.
 */
interface ArticleSourceSnapshot {
  articleId: string;
  markdown: string;
  revisionId: string | null;
  editVersion: number;
}

interface WriterSourceFence extends ArticleSourceSnapshot {
  executionId: number;
}

const CREATION_ACTIVITY_STORAGE_KEY = "open-publisher-creation-activity";
const FAILED_CREATION_STORAGE_KEY = "open-publisher-failed-creation";
const TEMPLATES_STORAGE_KEY = "open-publisher-studio-templates";
const MEDIA_STORAGE_KEY = "open-publisher-studio-media";
const SELECTED_TEMPLATE_STORAGE_KEY = "open-publisher-studio-selected-template";
const SELECTED_MEDIA_STORAGE_KEY = "open-publisher-studio-selected-media";
const EDITOR_MODE_STORAGE_KEY = "open-publisher-studio-editor-mode";
const WORKFLOW_NODES_STORAGE_KEY = "open-publisher-studio-workflow-nodes";
const WORKFLOW_WORKSPACES_STORAGE_KEY = "open-publisher-studio-workflow-workspaces";
const MAX_LOCAL_IMAGE_BYTES = 15 * 1024 * 1024;
const WORKFLOW_CANCELLED_BY_USER_MESSAGE =
  "已停止本次生成。已保留编辑器中已写入的内容，可修改后重试。";
const ASYNC_SOURCE_CHANGED =
  "检测到你在 AI 处理期间修改了正文，已保留你的编辑；旧任务结果没有写回。请保存当前草稿或重新运行 AI。";
const MAX_AUTO_IN_ARTICLE_IMAGES = 4;
const MAX_FAILED_RECOVERY_TEXT_LENGTH = 1_200;
const INLINE_DATA_IMAGE_PATTERN =
  /!\[([^\]\r\n]*)\]\((data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=]+)\)/gi;
const ARTICLE_IMAGE_PATTERN =
  /!\[[^\]\r\n]*\]\((?:\\.|[^)\r\n])*\)|!\[[^\]\r\n]*\]\[[^\]\r\n]*\]|<img\b[^>]*>/gi;
const SUPPORTED_LOCAL_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);
const OPTIONAL_WORKFLOW_NODE_IDS: DisabledOptionalNodeId[] = [
  "research",
  "outline",
  "natural-style",
  "review",
  "visual",
];

function requestWriterFrame(callback: FrameRequestCallback): number {
  if (typeof window.requestAnimationFrame === "function") {
    return window.requestAnimationFrame(callback);
  }
  return window.setTimeout(() => callback(window.performance.now()), 16);
}

function cancelWriterFrame(frame: number): void {
  if (typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(frame);
    return;
  }
  window.clearTimeout(frame);
}

function isOptionalWorkflowNodeId(
  value: string | undefined,
): value is DisabledOptionalNodeId {
  return Boolean(
    value && OPTIONAL_WORKFLOW_NODE_IDS.includes(value as DisabledOptionalNodeId),
  );
}

function isWorkflowNodeId(value: string | undefined): value is WorkflowActivityNodeId {
  return value === "draft" || value === "risk" || value === "reference-safety" || isOptionalWorkflowNodeId(value);
}

function loadStudioValue<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Web Storage is only a convenience cache. A quota error must never break writing. */
type StudioStorage = Pick<Storage, "removeItem" | "setItem">;

export function replaceStudioValue(
  key: string,
  value: unknown,
  storage: StudioStorage = window.localStorage,
) {
  try {
    const serialized = JSON.stringify(value);
    storage.setItem(key, serialized);
    return true;
  } catch {
    try {
      // An older version may have stored a full Base64 asset under this key.
      // Clear only the same cache key, then retry the compact replacement once.
      const serialized = JSON.stringify(value);
      storage.removeItem(key);
      storage.setItem(key, serialized);
      return true;
    } catch {
      return false;
    }
  }
}

function replaceStudioTextValue(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    try {
      window.localStorage.removeItem(key);
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
}

function removeStudioValue(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Browser storage is non-critical; canonical documents live in the local runtime.
  }
}

function recoveryString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.slice(0, MAX_FAILED_RECOVERY_TEXT_LENGTH) : fallback;
}

export function persistedFailedCreationContext(
  context: FailedCreationContext,
): PersistedFailedCreationContext {
  const request = context.request;
  return {
    schemaVersion: 1,
    articleId: context.articleId,
    request: {
      topic: recoveryString(request.topic),
      title: recoveryString(request.title),
      contentType: recoveryString(request.contentType),
      tone: recoveryString(request.tone),
      length: recoveryString(request.length),
      platforms: request.platforms.slice(0, 16),
      preset: request.preset,
      disabledNodeIds: request.disabledNodeIds.slice(0, 8),
      imagePlan: {
        mode: request.imagePlan.mode,
        targetCount: Math.max(0, Math.min(4, request.imagePlan.targetCount)),
        materialMatchThreshold: Math.max(
          0,
          Math.min(100, Math.round(request.imagePlan.materialMatchThreshold)),
        ),
      },
      webSearchMode: request.webSearchMode,
      templateId: context.templateId,
      imageAssetIds: context.imageAssetIds.slice(0, 16),
    },
  };
}

function createFailedCreationContext(articleId: string, request: CreationRequest): FailedCreationContext {
  return {
    articleId,
    request,
    templateId: request.template?.id ?? null,
    imageAssetIds: request.imageAssets.map((asset) => asset.id).filter(Boolean).slice(0, 16),
  };
}

function isStoredWorkflowWorkspace(value: unknown): value is WorkflowWorkspaceSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<WorkflowWorkspaceSnapshot>;
  if (
    !["running", "completed", "failed"].includes(snapshot.status ?? "") ||
    !Array.isArray(snapshot.events) ||
    !Array.isArray(snapshot.artifacts) ||
    typeof snapshot.updatedAt !== "number"
  ) {
    return false;
  }
  return snapshot.events.every((event) =>
    Boolean(
      event &&
        typeof event.id === "string" &&
        typeof event.eventType === "string" &&
        typeof event.createdAt === "string" &&
        (event.nodeId === null || isWorkflowNodeId(event.nodeId)),
    ),
  );
}

function loadWorkflowWorkspaces(): Record<string, WorkflowWorkspaceSnapshot> {
  const stored = loadStudioValue<unknown>(WORKFLOW_WORKSPACES_STORAGE_KEY, {});
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  return Object.fromEntries(
    Object.entries(stored)
      .filter(([articleId, snapshot]) => articleId.length <= 120 && isStoredWorkflowWorkspace(snapshot))
      .slice(-24),
  ) as Record<string, WorkflowWorkspaceSnapshot>;
}

function isStoredMediaAsset(value: unknown): value is MediaAsset {
  if (!value || typeof value !== "object") return false;
  const asset = value as Partial<MediaAsset>;
  return (
    typeof asset.id === "string" &&
    typeof asset.name === "string" &&
    typeof asset.alt === "string" &&
    (asset.description === undefined || typeof asset.description === "string") &&
    (asset.visualDescription === undefined || typeof asset.visualDescription === "string") &&
    (asset.usageHint === undefined || typeof asset.usageHint === "string") &&
    (asset.generationPrompt === undefined || typeof asset.generationPrompt === "string") &&
    (asset.tags === undefined || Array.isArray(asset.tags)) &&
    (asset.descriptionSource === undefined || ["manual", "generation_prompt", "vision"].includes(asset.descriptionSource)) &&
    typeof asset.src === "string" &&
    (asset.source === "uploaded" || asset.source === "generated") &&
    typeof asset.createdAt === "string"
  );
}

function loadMediaAssets() {
  const stored = loadStudioValue<unknown>(MEDIA_STORAGE_KEY, []);
  return Array.isArray(stored)
    ? stored.filter(isStoredMediaAsset).map(normalizeMediaAsset)
    : [];
}

function normalizeMediaAsset(asset: MediaAsset): MediaAsset {
  return {
    ...asset,
    description: asset.description ?? "",
    visualDescription: asset.visualDescription ?? "",
    usageHint: asset.usageHint ?? asset.description ?? "",
    generationPrompt: asset.generationPrompt ?? "",
    tags: Array.isArray(asset.tags)
      ? asset.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 24)
      : [],
    descriptionSource: asset.descriptionSource ?? "manual",
  };
}

const emptyStyleProfile = (): TemplateStyleProfile => ({
  tone: "",
  audience: "",
  perspective: "",
  sentenceStyle: "",
  pacing: "",
  density: "",
});

const emptyStructureProfile = (): TemplateStructureProfile => ({
  openingPattern: "",
  sectionPattern: "",
  conclusionPattern: "",
  headingDepth: "",
  paragraphPattern: "",
});

const emptyLayoutProfile = (): TemplateLayoutProfile => ({
  useLists: true,
  useTables: false,
  useBlockquotes: false,
  useCodeBlocks: false,
  imagePlacement: "",
  emphasisRules: "",
});

export function normalizeTemplate(value: unknown): MarkdownTemplate | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<MarkdownTemplate>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.description !== "string" ||
    typeof candidate.category !== "string" ||
    typeof candidate.markdown !== "string"
  ) return null;
  const blocks = Array.isArray(candidate.fixedBlocks)
    ? candidate.fixedBlocks
        .filter((block): block is TemplateFixedBlock => Boolean(block && typeof block === "object" && typeof (block as TemplateFixedBlock).content === "string"))
        .map((block, index) => ({
          id: typeof block.id === "string" ? block.id : `${candidate.id}-block-${index + 1}`,
          label: typeof block.label === "string" ? block.label : "固定片段",
          enabled: block.enabled !== false,
          content: block.content.slice(0, 4_000),
          position: ["before_title", "after_intro", "before_closing", "after_article"].includes(block.position)
            ? block.position
            : "after_article",
        }))
    : [];
  const referenceMarkdown = typeof candidate.referenceMarkdown === "string"
    ? candidate.referenceMarkdown.replace(/\r\n?/g, "\n").trim()
    : "";
  const mode = candidate.mode === "reference" && referenceMarkdown ? "reference" : "scaffold";
  return {
    id: candidate.id,
    name: candidate.name.slice(0, 120),
    description: candidate.description.slice(0, 500),
    category: candidate.category.slice(0, 80),
    markdown: candidate.markdown,
    styleProfile: { ...emptyStyleProfile(), ...(candidate.styleProfile ?? {}) },
    structureProfile: { ...emptyStructureProfile(), ...(candidate.structureProfile ?? {}) },
    layoutProfile: { ...emptyLayoutProfile(), ...(candidate.layoutProfile ?? {}) },
    fixedBlocks: blocks,
    variables: Array.isArray(candidate.variables)
      ? candidate.variables.filter((variable): variable is string => typeof variable === "string").slice(0, 64)
      : [],
    usageInstructions: typeof candidate.usageInstructions === "string" ? candidate.usageInstructions.slice(0, 4_000) : "",
    isBuiltIn: candidate.isBuiltIn === true,
    mode,
    referenceMarkdown: mode === "reference" ? referenceMarkdown : undefined,
    sourceFingerprint: typeof candidate.sourceFingerprint === "string"
      && /^sha256:[a-f0-9]{64}$/.test(candidate.sourceFingerprint)
      ? candidate.sourceFingerprint
      : undefined,
    analysisVersion: typeof candidate.analysisVersion === "string"
      ? candidate.analysisVersion.slice(0, 80)
      : undefined,
    rightsConfirmed: mode === "reference" && candidate.rightsConfirmed === true,
  };
}

function loadTemplates() {
  const stored = loadStudioValue<unknown>(TEMPLATES_STORAGE_KEY, defaultTemplates);
  const normalized = Array.isArray(stored)
    ? stored.map(normalizeTemplate).filter((template): template is MarkdownTemplate => Boolean(template))
    : [];
  return normalized.length > 0 ? normalized : defaultTemplates;
}

function newLocalId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function baseName(filename: string) {
  return (
    filename
      .replace(/\.[^.]+$/, "")
      .replace(/[\[\]\r\n]+/g, " ")
      .trim()
      .slice(0, 100) || "本地图片"
  );
}

function readLocalImage(file: File): Promise<string> {
  if (!SUPPORTED_LOCAL_IMAGE_TYPES.has(file.type)) {
    return Promise.reject(new Error("请选择 PNG、JPEG、WebP、GIF 或 AVIF 图片。"));
  }
  if (file.size === 0 || file.size > MAX_LOCAL_IMAGE_BYTES) {
    return Promise.reject(new Error("单张图片需小于 15 MB，方便保存在本机素材库。"));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("无法读取这张图片，请重新选择。"));
    reader.onload = () => {
      if (typeof reader.result !== "string" || !reader.result.startsWith("data:image/")) {
        reject(new Error("图片格式无效，请重新选择。"));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function compactInlineDataImages(markdown: string, knownAssets: MediaAsset[]) {
  const assetsBySource = new Map(knownAssets.map((asset) => [asset.src, asset]));
  const createdAssets: MediaAsset[] = [];
  const compactMarkdown = markdown.replace(
    INLINE_DATA_IMAGE_PATTERN,
    (fullMatch: string, alt: string, src: string) => {
      let asset = assetsBySource.get(src);
      if (!asset) {
        const assetAlt = escapeImageAlt(alt);
        asset = {
          id: newLocalId("media"),
          name: assetAlt,
          alt: assetAlt,
          description: "从历史 Markdown 的内嵌图片迁入本机素材库。",
          visualDescription: "",
          usageHint: "从历史 Markdown 的内嵌图片迁入本机素材库。",
          generationPrompt: "",
          tags: [],
          descriptionSource: "manual",
          src,
          source: "uploaded",
          createdAt: "刚刚迁入",
        };
        assetsBySource.set(src, asset);
        createdAssets.push(asset);
      }
      return `![${alt}](${mediaMarkdownReference(asset)})`;
    },
  );
  return { markdown: compactMarkdown, createdAssets };
}

function boundedVisualInstructionText(value: string, maximum: number) {
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
  return Array.from(normalized).slice(0, maximum).join("").trim();
}

export function visualCompositionFromCreation(
  request: CreationRequest,
): VisualCompositionRequest {
  const visualAssetAlt = (asset: MediaAsset) =>
    boundedVisualInstructionText(asset.alt || asset.name, 160)
      .replace(/\s+/g, " ")
      .trim() || "文章配图";
  const visualAssetDescription = (asset: MediaAsset) => {
    const hasStructuredDescription = Boolean(
      asset.visualDescription?.trim() ||
        asset.generationPrompt?.trim() ||
        (asset.tags && asset.tags.length > 0) ||
        (asset.usageHint?.trim() && asset.usageHint.trim() !== asset.description.trim()),
    );
    const description = hasStructuredDescription
      ? [
          asset.visualDescription?.trim() && `图片内容：${asset.visualDescription.trim()}`,
          asset.usageHint?.trim() && `使用场景：${asset.usageHint.trim()}`,
          asset.generationPrompt?.trim() && `生成提示词：${asset.generationPrompt.trim()}`,
          asset.tags && asset.tags.length > 0 && `标签：${asset.tags.join("、")}`,
        ].filter(Boolean).join("\n")
      : asset.description;
    // The sidecar protocol caps asset descriptions at 600 Unicode characters
    // and accepts only tabs/newlines as control whitespace.
    return boundedVisualInstructionText(description, 600) || `已选素材：${visualAssetAlt(asset)}`;
  };
  return {
    mode: request.imagePlan.mode,
    targetCount: request.imagePlan.targetCount,
    assets: request.imageAssets.slice(0, 6).map((asset) => ({
      id: asset.id,
      alt: visualAssetAlt(asset),
      description: visualAssetDescription(asset),
    })),
    assetScope: request.imageAssets.length > 0 ? "selected_only" : "none",
    preferredType: "infographic",
    density: request.imagePlan.mode === "auto" ? "balanced" : "minimal",
    style: "sketch-notes",
    palette: "macaron",
    preferredImageBackend: "auto",
    generationBatchSize: 4,
    materialMatchThreshold: request.imagePlan.materialMatchThreshold,
    skipConfirmation: false,
  };
}

function compositionCanRequireGeneratedImages(request: CreationRequest) {
  if (request.imagePlan.mode === "none") return false;
  if (request.imagePlan.mode === "auto") {
    return request.imageAssets.length < MAX_AUTO_IN_ARTICLE_IMAGES;
  }
  return request.imagePlan.targetCount > request.imageAssets.length;
}

function visualNodeDisabledIds(
  disabledNodeIds: DisabledOptionalNodeId[],
  imagePlan: CreationRequest["imagePlan"],
) {
  if (imagePlan.mode === "none") return disabledNodeIds;
  // A visual plan is the contract that makes images land in the correct section.
  // Do not silently accept an image request while skipping the planning Agent.
  return disabledNodeIds.filter((nodeId) => nodeId !== "visual");
}

function escapeImageAlt(value: string) {
  return value
    .replace(/[\[\]\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "文章配图";
}

function normalizedMarkdownText(value: string) {
  return value.replace(/[`*_~]/g, "").replace(/\s+/g, " ").trim();
}

function articleImages(markdown: string) {
  return markdown.match(ARTICLE_IMAGE_PATTERN) ?? [];
}

function assertRewritePreservesImages(source: string, replacement: string) {
  const before = articleImages(source);
  const after = articleImages(replacement);
  if (before.length !== after.length || before.some((image, index) => image !== after[index])) {
    throw new Error("AI 修改触碰了正文图片，已阻止应用本次结果。请重试文字修改。");
  }
}

function removeArticleImages(markdown: string) {
  return markdown
    .replace(ARTICLE_IMAGE_PATTERN, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd() + "\n";
}

function similarityCharacters(markdown: string) {
  return removeArticleImages(markdown)
    .replace(/```[\s\S]*?```/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function characterBigrams(value: string) {
  const characters = Array.from(value);
  const result = new Set<string>();
  for (let index = 0; index < characters.length - 1; index += 1) {
    result.add(`${characters[index]}${characters[index + 1]}`);
  }
  return result;
}

function articleChangeRequiresVisualRefresh(before: string, after: string) {
  if (articleImages(before).length === 0) return false;
  const beforeText = similarityCharacters(before);
  const afterText = similarityCharacters(after);
  if (beforeText.length < 200 || afterText.length < 200) return false;
  const lengthRatio = afterText.length / beforeText.length;
  if (lengthRatio < 0.65 || lengthRatio > 1.55) return true;
  const beforeBigrams = characterBigrams(beforeText);
  const afterBigrams = characterBigrams(afterText);
  const union = new Set([...beforeBigrams, ...afterBigrams]);
  if (union.size === 0) return false;
  let intersection = 0;
  beforeBigrams.forEach((bigram) => {
    if (afterBigrams.has(bigram)) intersection += 1;
  });
  return intersection / union.size < 0.42;
}

function insertionLineForAnchor(lines: string[], anchorExcerpt: string | null, heading: string | null) {
  const anchor = normalizedMarkdownText(anchorExcerpt ?? "");
  if (anchor) {
    for (let start = 0; start < lines.length; start += 1) {
      if (!lines[start]?.trim() || /^#{1,6}\s+|^```|^(?:[-*+]\s+|\d+[.)]\s+|>\s*)/.test(lines[start])) continue;
      let end = start;
      while (end < lines.length && lines[end]?.trim()) end += 1;
      const paragraph = normalizedMarkdownText(lines.slice(start, end).join("\n"));
      if (paragraph.includes(anchor) || anchor.includes(paragraph)) return end;
      start = end;
    }
  }
  if (heading) {
    const headingIndex = lines.findIndex(
      (line) => line.replace(/^#{1,6}\s+/, "").trim() === heading,
    );
    if (headingIndex >= 0) {
      const nextHeading = lines.findIndex(
        (line, index) => index > headingIndex && /^#{1,6}\s+/.test(line),
      );
      const boundary = nextHeading >= 0 ? nextHeading : lines.length;
      const firstContent = lines.findIndex(
        (line, index) => index > headingIndex && index < boundary && Boolean(line.trim()),
      );
      if (firstContent < 0) return headingIndex + 1;
      let insertion = firstContent + 1;
      while (insertion < boundary && Boolean(lines[insertion]?.trim())) insertion += 1;
      return insertion;
    }
  }
  return lines.length;
}

function insertVisualMarkdown(
  markdown: string,
  placements: Array<{ placement: VisualPlacementSummary; asset: MediaAsset }>,
) {
  const lines = markdown.trimEnd().split("\n");
  const insertions = placements
    .map(({ placement, asset }, originalIndex) => ({
      line: insertionLineForAnchor(lines, placement.anchorExcerpt, placement.afterHeading),
      originalIndex,
      markup: `![${escapeImageAlt(placement.alt || asset.alt)}](${mediaMarkdownReference(asset)})`,
    }))
    .sort((left, right) => right.line - left.line || right.originalIndex - left.originalIndex);
  for (const insertion of insertions) {
    lines.splice(insertion.line, 0, "", insertion.markup, "");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function requestedVisualCount(instruction: string): number | null {
  const arabicMatch = instruction.match(/(?:配|插|加|补).{0,12}?([1-6])\s*(?:张|幅|个)?(?:配图|插图|图片|图像|图)/u);
  if (arabicMatch?.[1]) return Number(arabicMatch[1]);
  const chineseMatch = instruction.match(/(?:配|插|加|补).{0,12}?([一二三四五六])\s*(?:张|幅|个)?(?:配图|插图|图片|图像|图)/u);
  const values: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  return chineseMatch?.[1] ? values[chineseMatch[1]] ?? null : null;
}

function buildWorkflowAgentInstructions(
  agents: StudioAgent[],
  skills: StudioSkill[],
): WorkflowAgentInstruction[] {
  const skillsById = new Map(skills.map((skill) => [skill.id, skill]));
  return agents
    .filter((agent) => agent.enabled && isWorkflowNodeId(agent.runtimeNodeId))
    .map((agent) => ({
      id: agent.id,
      name: agent.name.trim(),
      role: agent.role.trim(),
      nodeId: agent.runtimeNodeId as WorkflowNodeId,
      prompt: agent.prompt.trim(),
      skills: agent.skillIds
        .map((skillId) => skillsById.get(skillId))
        .filter((skill): skill is StudioSkill => Boolean(skill))
        .map((skill) => ({
          id: skill.id,
          name: skill.name,
          instructions: skill.instructions,
        })),
    }))
    .filter(
      (agent) =>
        Boolean(agent.id) &&
        Boolean(agent.name) &&
        Boolean(agent.role) &&
        Boolean(agent.prompt),
    );
}

function disabledOptionalNodesFor(agents: StudioAgent[]): DisabledOptionalNodeId[] {
  return agents.flatMap((agent) =>
    !agent.enabled && isOptionalWorkflowNodeId(agent.runtimeNodeId)
      ? [agent.runtimeNodeId]
      : [],
  );
}

function sanitizeActivityMessage(message: string) {
  return message
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gi, "[密钥已隐藏]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [凭据已隐藏]")
    .replace(/https?:\/\/\S+/gi, "[地址已隐藏]")
    .replace(
      /(api[_ -]?key|token|secret)(\s*[:=]\s*)\S+/gi,
      "$1$2[凭据已隐藏]",
    )
    .slice(0, 240);
}

function activityLog(
  id: string,
  message: string,
  tone: CreationLogEntry["tone"] = "info",
  timestamp = Date.now(),
): CreationLogEntry {
  return {
    id,
    timestamp,
    message: sanitizeActivityMessage(message),
    tone,
  };
}

const workflowNodeLabel: Record<WorkflowActivityNodeId, string> = {
  research: "资料整理",
  outline: "大纲规划",
  draft: "正文撰写",
  "natural-style": "自然表达",
  review: "内容审阅",
  "reference-safety": "资料核验",
  risk: "风险检查",
  visual: "配图规划",
};

function workflowAgentLabel(
  nodeId: WorkflowActivityNodeId,
  agents: WorkflowAgentInstruction[],
) {
  return (
    agents.find((agent) => agent.nodeId === nodeId)?.name ?? workflowNodeLabel[nodeId]
  );
}

function loadCreationActivity(): CreationActivity | null {
  try {
    const raw = window.localStorage.getItem(CREATION_ACTIVITY_STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as CreationActivity;
    if (!Array.isArray(stored.logs) || !Array.isArray(stored.agentLabels)) return null;
    if (stored.status === "running") {
      return {
        ...stored,
        status: "failed",
        phase: "上次生成未正常结束",
        elapsedSeconds: Math.max(
          stored.elapsedSeconds || 0,
          Math.round((Date.now() - stored.startedAt) / 1000),
        ),
        error: "应用上次关闭时工作流仍在执行，请重新提交创作要求。",
        retryable: false,
        logs: [
          ...stored.logs,
          activityLog("interrupted", "检测到上次生成会话已中断", "error"),
        ],
      };
    }
    return stored;
  } catch {
    return null;
  }
}

function loadFailedCreationContext(): FailedCreationContext | null {
  const stored = loadStudioValue<unknown>(FAILED_CREATION_STORAGE_KEY, null);
  if (!stored || typeof stored !== "object") return null;
  const context = stored as Partial<PersistedFailedCreationContext>;
  const request = context.request;
  if (
    typeof context.articleId !== "string" ||
    !context.articleId ||
    !request ||
    typeof request !== "object"
  ) {
    return null;
  }
  const candidate = request as Partial<PersistedFailedCreationContext["request"]>;
  const webSearchMode = candidate.webSearchMode === "off" || candidate.webSearchMode === "required"
    ? candidate.webSearchMode
    : "auto";
  const preset = candidate.preset === "fast" || candidate.preset === "deep" ? candidate.preset : "standard";
  const imagePlanMode = candidate.imagePlan?.mode;
  const imagePlan = {
    mode: imagePlanMode === "none" || imagePlanMode === "fixed" ? imagePlanMode : "auto",
    targetCount: Math.max(0, Math.min(4, Number(candidate.imagePlan?.targetCount) || 0)),
    materialMatchThreshold: Math.max(
      0,
      Math.min(100, Math.round(Number(candidate.imagePlan?.materialMatchThreshold) || 30)),
    ),
  } satisfies CreationRequest["imagePlan"];
  return {
    articleId: context.articleId,
    request: {
      topic: recoveryString(candidate.topic),
      title: recoveryString(candidate.title),
      references: "",
      contentType: recoveryString(candidate.contentType, "技术文章"),
      tone: recoveryString(candidate.tone, "专业清晰"),
      length: recoveryString(candidate.length, "约 3,000 字"),
      platforms: Array.isArray(candidate.platforms)
        ? candidate.platforms.filter((platform): platform is PlatformId =>
            typeof platform === "string" && platforms.some((item) => item.id === platform),
          )
        : [],
      preset,
      disabledNodeIds: Array.isArray(candidate.disabledNodeIds)
        ? candidate.disabledNodeIds.filter(isOptionalWorkflowNodeId)
        : [],
      template: null,
      imageAssets: [],
      imagePlan,
      webSearchMode,
    },
    templateId: typeof candidate.templateId === "string" ? candidate.templateId : null,
    imageAssetIds: Array.isArray(candidate.imageAssetIds)
      ? candidate.imageAssetIds.filter((id): id is string => typeof id === "string").slice(0, 16)
      : [],
  };
}

function preferredTheme(): Theme {
  const saved = window.localStorage.getItem("open-publisher-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function titleFromMarkdown(markdown: string, fallback = "未命名文章") {
  return (
    markdown
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /^#\s+/.test(line))
      ?.replace(/^#\s+/, "")
      .trim() || fallback
  );
}

function deckFromMarkdown(markdown: string) {
  return (
    markdown
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#") && !line.startsWith(">")) ||
    "本地保存的 Markdown 文章"
  ).slice(0, 120);
}

function displayTime(value: string) {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "最近更新";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(time);
}

function storedArticleToArticle(stored: StoredArticleSummary): Article {
  return {
    id: stored.articleId,
    title: stored.title || titleFromMarkdown(stored.markdown),
    deck: deckFromMarkdown(stored.markdown),
    markdown: stored.markdown,
    status: stored.revisionNumber > 1 ? "review" : "draft",
    updatedAt: displayTime(stored.updatedAt),
    wordCount: stored.markdown.replace(/\s/g, "").length,
    channels: ["wechat", "csdn", "toutiao"],
    collection: "本地文章",
    revisionId: stored.revisionId,
    revisionNumber: stored.revisionNumber,
  };
}

function highFidelityReferenceBlock(template: MarkdownTemplate) {
  if (
    template.mode !== "reference"
    || !template.referenceMarkdown
    || template.rightsConfirmed !== true
  ) return "";
  const safeId = template.id.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 120) || "template";
  const tag = `open-publisher-reference-${safeId}`;
  const metadata = encodeURIComponent(JSON.stringify({
    source_fingerprint: template.sourceFingerprint ?? "",
    style_profile: template.styleProfile,
    structure_profile: template.structureProfile,
    layout_profile: template.layoutProfile,
    usage_instructions: template.usageInstructions,
  }));
  return [
    "## 高保真参考样本（只用于写法分析，不得原样输出）",
    "",
    "按参考原文依次复用：开篇切入动作、段落粒度、章节推进、转折位置、列表/引用/代码的使用频率，以及每张图片承担的说明任务。所有事实、产品名、数据、链接和句子必须用当前主题重新写。",
    "",
    `<!-- open-publisher-reference-template:v1:${metadata} -->`,
    `<${tag}>`,
    template.referenceMarkdown,
    `</${tag}>`,
  ].join("\n");
}

export function buildCreationSeed(request: CreationRequest) {
  const title = request.title || request.topic;
  const referenceBlock = request.template ? highFidelityReferenceBlock(request.template) : "";
  const referenceNotes = request.references
    ? `\n\n## 参考资料\n\n${request.references}`
    : "";
  const templateHeadings = request.template
    ? request.template.markdown
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^#{1,3}\s+/.test(line))
        .map((line) => line.replace(/\{\{[^}]+\}\}/g, "").replace(/^#\s+/, "").trim())
        .filter(Boolean)
        .filter((heading) => heading !== title)
    : [];
  const template = request.template
    ? `\n\n## 写作模板规范（只作为内部规则，不要把本节原样输出）\n\n模板名称：${request.template.name}\n\n文风：\n${Object.entries(request.template.styleProfile).map(([key, value]) => `- ${key}：${value}`).join("\n")}\n\n结构：\n${Object.entries(request.template.structureProfile).map(([key, value]) => `- ${key}：${value}`).join("\n")}\n\n排版：\n${Object.entries(request.template.layoutProfile).map(([key, value]) => `- ${key}：${String(value)}`).join("\n")}\n\n模板骨架章节：\n${templateHeadings.map((heading) => `- ${heading}`).join("\n")}\n\n使用说明：${request.template.usageInstructions || "遵守模板结构，结合主题替换所有占位内容。"}\n\n固定片段：已配置 ${request.template.fixedBlocks.filter((block) => block.enabled && block.content.trim()).length} 个，由程序在生成后插入，写作 Agent 不要输出。`
    : "";
  const seed = `# ${title}

## 创作要求

- 主题：${request.topic}
- 类型：${request.contentType}
- 风格：${request.tone}
- 篇幅：${request.length}
${referenceNotes}${template}${referenceBlock ? `\n\n${referenceBlock}` : ""}`.trim();
  return seed;
}

function renderFixedBlock(content: string, article: Article, request: CreationRequest) {
  return content
    .replace(/\{\{title\}\}/g, article.title || request.title || request.topic)
    .replace(/\{\{topic\}\}/g, request.topic)
    .replace(/\{\{lead\}\}/g, request.topic)
    .replace(/\{\{project_name\}\}/g, "")
    .replace(/\{\{project_intro\}\}/g, "")
    .replace(/\{\{project_link\}\}/g, "")
    .replace(/\{\{star_cta\}\}/g, "")
    .replace(/\{\{[a-z][a-z0-9_]*\}\}/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function applyTemplateFixedBlocks(markdown: string, template: MarkdownTemplate | null, article: Article, request: CreationRequest) {
  if (!template) return markdown;
  let result = markdown.trim();
  const enabledBlocks = template.fixedBlocks.filter((block) => block.enabled && block.content.trim());
  for (const block of enabledBlocks) {
    const content = renderFixedBlock(block.content, article, request);
    if (!content || result.includes(content)) continue;
    const lines = result.split("\n");
    if (block.position === "before_title") {
      result = `${content}\n\n${result}`;
    } else if (block.position === "after_intro") {
      const titleIndex = lines.findIndex((line) => /^#\s+/.test(line));
      let insertion = titleIndex >= 0 ? titleIndex + 1 : 0;
      while (insertion < lines.length && !lines[insertion].trim()) insertion += 1;
      while (insertion < lines.length && lines[insertion].trim() && !/^#{1,6}\s+/.test(lines[insertion])) insertion += 1;
      lines.splice(insertion, 0, "", content, "");
      result = lines.join("\n");
    } else if (block.position === "before_closing") {
      const closingIndex = lines.map((line, index) => ({ line, index })).filter(({ line }) => /^#{1,6}\s+/.test(line) && /(结语|结论|总结|下一步|closing)/i.test(line)).at(-1)?.index;
      if (closingIndex === undefined) result = `${result}\n\n${content}`;
      else {
        lines.splice(closingIndex, 0, content, "");
        result = lines.join("\n");
      }
    } else {
      result = `${result}\n\n${content}`;
    }
  }
  return result.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function visualSourceLabel(source: VisualPlacementSummary["source"]) {
  return source === "existing_asset" ? "使用已选素材" : "生成新图片";
}

function VisualPlanConfirmationDialog({
  plan,
  assets,
  matchThreshold,
  onApprove,
  onSkip,
}: {
  plan: VisualCompositionPlanSummary;
  assets: MediaAsset[];
  matchThreshold: number;
  onApprove: (plan: VisualCompositionPlanSummary) => void;
  onSkip: () => void;
}) {
  const assetLookup = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset])),
    [assets],
  );
  const [decisions, setDecisions] = useState(() => Object.fromEntries(
    plan.placements.map((placement) => {
      const candidate = placement.candidates[0];
      const useAsset = Boolean(candidate && candidate.score / 10 >= matchThreshold);
      return [placement.id, {
        source: useAsset ? "existing_asset" : "generate",
        assetId: useAsset ? candidate.assetId : null,
      }];
    }),
  ) as Record<string, { source: "existing_asset" | "generate"; assetId: string | null }>);
  const generatedCount = Object.values(decisions).filter((decision) => decision.source === "generate").length;
  const approvedPlan = (): VisualCompositionPlanSummary => ({
    ...plan,
    settings: {
      ...plan.settings,
      material_match_threshold: String(matchThreshold),
    },
    placements: plan.placements.map((placement) => {
      const decision = decisions[placement.id];
      if (decision?.source === "existing_asset" && decision.assetId) {
        return {
          ...placement,
          source: "existing_asset",
          assetId: decision.assetId,
          selectionReason: `已按你的确认使用素材“${assetLookup.get(decision.assetId)?.name ?? decision.assetId}”。`,
        };
      }
      return {
        ...placement,
        source: "generate",
        assetId: null,
        selectionReason: "已按你的确认使用 AI 生图。",
      };
    }),
  });
  return (
    <div className="studio-modal" role="presentation">
      <button aria-label="暂不插入配图" className="studio-modal__scrim" onClick={onSkip} type="button" />
      <section aria-describedby="visual-plan-confirmation-copy" aria-label="确认正文配图方案" aria-modal="true" className="visual-confirmation-dialog" role="dialog">
        <header>
          <div>
            <span className="page-kicker">正文配图方案</span>
            <h2>确认后再开始生成</h2>
            <p id="visual-plan-confirmation-copy">系统按 {matchThreshold}% 匹配阈值给出默认方案。每张图都可以改用素材或 AI 生图。</p>
          </div>
          <button aria-label="暂不插入配图" className="icon-button" onClick={onSkip} type="button"><X size={18} /></button>
        </header>
        <div className="visual-confirmation-dialog__settings" aria-label="方案设置">
          <span>{plan.settings.type ?? "infographic"}</span>
          <span>{plan.settings.style ?? "sketch-notes"}</span>
          <span>{plan.settings.palette ?? "default"}</span>
          <span>素材阈值 {matchThreshold}%</span>
          <span>并发 {plan.settings.generation_batch_size ?? "4"}</span>
          <span>预计生图 {generatedCount} 张</span>
        </div>
        <ol className="visual-confirmation-dialog__list">
          {plan.placements.map((placement, index) => {
            const decision = decisions[placement.id];
            const selectedAssetId = decision?.assetId ?? placement.candidates[0]?.assetId ?? "";
            const selectedCandidate = placement.candidates.find((candidate) => candidate.assetId === selectedAssetId);
            const selectedAsset = selectedAssetId ? assetLookup.get(selectedAssetId) : null;
            return (
            <li key={placement.id}>
              <span className={`visual-confirmation-dialog__source is-${decision?.source ?? "generate"}`}><Image aria-hidden="true" size={14} /></span>
              <div>
                <div className="visual-confirmation-dialog__title"><strong>配图 {index + 1}</strong><small>{visualSourceLabel(decision?.source ?? "generate")}</small></div>
                <p>{placement.purpose}</p>
                <blockquote>{placement.anchorExcerpt ?? placement.afterHeading ?? "需要在文章页确认插入位置"}</blockquote>
                <div className="visual-confirmation-dialog__decision" role="radiogroup" aria-label={`配图 ${index + 1} 来源`}>
                  <label>
                    <input
                      checked={decision?.source === "existing_asset"}
                      disabled={placement.candidates.length === 0}
                      name={`visual-source-${placement.id}`}
                      onChange={() => setDecisions((current) => ({
                        ...current,
                        [placement.id]: { source: "existing_asset", assetId: selectedAssetId },
                      }))}
                      type="radio"
                    />
                    使用素材
                  </label>
                  <label>
                    <input
                      checked={decision?.source !== "existing_asset"}
                      name={`visual-source-${placement.id}`}
                      onChange={() => setDecisions((current) => ({
                        ...current,
                        [placement.id]: { source: "generate", assetId: null },
                      }))}
                      type="radio"
                    />
                    AI 生图
                  </label>
                </div>
                {placement.candidates.length > 0 && decision?.source === "existing_asset" && (
                  <label className="visual-confirmation-dialog__asset-select">
                    <span>选用素材</span>
                    <select
                      aria-label={`配图 ${index + 1} 素材`}
                      onChange={(event) => setDecisions((current) => ({
                        ...current,
                        [placement.id]: { source: "existing_asset", assetId: event.target.value },
                      }))}
                      value={selectedAssetId}
                    >
                      {placement.candidates.map((candidate) => (
                        <option key={candidate.assetId} value={candidate.assetId}>
                          {assetLookup.get(candidate.assetId)?.name ?? candidate.assetId} · {Math.round(candidate.score / 10)}%
                        </option>
                      ))}
                    </select>
                    {selectedAsset && <img alt={selectedAsset.alt || selectedAsset.name} src={selectedAsset.src} />}
                    {selectedCandidate && <small>{Math.round(selectedCandidate.score / 10)}% 匹配 · {selectedCandidate.description}</small>}
                  </label>
                )}
              </div>
            </li>
          )})}
        </ol>
        <footer>
          <button className="button button--quiet" onClick={onSkip} type="button">暂不配图</button>
          <button className="button button--primary" onClick={() => onApprove(approvedPlan())} type="button"><Check size={16} />确认并继续</button>
        </footer>
      </section>
    </div>
  );
}

export default function App() {
  const [activeNav, setActiveNav] = useState<NavKey>("create");
  const [theme, setTheme] = useState<Theme>(preferredTheme);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null);
  const [piRuntime, setPiRuntime] = useState<RuntimeSnapshot | null>(null);
  const [loadingArticles, setLoadingArticles] = useState(true);
  const [articleItems, setArticleItems] = useState<Article[]>([]);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [revisionIds, setRevisionIds] = useState<Record<string, string>>({});
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  // State updates are asynchronous. These refs are the serialization source
  // for local revisions, so a queued write always bases itself on the revision
  // committed immediately before it rather than on a stale render closure.
  const revisionIdsRef = useRef<Record<string, string>>({});
  const dirtyIdsRef = useRef<Set<string>>(new Set());
  const draftsRef = useRef<Record<string, string>>({});
  // Manual changes increment this counter synchronously. Async Agent work
  // compares its launch snapshot before it can render a result.
  const articleEditVersionRef = useRef<Record<string, number>>({});
  const writerSourceFenceRef = useRef<Record<string, WriterSourceFence>>({});
  const revisionSaveQueuesRef = useRef<Record<string, Promise<void>>>({});
  const activeRevisionSaveCountRef = useRef(0);
  const [workflowRunning, setWorkflowRunning] = useState(false);
  const [cancellingWorkflow, setCancellingWorkflow] = useState(false);
  const [creatingArticle, setCreatingArticle] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>(() => {
    const stored = loadStudioValue<unknown>(EDITOR_MODE_STORAGE_KEY, "split");
    return stored === "edit" || stored === "split" || stored === "preview" ? stored : "split";
  });
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformId>("wechat");
  const [disabledNodes, setDisabledNodes] = useState<Set<DisabledOptionalNodeId>>(() => {
    const defaultDisabled: DisabledOptionalNodeId[] = [
      "research",
      "outline",
      "natural-style",
      "review",
      "visual",
    ];
    const stored = loadStudioValue<unknown>(WORKFLOW_NODES_STORAGE_KEY, defaultDisabled);
    return new Set(Array.isArray(stored) ? stored.filter(isOptionalWorkflowNodeId) : defaultDisabled);
  });
  const [generatedImages, setGeneratedImages] = useState<Record<string, number>>({});
  const [generatingImage, setGeneratingImage] = useState(false);
  const [publishTargets, setPublishTargets] = useState<Set<PlatformId>>(
    () => new Set(["wechat", "csdn"]),
  );
  const [publishSession, setPublishSession] = useState<PublishSession | null>(null);
  const [publishAction, setPublishAction] = useState<PublishAction>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [modelConfiguration, setModelConfiguration] =
    useState<ModelConfigurationSummary | null>(null);
  const [modelProfiles, setModelProfiles] = useState<ModelProfileSummary[]>([]);
  const [modelTest, setModelTest] = useState<ModelConnectionTestSummary | null>(null);
  const [modelDiscovery, setModelDiscovery] = useState<PiModelDiscoverySummary | null>(null);
  const [modelDiscoveryError, setModelDiscoveryError] = useState<string | null>(null);
  const [modelDiscovering, setModelDiscovering] = useState(false);
  const [githubApplicationInfo, setGithubApplicationInfo] =
    useState<GitHubApplicationInfo | null>(null);
  const [githubApplicationLoading, setGithubApplicationLoading] = useState(false);
  const [githubApplicationError, setGithubApplicationError] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [configuringModel, setConfiguringModel] = useState(false);
  const [wechatSyncStatus, setWechatSyncStatus] =
    useState<WechatSyncBridgeStatus | null>(null);
  const [refreshingWechatSync, setRefreshingWechatSync] = useState(false);
  const lastKnownWechatSyncStatus = useRef<WechatSyncBridgeStatus | null>(null);
  const [creationActivity, setCreationActivity] =
    useState<CreationActivity | null>(loadCreationActivity);
  const [failedCreationContext, setFailedCreationContext] =
    useState<FailedCreationContext | null>(loadFailedCreationContext);
  const [workflowWorkspaces, setWorkflowWorkspaces] =
    useState<Record<string, WorkflowWorkspaceSnapshot>>(loadWorkflowWorkspaces);
  const [toast, setToast] = useState<string | null>(null);
  // Workflow roles are product internals. Users control enabled stages from Settings,
  // rather than managing prompts and Skill wiring as a separate workspace.
  const studioAgents = defaultAgents;
  const studioSkills = availableSkills;
  const [templates, setTemplates] = useState<MarkdownTemplate[]>(() =>
    loadTemplates(),
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(() => {
    const stored = loadStudioValue<unknown>(SELECTED_TEMPLATE_STORAGE_KEY, null);
    return typeof stored === "string" ? stored : null;
  });
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>(loadMediaAssets);
  const [mediaDatabaseReady, setMediaDatabaseReady] = useState(false);
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>(() => {
    const stored = loadStudioValue<unknown>(SELECTED_MEDIA_STORAGE_KEY, []);
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [];
  });
  const writerStreamRef = useRef<Record<string, string>>({});
  const writerTypewriterQueueRef = useRef<Record<string, WriterTypewriterQueue>>({});
  const writerTypewriterTimersRef = useRef<Record<string, number | undefined>>({});
  const writerDraftCompletedRef = useRef(new Set<string>());
  const [writerStreamingArticleId, setWriterStreamingArticleId] = useState<string | null>(null);
  const [articleProgress, setArticleProgress] = useState<ArticleProgress | null>(null);
  const [articleContentReplacing, setArticleContentReplacing] = useState(false);
  const [visualConfirmation, setVisualConfirmation] = useState<VisualConfirmationState | null>(null);
  const [rewriteUndoArticleId, setRewriteUndoArticleId] = useState<string | null>(null);
  const rewriteUndoRef = useRef<Record<string, { before: string; after: string }>>({});
  const lastWorkflowActivityAt = useRef(Date.now());
  const workflowExecutionSequenceRef = useRef(0);
  const activeWorkflowExecutionRef = useRef<{ articleId: string; id: number } | null>(null);
  const activeCreationRequestRef = useRef<FailedCreationContext | null>(null);
  const activePiRunRef = useRef<{ articleId: string; runId: string } | null>(null);
  const activePiRewriteRequestRef = useRef<{ articleId: string; requestId: string } | null>(null);
  const activePiRewriteRunRef = useRef<{
    articleId: string;
    requestId: string;
    runId: string;
  } | null>(null);
  // Visual planning, image rendering, and template extraction do not create a
  // durable Pi Run. Track their scoped runtime operation ids separately so
  // Stop cancels the actual provider request rather than only hiding its UI.
  const activePiOperationsRef = useRef(new Map<string, string | null>());
  const stoppedPiOperationsRef = useRef(new Set<string>());

  const beginPiOperation = (kind: string, articleId: string | null) => {
    const suffix = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const operationId = `operation:${kind}:${suffix}`;
    stoppedPiOperationsRef.current.delete(operationId);
    activePiOperationsRef.current.set(operationId, articleId);
    return operationId;
  };

  const finishPiOperation = (operationId: string) => {
    activePiOperationsRef.current.delete(operationId);
  };

  const ensurePiOperationCurrent = (operationId: string) => {
    if (stoppedPiOperationsRef.current.has(operationId)) {
      throw new Error(WORKFLOW_CANCELLED_BY_USER_MESSAGE);
    }
  };

  const cancelPiOperations = (articleId?: string) => {
    const operationIds = [...activePiOperationsRef.current]
      .filter(([, owner]) => articleId === undefined || owner === articleId)
      .map(([operationId]) => operationId);
    for (const operationId of operationIds) {
      stoppedPiOperationsRef.current.add(operationId);
      activePiOperationsRef.current.delete(operationId);
    }
    return Promise.allSettled(operationIds.map((operationId) => desktopBridge.stopPiOperation(operationId)));
  };

  useEffect(() => {
    revisionIdsRef.current = revisionIds;
  }, [revisionIds]);

  useEffect(() => {
    dirtyIdsRef.current = dirtyIds;
  }, [dirtyIds]);

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);

  const currentArticleMarkdown = (articleId: string, fallback = "") =>
    draftsRef.current[articleId] ?? fallback;

  const captureArticleSource = (
    articleId: string,
    markdown: string,
    revisionId = revisionIdsRef.current[articleId] ?? null,
  ): ArticleSourceSnapshot => ({
    articleId,
    markdown,
    revisionId,
    editVersion: articleEditVersionRef.current[articleId] ?? 0,
  });

  const isArticleSourceCurrent = (source: ArticleSourceSnapshot) =>
    (articleEditVersionRef.current[source.articleId] ?? 0) === source.editVersion &&
    currentArticleMarkdown(source.articleId, source.markdown) === source.markdown;

  const ensureArticleSourceCurrent = (source: ArticleSourceSnapshot) => {
    if (!isArticleSourceCurrent(source)) throw new Error(ASYNC_SOURCE_CHANGED);
  };

  const isWriterSourceCurrent = (source: WriterSourceFence) =>
    (articleEditVersionRef.current[source.articleId] ?? 0) === source.editVersion;

  const ensureWriterSourceCurrent = (source: WriterSourceFence) => {
    if (!isWriterSourceCurrent(source)) throw new Error(ASYNC_SOURCE_CHANGED);
  };

  const registerPiRewriteRun = (
    articleId: string,
    requestId: string,
    runId: string,
  ) => {
    const pending = activePiRewriteRequestRef.current;
    if (!pending || pending.articleId !== articleId || pending.requestId !== requestId) {
      return;
    }
    activePiRewriteRunRef.current = { articleId, requestId, runId };
  };

  const beginWorkflowExecution = (articleId: string) => {
    const id = ++workflowExecutionSequenceRef.current;
    activeWorkflowExecutionRef.current = { articleId, id };
    return id;
  };

  const isWorkflowExecutionCurrent = (articleId: string, id: number) =>
    activeWorkflowExecutionRef.current?.articleId === articleId &&
    activeWorkflowExecutionRef.current.id === id;

  const ensureWorkflowExecutionCurrent = (articleId: string, id: number) => {
    if (!isWorkflowExecutionCurrent(articleId, id)) {
      throw new Error(WORKFLOW_CANCELLED_BY_USER_MESSAGE);
    }
  };

  const finishWorkflowExecution = (articleId: string, id: number) => {
    if (!isWorkflowExecutionCurrent(articleId, id)) return false;
    activeWorkflowExecutionRef.current = null;
    return true;
  };

  const showArticleProgress = (progress: ArticleProgress) => {
    setArticleProgress(progress);
  };

  const requestVisualConfirmation = (
    articleId: string,
    plan: VisualCompositionPlanSummary | null,
    matchThreshold: number,
    assets: MediaAsset[],
  ) => {
    if (!plan || plan.targetCount === 0) return Promise.resolve(plan);
    if (!plan.needsConfirmation) return Promise.resolve(plan);
    return new Promise<VisualCompositionPlanSummary | null>((resolve) => {
      setVisualConfirmation({ articleId, plan, assets, matchThreshold, resolve });
    });
  };

  const resolveVisualConfirmation = (plan: VisualCompositionPlanSummary | null) => {
    const pending = visualConfirmation;
    setVisualConfirmation(null);
    pending?.resolve(plan);
  };

  const beginWorkflowWorkspace = (articleId: string) => {
    setWorkflowWorkspaces((current) => ({
      ...current,
      [articleId]: {
        runId: null,
        status: "running",
        events: [],
        artifacts: [],
        visualPlan: null,
        error: null,
        updatedAt: Date.now(),
      },
    }));
  };

  const appendWorkflowWorkspaceEvents = (
    articleId: string,
    runId: string,
    incoming: WorkflowActivityEvent[],
  ) => {
    if (incoming.length === 0) return;
    setWorkflowWorkspaces((current) => {
      const existing = current[articleId];
      const deduplicated = new Map(
        [...(existing?.events ?? []), ...incoming].map((event) => [event.id, event]),
      );
      return {
        ...current,
        [articleId]: {
          runId,
          status: "running",
          events: Array.from(deduplicated.values()).slice(-160),
          artifacts: existing?.artifacts ?? [],
          visualPlan: existing?.visualPlan ?? null,
          error: null,
          updatedAt: Date.now(),
        },
      };
    });
  };

  const completeWorkflowWorkspace = (articleId: string, summary: RunWorkflowSummary) => {
    setWorkflowWorkspaces((current) => {
      const existing = current[articleId];
      return {
        ...current,
        [articleId]: {
          runId: summary.runId,
          status: "completed",
          events: existing?.events ?? [],
          artifacts: summary.artifacts,
          visualPlan: summary.visualPlan,
          error: null,
          updatedAt: Date.now(),
        },
      };
    });
  };

  const failWorkflowWorkspace = (articleId: string, error: string) => {
    setWorkflowWorkspaces((current) => {
      const existing = current[articleId];
      return {
        ...current,
        [articleId]: {
          runId: existing?.runId ?? null,
          status: "failed",
          events: existing?.events ?? [],
          artifacts: existing?.artifacts ?? [],
          visualPlan: existing?.visualPlan ?? null,
          error: sanitizeActivityMessage(error).slice(0, 500),
          updatedAt: Date.now(),
        },
      };
    });
  };

  const configuredPlatforms = useMemo(
    () => {
      const bridgePlatforms = wechatSyncStatus?.platforms ?? [];
      const bridgeById = new Map(bridgePlatforms.map((platform) => [platform.id, platform]));
      const known = platforms.map((platform) => {
        const bridge = bridgeById.get(platform.id);
        return {
          ...platform,
          status: bridge?.authenticated ? "connected" as const : platform.status,
          accountLabel: bridge?.accountLabel ?? null,
        };
      });
      const additions = bridgePlatforms
        .filter((platform) => !known.some((candidate) => candidate.id === platform.id))
        .map((platform) => ({
          ...platformDefinitionFor(platform.id),
          status: platform.authenticated ? "connected" as const : "not_connected" as const,
          accountLabel: platform.accountLabel,
        }));
      return [...known, ...additions];
    },
    [wechatSyncStatus],
  );

  const publishablePlatforms = useMemo(
    () => configuredPlatforms.filter((platform) => platform.status === "connected"),
    [configuredPlatforms],
  );

  const selectedArticle =
    articleItems.find((article) => article.id === selectedArticleId) ?? null;
  const currentMarkdown = selectedArticle
    ? drafts[selectedArticle.id] ?? selectedArticle.markdown
    : "";
  const dirty = selectedArticle ? dirtyIds.has(selectedArticle.id) : false;
  const selectedTemplate =
    templates.find((template) => template.id === selectedTemplateId) ?? null;
  const selectedMedia = mediaAssets.filter((asset) => selectedMediaIds.includes(asset.id));
  const currentPublishSession =
    selectedArticle && publishSession?.articleId === selectedArticle.id
      ? publishSession
      : null;
  const publishSessionStale = Boolean(
    currentPublishSession &&
      (dirty || revisionIds[currentPublishSession.articleId] !== currentPublishSession.revisionId),
  );

  const requireTextModel = () => {
    if (!piRuntime) {
      setToast("正在检查本地运行时和模型连接，请稍候再开始创作。");
      return false;
    }
    if (piRuntime.bridgeMode !== "pi_sidecar") {
      const message = "当前是浏览器预览，无法调用本地 Agent。请在 Open Publisher 桌面应用中执行。";
      setModelError(message);
      setActiveNav("settings");
      setToast(message);
      return false;
    }
    if (!modelConfiguration?.secretConfigured) {
      const message = "请先在设置中保存并测试文本模型连接，再开始创作。";
      setModelError(message);
      setActiveNav("settings");
      setToast(message);
      return false;
    }
    return true;
  };

  const requireImageModel = () => {
    if (!requireTextModel()) return false;
    if (
      !modelConfiguration?.imageBaseUrl ||
      !modelConfiguration.imageModel ||
      !modelConfiguration.imageSecretConfigured
    ) {
      const message = "请先在设置的“生图模型”中完成图片 API 与模型配置。";
      setModelError(message);
      setActiveNav("settings");
      setToast(message);
      return false;
    }
    return true;
  };

  const refreshWechatSyncStatus = useCallback(async (forceRefresh = false) => {
    if (runtime?.bridgeMode === "interface_only") return;
    setRefreshingWechatSync(true);
    try {
      const next = await desktopBridge.wechatSyncStatus({ forceRefresh });
      if (next.available && next.connected && next.platforms.length > 0) {
        lastKnownWechatSyncStatus.current = next;
        setWechatSyncStatus({ ...next, stale: false });
        return;
      }
      const previous = lastKnownWechatSyncStatus.current;
      if (previous && (!next.available || !next.connected || next.platforms.length === 0)) {
        // Keep an explicitly stale read-only snapshot visible during a bridge
        // reconnect. It never enables publishing or pretends accounts are fresh.
        setWechatSyncStatus({
          ...previous,
          available: next.available,
          connected: next.connected,
          stale: true,
          detail: next.detail,
        });
        return;
      }
      setWechatSyncStatus({ ...next, stale: false });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const previous = lastKnownWechatSyncStatus.current;
      setWechatSyncStatus(previous
        ? {
            ...previous,
            available: false,
            connected: false,
            stale: true,
            detail: `无法读取 WechatSync 状态：${detail.slice(0, 140)}`,
          }
        : {
            available: false,
            connected: false,
            stale: false,
            detail: `无法读取 WechatSync 状态：${detail.slice(0, 140)}`,
            platforms: [],
          });
    } finally {
      setRefreshingWechatSync(false);
    }
  }, [runtime?.bridgeMode]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    replaceStudioTextValue("open-publisher-theme", theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const snapshot = await desktopBridge.piRuntimeSnapshot();
        if (cancelled) return;
        setRuntime(snapshot);
        const [storedArticles, configuration, profiles, piSnapshot] = await Promise.all([
          desktopBridge.listArticles(),
          desktopBridge.modelConfiguration(),
          desktopBridge.listModelProfiles(),
          desktopBridge.piRuntimeSnapshot(),
        ]);
        if (cancelled) return;
        setModelConfiguration(configuration);
        setModelProfiles(profiles);
        setPiRuntime(piSnapshot);
        setRuntime(piSnapshot);
        const loaded = storedArticles.map(storedArticleToArticle);
        setArticleItems((current) => [
          ...current,
          ...loaded.filter(
            (loadedArticle) =>
              !current.some((article) => article.id === loadedArticle.id),
          ),
        ]);
        setDrafts((current) => ({
          ...Object.fromEntries(loaded.map((article) => [article.id, article.markdown])),
          ...current,
        }));
        setRevisionIds((current) => ({
          ...Object.fromEntries(
            loaded
              .filter((article) => article.revisionId)
              .map((article) => [article.id, article.revisionId as string]),
          ),
          ...current,
        }));
        setSelectedArticleId((current) => current ?? loaded[0]?.id ?? null);
        if (loaded[0]) setPublishTargets(new Set(loaded[0].channels));
        const readySnapshot = await desktopBridge.piRuntimeSnapshot();
        if (!cancelled) {
          setRuntime(readySnapshot);
          setPiRuntime(readySnapshot);
        }
        if (readySnapshot.bridgeMode !== "interface_only") {
          const publisherStatus = await desktopBridge.wechatSyncStatus();
          if (!cancelled) {
            if (publisherStatus.available && publisherStatus.connected && publisherStatus.platforms.length > 0) {
              lastKnownWechatSyncStatus.current = publisherStatus;
            }
            setWechatSyncStatus({ ...publisherStatus, stale: false });
          }
        }
      } catch (error) {
        if (cancelled) return;
        const detail = error instanceof Error ? error.message : String(error);
        setToast(`本地数据加载失败：${detail.slice(0, 120)}`);
      } finally {
        if (!cancelled) setLoadingArticles(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!creationActivity) {
      removeStudioValue(CREATION_ACTIVITY_STORAGE_KEY);
      return;
    }
    replaceStudioValue(
      CREATION_ACTIVITY_STORAGE_KEY,
      creationActivity,
    );
  }, [creationActivity]);

  useEffect(() => {
    if (!failedCreationContext) {
      removeStudioValue(FAILED_CREATION_STORAGE_KEY);
      return;
    }
    const persisted = replaceStudioValue(
      FAILED_CREATION_STORAGE_KEY,
      persistedFailedCreationContext(failedCreationContext),
    );
    if (!persisted) {
      setToast("失败记录未写入浏览器缓存；当前文章和本次重试仍可用。");
    }
  }, [failedCreationContext]);

  useEffect(() => {
    if (!replaceStudioValue(TEMPLATES_STORAGE_KEY, templates)) {
      setToast("模板缓存空间不足；本次编辑仍保留，建议减少过大的参考模板。");
    }
    if (selectedTemplateId && !templates.some((template) => template.id === selectedTemplateId)) {
      setSelectedTemplateId(null);
    }
  }, [selectedTemplateId, templates]);

  useEffect(() => {
    replaceStudioValue(SELECTED_TEMPLATE_STORAGE_KEY, selectedTemplateId);
  }, [selectedTemplateId]);

  useEffect(() => {
    replaceStudioValue(SELECTED_MEDIA_STORAGE_KEY, selectedMediaIds);
  }, [selectedMediaIds]);

  useEffect(() => {
    replaceStudioValue(EDITOR_MODE_STORAGE_KEY, editorMode);
  }, [editorMode]);

  useEffect(() => {
    replaceStudioValue(WORKFLOW_NODES_STORAGE_KEY, [...disabledNodes]);
  }, [disabledNodes]);

  useEffect(() => {
    if (!replaceStudioValue(
      WORKFLOW_WORKSPACES_STORAGE_KEY,
      workflowWorkspaces,
    )) {
      setToast("执行记录未写入浏览器缓存；文章和运行状态不受影响。");
    }
  }, [workflowWorkspaces]);

  useEffect(() => {
    let cancelled = false;
    const loadMedia = async () => {
      try {
        const legacyAssets = loadMediaAssets();
        const databaseAssets = (await loadMediaAssetsFromDatabase()).map(normalizeMediaAsset);
        const merged = new Map(databaseAssets.map((asset) => [asset.id, asset]));
        for (const asset of legacyAssets) merged.set(asset.id, asset);
        const assets = [...merged.values()];
        if (legacyAssets.length > 0) {
          await saveMediaAssetsToDatabase(legacyAssets);
          window.localStorage.removeItem(MEDIA_STORAGE_KEY);
        }
        if (!cancelled) {
          // Imports can finish before IndexedDB hydration. Preserve those
          // in-memory assets instead of replacing them with an older snapshot.
          setMediaAssets((current) => {
            const combined = new Map(assets.map((asset) => [asset.id, asset]));
            current.forEach((asset) => combined.set(asset.id, asset));
            return [...combined.values()];
          });
        }
      } catch (error) {
        if (!cancelled) {
          const detail = error instanceof Error ? error.message : String(error);
          setToast(`本地素材数据库不可用：${detail.slice(0, 80)}`);
        }
      } finally {
        if (!cancelled) setMediaDatabaseReady(true);
      }
    };
    void loadMedia();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mediaDatabaseReady) return;
    void saveMediaAssetsToDatabase(mediaAssets).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      setToast(`素材保存失败：${detail.slice(0, 80)}`);
    });
    setSelectedMediaIds((current) => current.filter((id) => mediaAssets.some((asset) => asset.id === id)));
  }, [mediaAssets, mediaDatabaseReady]);

  useEffect(() => {
    if (!selectedArticle) return;
    const compacted = compactInlineDataImages(currentMarkdown, mediaAssets);
    if (compacted.markdown === currentMarkdown) return;
    if (compacted.createdAssets.length > 0) {
      setMediaAssets((current) => [
        ...compacted.createdAssets,
        ...current.filter(
          (asset) => !compacted.createdAssets.some((created) => created.id === asset.id),
        ),
      ]);
    }
    const articleId = selectedArticle.id;
    setDrafts((current) => {
      const next = { ...current, [articleId]: compacted.markdown };
      draftsRef.current = next;
      return next;
    });
    setArticleItems((current) =>
      current.map((article) =>
        article.id === articleId
          ? {
              ...article,
              title: titleFromMarkdown(compacted.markdown, article.title),
              deck: deckFromMarkdown(compacted.markdown),
              wordCount: compacted.markdown.replace(/\s/g, "").length,
            }
          : article,
      ),
    );
    setDirtyIds((current) => {
      const next = new Set(current).add(articleId);
      dirtyIdsRef.current = next;
      return next;
    });
    setToast("已将文章中的内嵌图片迁入素材库，请保存文章。");
  }, [currentMarkdown, mediaAssets, selectedArticle]);

  useEffect(() => {
    if (creationActivity?.status !== "running") return;
    const interval = window.setInterval(() => {
      setCreationActivity((current) => {
        if (!current || current.status !== "running") return current;
        const elapsedSeconds = Math.max(
          current.elapsedSeconds,
          Math.round((Date.now() - current.startedAt) / 1000),
        );
        return { ...current, elapsedSeconds };
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [creationActivity?.status, creationActivity?.startedAt]);

  const replaceArticleContent = (
    articleId: string,
    markdown: string,
    animate = true,
  ) => {
    if (animate) setArticleContentReplacing(true);
    // Keep the synchronous source fence in lockstep with the rendered state;
    // React may batch the following state update past an awaited Agent step.
    draftsRef.current = { ...draftsRef.current, [articleId]: markdown };
    setDrafts((current) => {
      const next = { ...current, [articleId]: markdown };
      draftsRef.current = next;
      return next;
    });
    setArticleItems((current) =>
      current.map((article) =>
        article.id === articleId
          ? {
              ...article,
              title: titleFromMarkdown(markdown, article.title),
              deck: deckFromMarkdown(markdown),
              markdown,
              wordCount: markdown.replace(/\s/g, "").length,
            }
          : article,
      ),
    );
    if (animate) window.setTimeout(() => setArticleContentReplacing(false), 260);
  };

  const clearWriterTypewriter = (articleId: string, clearRendered = false) => {
    const frame = writerTypewriterTimersRef.current[articleId];
    if (frame !== undefined) cancelWriterFrame(frame);
    delete writerTypewriterTimersRef.current[articleId];
    delete writerTypewriterQueueRef.current[articleId];
    writerDraftCompletedRef.current.delete(articleId);
    if (clearRendered) delete writerStreamRef.current[articleId];
    setWriterStreamingArticleId((current) => (current === articleId ? null : current));
  };

  const completeWriterTypewriterIfDrained = (articleId: string) => {
    const queue = writerTypewriterQueueRef.current[articleId];
    if (queue && queue.nextIndex < queue.characters.length) return;
    if (!writerDraftCompletedRef.current.has(articleId)) return;
    writerDraftCompletedRef.current.delete(articleId);
    setWriterStreamingArticleId((current) => (current === articleId ? null : current));
  };

  const waitForWriterTypewriterDrain = async (
    articleId: string,
    executionId: number,
  ) => {
    // The canonical revision can arrive before its visual character queue has
    // finished. Waiting here avoids a late frame replacing the saved article
    // with a partial prefix after a workflow has already moved to the next
    // stage.
    while (true) {
      ensureWorkflowExecutionCurrent(articleId, executionId);
      const source = writerSourceFenceRef.current[articleId];
      if (!source || source.executionId !== executionId) {
        throw new Error(ASYNC_SOURCE_CHANGED);
      }
      ensureWriterSourceCurrent(source);
      const queue = writerTypewriterQueueRef.current[articleId];
      if (!queue || queue.nextIndex >= queue.characters.length) {
        completeWriterTypewriterIfDrained(articleId);
        return;
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
    }
  };

  const scheduleWriterTypewriter = (articleId: string) => {
    if (writerTypewriterTimersRef.current[articleId] !== undefined) return;
    writerTypewriterTimersRef.current[articleId] = requestWriterFrame(() => {
      delete writerTypewriterTimersRef.current[articleId];
      const source = writerSourceFenceRef.current[articleId];
      if (!source || !isWriterSourceCurrent(source)) {
        clearWriterTypewriter(articleId);
        return;
      }
      const queued = writerTypewriterQueueRef.current[articleId];
      if (!queued || queued.nextIndex >= queued.characters.length) {
        delete writerTypewriterQueueRef.current[articleId];
        completeWriterTypewriterIfDrained(articleId);
        return;
      }

      // Never turn an upstream delta into a paragraph-sized visual jump.
      // The queue is indexed rather than sliced so a long article remains
      // linear-time while preserving the one-character-per-frame effect.
      const renderedDelta = queued.characters[queued.nextIndex++] ?? "";
      const markdown = `${writerStreamRef.current[articleId] ?? ""}${renderedDelta}`;
      writerStreamRef.current[articleId] = markdown;
      setDrafts((current) => {
        const next = { ...current, [articleId]: markdown };
        draftsRef.current = next;
        return next;
      });

      const remaining = queued.nextIndex < queued.characters.length;
      if (markdown.replace(/\s/g, "").length % 36 < renderedDelta.replace(/\s/g, "").length || !remaining) {
        showArticleProgress({
          articleId,
          title: "正在撰写正文",
          detail: `已完成 ${markdown.replace(/\s/g, "").length} 字。`,
          value: null,
        });
      }
      if (remaining) {
        scheduleWriterTypewriter(articleId);
      } else {
        completeWriterTypewriterIfDrained(articleId);
      }
    });
  };

  useEffect(
    () => () => {
      Object.values(writerTypewriterTimersRef.current).forEach((timer) => {
        if (timer !== undefined) cancelWriterFrame(timer);
      });
      writerTypewriterTimersRef.current = {};
      writerTypewriterQueueRef.current = {};
      writerDraftCompletedRef.current.clear();
    },
    [],
  );

  const receiveWorkflowActivity = (
    articleId: string,
    event: WorkflowActivityEvent,
    agents: WorkflowAgentInstruction[],
  ) => {
    const agent = event.nodeId ? workflowAgentLabel(event.nodeId, agents) : "本地 Agent";
    if (
      event.eventType === "run.node_output_delta" &&
      event.nodeId === "draft" &&
      event.draftDelta
    ) {
      lastWorkflowActivityAt.current = Date.now();
      const queue = writerTypewriterQueueRef.current[articleId] ?? {
        characters: [],
        nextIndex: 0,
      };
      queue.characters.push(...Array.from(event.draftDelta));
      writerTypewriterQueueRef.current[articleId] = queue;
      scheduleWriterTypewriter(articleId);
      showArticleProgress({
        articleId,
        title: "正在撰写正文",
        detail: "文章内容正在持续生成。",
        value: null,
      });
      return;
    }
    lastWorkflowActivityAt.current = Date.now();
    if (event.eventType === "run.node_started" && event.nodeId === "draft") {
      clearWriterTypewriter(articleId, true);
      setWriterStreamingArticleId(articleId);
      showArticleProgress({
        articleId,
        title: "正在撰写正文",
        detail: "正在准备正文内容。",
        value: null,
      });
      replaceArticleContent(articleId, "", false);
      return;
    }
    if (event.eventType === "run.node_completed" && event.nodeId === "draft") {
      writerDraftCompletedRef.current.add(articleId);
      completeWriterTypewriterIfDrained(articleId);
      return;
    }
    if (event.eventType === "run.node_started" && event.nodeId) {
      showArticleProgress({
        articleId,
        title: `${agent} 正在处理文章`,
        detail: "完成后会用新的内容平滑替换当前正文。",
        value: null,
      });
    }
  };

  useEffect(() => {
    if (!selectedArticle) return;
    setPublishTargets(new Set(selectedArticle.channels));
    setPublishError(null);
  }, [selectedArticle?.id]);

  const navigate = (nav: NavKey) => {
    setActiveNav(nav);
    setMobileNavOpen(false);
  };

  const selectArticle = (articleId: string) => {
    setSelectedArticleId(articleId);
    setMobileNavOpen(false);
  };

  const updateArticleMarkdown = (markdown: string) => {
    if (!selectedArticle) return;
    articleEditVersionRef.current[selectedArticle.id] =
      (articleEditVersionRef.current[selectedArticle.id] ?? 0) + 1;
    // The editor remains usable while an Agent runs. Stop the visual
    // typewriter immediately; its execution fence will turn the late result
    // into a recoverable failure instead of replacing this manual edit.
    const hasWriterFence = Boolean(writerSourceFenceRef.current[selectedArticle.id]);
    const hasArticleOperation = [...activePiOperationsRef.current.values()]
      .some((owner) => owner === selectedArticle.id);
    if (hasWriterFence) {
      clearWriterTypewriter(selectedArticle.id);
      const activeRun = activePiRunRef.current;
      if (activeRun?.articleId === selectedArticle.id) {
        // Do not wait for the model loop to notice the stale local snapshot.
        // A manual keystroke means its pending commit must be aborted now;
        // the source fence below remains the final protection if the provider
        // has already produced a late response.
        activePiRunRef.current = null;
        void desktopBridge.stopPiRun(activeRun.runId).catch(() => undefined);
      }
    }
    if (hasWriterFence || hasArticleOperation) {
      void cancelPiOperations(selectedArticle.id);
    }
    const compacted = compactInlineDataImages(markdown, mediaAssets);
    const nextMarkdown = compacted.markdown;
    if (compacted.createdAssets.length > 0) {
      setMediaAssets((current) => [
        ...compacted.createdAssets,
        ...current.filter(
          (asset) => !compacted.createdAssets.some((created) => created.id === asset.id),
        ),
      ]);
    }
    const nextTitle = titleFromMarkdown(nextMarkdown, selectedArticle.title);
    setDrafts((current) => {
      const next = { ...current, [selectedArticle.id]: nextMarkdown };
      draftsRef.current = next;
      return next;
    });
    setArticleItems((current) =>
      current.map((article) =>
        article.id === selectedArticle.id
          ? {
              ...article,
              title: nextTitle,
              deck: deckFromMarkdown(nextMarkdown),
              wordCount: nextMarkdown.replace(/\s/g, "").length,
            }
          : article,
      ),
    );
    setDirtyIds((current) => {
      const next = new Set(current).add(selectedArticle.id);
      dirtyIdsRef.current = next;
      return next;
    });
  };

  const insertSelectedMediaInArticle = () => {
    if (!selectedArticle || selectedMedia.length === 0) {
      setToast("请先选择一篇文章和至少一张图片");
      return;
    }
    const additions = selectedMedia
      .map((asset) => `![${asset.alt}](${mediaMarkdownReference(asset)})`)
      .join("\n\n");
    updateArticleMarkdown(`${currentMarkdown.trim()}\n\n${additions}\n`);
    setActiveNav("articles");
    setToast(`已插入 ${selectedMedia.length} 张图片，请在编辑器中调整位置和说明`);
  };

  const createLocalMediaAsset = async (file: File): Promise<MediaAsset> => {
    const src = await readLocalImage(file);
    const name = baseName(file.name);
    return {
      id: newLocalId("media"),
      name,
      alt: name,
      description: "",
      visualDescription: "",
      usageHint: "",
      generationPrompt: "",
      tags: [],
      descriptionSource: "manual",
      src,
      source: "uploaded",
      createdAt: "刚刚导入",
    };
  };

  const addMediaAsset = (asset: MediaAsset) => {
    setMediaAssets((current) => [
      asset,
      ...current.filter((existing) => existing.id !== asset.id),
    ]);
  };

  const updateMediaAsset = (asset: MediaAsset) => {
    setMediaAssets((current) =>
      current.map((existing) => (existing.id === asset.id ? asset : existing)),
    );
  };

  const importImageIntoArticle = async (file: File) => {
    const asset = await createLocalMediaAsset(file);
    addMediaAsset(asset);
    return { alt: asset.alt, src: mediaMarkdownReference(asset) };
  };

  const persistRevision = async (
    articleId: string,
    markdown: string,
    announce: boolean,
    baseRevisionOverride?: string | null,
  ) => {
    // Editor autosave, an explicit save, image insertion, and AI edits can
    // finish in a different order from the order in which the user started
    // them. Serialize writes per article and resolve the default base revision
    // inside the queue so each CAS write uses the latest committed revision.
    const previous = revisionSaveQueuesRef.current[articleId] ?? Promise.resolve();
    activeRevisionSaveCountRef.current += 1;
    setSaving(true);
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        const receipt = await desktopBridge.saveDraft({
          articleId,
          baseRevision: baseRevisionOverride === undefined
            ? revisionIdsRef.current[articleId] ?? null
            : baseRevisionOverride,
          markdown,
        });
        // A save may finish after the user has typed more text. Persisting an
        // older revision is still useful (and advances the CAS base), but it
        // must never replace the newer local draft in the editor.
        const shouldApplyToEditor =
          currentArticleMarkdown(articleId, markdown) === markdown;
        setRevisionIds((current) => {
          const next = { ...current, [articleId]: receipt.revisionId };
          revisionIdsRef.current = next;
          return next;
        });
        if (shouldApplyToEditor) {
          setDrafts((current) => {
            const next = { ...current, [articleId]: markdown };
            draftsRef.current = next;
            return next;
          });
        }
        setArticleItems((current) =>
          current.map((article) =>
            article.id === articleId
              ? shouldApplyToEditor
                ? {
                    ...article,
                    title: titleFromMarkdown(markdown, article.title),
                    deck: deckFromMarkdown(markdown),
                    markdown,
                    updatedAt: "刚刚",
                    wordCount: markdown.replace(/\s/g, "").length,
                    revisionId: receipt.revisionId,
                    revisionNumber: (article.revisionNumber ?? 0) + 1,
                  }
                : {
                    ...article,
                    revisionId: receipt.revisionId,
                    revisionNumber: (article.revisionNumber ?? 0) + 1,
                  }
              : article,
          ),
        );
        setDirtyIds((current) => {
          const next = new Set(current);
          // Do not mark a newer keystroke as saved just because an earlier
          // autosave completed after it.
          if (draftsRef.current[articleId] === markdown) next.delete(articleId);
          else next.add(articleId);
          dirtyIdsRef.current = next;
          return next;
        });
        if (announce) {
          setToast(
            receipt.persistence === "memory"
              ? "文章已保存到浏览器演示会话"
              : "文章已保存到本地数据库",
          );
        }
        return receipt.revisionId;
      });
    const settled = operation.then(
      () => undefined,
      () => undefined,
    );
    revisionSaveQueuesRef.current[articleId] = settled;
    try {
      return await operation;
    } finally {
      if (revisionSaveQueuesRef.current[articleId] === settled) {
        delete revisionSaveQueuesRef.current[articleId];
      }
      activeRevisionSaveCountRef.current = Math.max(
        0,
        activeRevisionSaveCountRef.current - 1,
      );
      setSaving(activeRevisionSaveCountRef.current > 0);
    }
  };

  const ensureRevision = async (articleId: string, markdown: string) => {
    const revisionId = revisionIdsRef.current[articleId];
    if (revisionId && !dirtyIdsRef.current.has(articleId)) return revisionId;
    return persistRevision(articleId, markdown, false);
  };

  useEffect(() => {
    if (!selectedArticle || !dirty || saving || workflowRunning) return;
    const articleId = selectedArticle.id;
    const markdown = currentMarkdown;
    const timeout = window.setTimeout(() => {
      void persistRevision(articleId, markdown, false).catch((error) => {
        const detail = error instanceof Error ? error.message : String(error);
        setToast(`自动保存失败：${detail.slice(0, 100)}`);
      });
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [currentMarkdown, dirty, saving, selectedArticle?.id, workflowRunning]);

  const applyWorkflowResult = (
    articleId: string,
    summary: RunWorkflowSummary,
    channels?: PlatformId[],
  ) => {
    const outputMarkdown = summary.outputMarkdown;
    const nextTitle = titleFromMarkdown(outputMarkdown);
    setRevisionIds((current) => {
      const next = { ...current, [articleId]: summary.outputRevisionId };
      revisionIdsRef.current = next;
      return next;
    });
    setDrafts((current) => {
      const next = { ...current, [articleId]: outputMarkdown };
      draftsRef.current = next;
      return next;
    });
    setArticleItems((current) =>
      current.map((article) =>
        article.id === articleId
          ? {
              ...article,
              title: nextTitle,
              deck: deckFromMarkdown(outputMarkdown),
              markdown: outputMarkdown,
              status: "review",
              updatedAt: "刚刚",
              wordCount: outputMarkdown.replace(/\s/g, "").length,
              channels: channels ?? article.channels,
              revisionId: summary.outputRevisionId,
              revisionNumber: summary.outputRevisionNumber,
            }
          : article,
      ),
    );
    setDirtyIds((current) => {
      const next = new Set(current);
      next.delete(articleId);
      dirtyIdsRef.current = next;
      return next;
    });
  };

  const appendCreationActivity = (
    phase: string,
    id: string,
    message: string,
    tone: CreationLogEntry["tone"] = "info",
  ) => {
    setCreationActivity((current) =>
      current && current.status === "running"
        ? {
            ...current,
            phase,
            logs: [...current.logs, activityLog(id, message, tone)],
          }
        : current,
    );
  };

  const composeVisualPlan = async (
    article: Article,
    summary: RunWorkflowSummary,
    plan: VisualCompositionPlanSummary,
    request: CreationRequest,
    startedAt: number,
    ensureCurrent: () => void,
  ) => {
    ensureCurrent();
    if (request.imagePlan.mode === "none") {
      return {
        revisionId: summary.outputRevisionId,
        revisionNumber: summary.outputRevisionNumber,
        markdown: summary.outputMarkdown,
        generatedCount: 0,
      };
    }

    if (plan.placements.length !== plan.targetCount) {
      throw new Error("视觉 Agent 返回的配图数量无效，文章未插入图片。请重试本次生成。");
    }
    if (plan.sourceRevisionHash !== summary.outputContentHash) {
      throw new Error("配图方案已不对应当前文章版本，未开始生图。请重新生成配图方案。");
    }

    appendCreationActivity(
      "正在按文章结构编排配图",
      `visual-plan-received-${startedAt}`,
      plan.targetCount > 0
        ? `视觉 Agent 已规划 ${plan.targetCount} 张正文配图`
        : "视觉 Agent 判断本文不需要正文配图",
      "success",
    );

    const selectedAssets = new Map(
      request.imageAssets.map((asset) => [asset.id, asset]),
    );
    const generatedAssets: MediaAsset[] = [];
    // The confirmation dialog can override the Agent's default material choice.
    // Progress must follow the approved source, rather than the pre-confirmation
    // asset id that happened to be present in the original plan.
    const generatedCount = plan.placements.filter(
      (placement) => placement.source !== "existing_asset",
    ).length;
    let completedCount = 0;
    const updateVisualProgress = (detail: string) => {
      completedCount += 1;
      showArticleProgress({
        articleId: article.id,
        title: generatedCount > 0 ? "正在生成正文配图" : "正在插入素材库图片",
        detail,
        value: plan.targetCount ? Math.round((completedCount / plan.targetCount) * 86) : 86,
      });
    };
    if (plan.targetCount > 0) {
      showArticleProgress({
        articleId: article.id,
        title: generatedCount > 0 ? "正在生成正文配图" : "正在插入素材库图片",
        detail: generatedCount > 0
          ? `已同时启动 ${generatedCount} 个生图任务。`
          : `正在按文章结构安排 ${plan.targetCount} 张已选素材。`,
        value: 8,
      });
    }
    const executePlacement = async (placement: VisualPlacementSummary, index: number) => {
        if (placement.assetId) {
          const asset = selectedAssets.get(placement.assetId);
          if (!asset) {
            throw new Error("视觉 Agent 选择了当前创作请求中不存在的素材图片。");
          }
          updateVisualProgress(`已安排素材 ${index + 1}/${plan.targetCount}`);
          return { placement, asset };
        }
        if (!placement.generationPrompt) {
          throw new Error("视觉 Agent 未为缺失素材提供可执行的生图提示词。");
        }
        appendCreationActivity(
          `正在生成配图 ${index + 1}/${plan.targetCount}`,
          `visual-generation-started-${startedAt}-${index}`,
          `正在从已保存的 ${placement.promptFile ?? "Prompt 文件"} 生成第 ${index + 1} 张配图`,
        );
        const operationId = beginPiOperation("creation-image", article.id);
        let result;
        try {
          result = await desktopBridge.generateImage({
            operationId,
            prompt: placement.generationPrompt,
            size: "1536x1024",
            model: modelConfiguration?.imageModel ?? null,
          });
        } finally {
          finishPiOperation(operationId);
        }
        ensurePiOperationCurrent(operationId);
        ensureCurrent();
        const image = result.images[0];
        if (!image) {
          throw new Error(`第 ${index + 1} 张配图未返回可保存的图片数据。`);
        }
        const asset: MediaAsset = {
          id: `generated-${image.id}`,
          name: `${article.title} 正文配图 ${index + 1}`.slice(0, 120),
          alt: escapeImageAlt(placement.alt),
          description: `由 AI 根据文章小节“${placement.afterHeading ?? "文章核心观点"}”生成。`,
          visualDescription: placement.alt,
          usageHint: `适合插入“${placement.afterHeading ?? "文章核心观点"}”之后，用于补充正文说明。`,
          generationPrompt: placement.generationPrompt,
          tags: ["AI 生成", "正文配图"],
          descriptionSource: "generation_prompt",
          src: image.dataUrl,
          source: "generated",
          createdAt: "刚刚生成",
        };
        generatedAssets.push(asset);
        updateVisualProgress(`已完成配图 ${completedCount}/${plan.targetCount}`);
        appendCreationActivity(
          `正在生成配图 ${index + 1}/${plan.targetCount}`,
          `visual-generation-completed-${startedAt}-${index}`,
          `第 ${index + 1} 张配图已生成并加入本机素材库`,
          "success",
        );
        return { placement, asset };
      };
    const placements: Array<{ placement: VisualPlacementSummary; asset: MediaAsset }> = [];
    const batchSize = Math.max(1, Math.min(4, Number(plan.settings.generation_batch_size ?? 4)));
    for (let offset = 0; offset < plan.placements.length; offset += batchSize) {
      const batch = plan.placements.slice(offset, offset + batchSize);
      const results = await Promise.all(batch.map((placement, index) => executePlacement(placement, offset + index)));
      placements.push(...results);
      ensureCurrent();
    }

    const outputMarkdown = summary.outputMarkdown;
    const markdown = insertVisualMarkdown(outputMarkdown, placements);
    showArticleProgress({
      articleId: article.id,
      title: "正在插入正文配图",
      detail: "正在保存新的文章修订。",
      value: 92,
    });
    appendCreationActivity(
      "正在保存含配图的文章",
      `visual-insertion-started-${startedAt}`,
      plan.targetCount > 0
        ? "已按视觉 Agent 的计划插入正文配图"
        : "文章无需插入正文配图",
    );

    // The workflow output is durable before image composition. Preserve that
    // exact parent revision, while still sharing the editor's serialized save
    // queue with manual saves and automatic checkpoints.
    ensureCurrent();
    const revisionId = await persistRevision(
      article.id,
      markdown,
      false,
      summary.outputRevisionId,
    );
    ensureCurrent();

    if (generatedAssets.length > 0) {
      setMediaAssets((current) => [
        ...generatedAssets,
        ...current.filter(
          (asset) => !generatedAssets.some((created) => created.id === asset.id),
        ),
      ]);
      setGeneratedImages((current) => ({
        ...current,
        [article.id]: (current[article.id] ?? 0) + generatedAssets.length,
      }));
    }
    setArticleItems((current) => current.map((currentArticle) => (
      currentArticle.id === article.id
        ? { ...currentArticle, status: "review" }
        : currentArticle
    )));
    setArticleContentReplacing(true);
    appendCreationActivity(
      "配图已插入正文",
      `visual-insertion-completed-${startedAt}`,
      plan.targetCount > 0
        ? `${plan.targetCount} 张配图已按文章结构保存到新修订`
        : "文章已保存，未插入正文配图",
      "success",
    );
    window.setTimeout(() => setArticleContentReplacing(false), 260);
    setArticleProgress(null);
    return {
      revisionId,
      revisionNumber: summary.outputRevisionNumber + 1,
      markdown,
      generatedCount: generatedAssets.length,
    };
  };

  const receivePiWriterEvent = (
    articleId: string,
    event: PiRunEvent,
    agents: WorkflowAgentInstruction[],
  ) => {
    const source = writerSourceFenceRef.current[articleId];
    if (!source || !isWriterSourceCurrent(source)) {
      clearWriterTypewriter(articleId);
      return;
    }
    const payload = event.payload && typeof event.payload === "object"
      ? event.payload as Record<string, unknown>
      : {};
    const mapped: WorkflowActivityEvent = {
      id: event.id,
      eventType: event.type,
      nodeId: event.agentId === "writer" ? "draft" : null,
      createdAt: event.timestamp,
    };

    if (event.type === "agent.started") {
      mapped.eventType = "run.node_started";
    } else if (event.type === "article.preview_delta") {
      mapped.eventType = "run.node_output_delta";
      mapped.draftDelta = typeof payload.delta === "string" ? payload.delta : "";
      if (payload.reset === true) {
        clearWriterTypewriter(articleId, true);
        setWriterStreamingArticleId(articleId);
        replaceArticleContent(articleId, "", false);
      }
    } else if (event.type === "revision.committed") {
      mapped.eventType = "run.node_completed";
    }

    appendWorkflowWorkspaceEvents(articleId, event.runId, [mapped]);
    receiveWorkflowActivity(articleId, mapped, agents);
    lastWorkflowActivityAt.current = Date.now();

    if (event.type === "article.checkpointed") {
      appendCreationActivity(
        "正在保存文章",
        event.id,
        "Pi Runtime 已保存可恢复的工作稿检查点",
      );
    } else if (event.type === "tool.started") {
      appendCreationActivity(
        "正在整理完整文章",
        event.id,
        "写作 Agent 正在提交完整 Markdown",
      );
    } else if (event.type === "revision.committed") {
      appendCreationActivity(
        "写作草稿已完成",
        event.id,
        "正在提交到本机文章库",
        "success",
      );
    }
  };

  const waitForPiWriterRun = async (
    articleId: string,
    run: PiAgentRun,
    agents: WorkflowAgentInstruction[],
    executionId: number,
  ) => {
    let afterSequence = 0;
    let readFailures = 0;
    let lastProgressAt = Date.now();
    const startedAt = Date.now();
    while (true) {
      ensureWorkflowExecutionCurrent(articleId, executionId);
      const source = writerSourceFenceRef.current[articleId];
      if (!source || source.executionId !== executionId) {
        throw new Error(ASYNC_SOURCE_CHANGED);
      }
      ensureWriterSourceCurrent(source);
      try {
        const events = await desktopBridge.getPiRunEvents(run.id, afterSequence);
        ensureWorkflowExecutionCurrent(articleId, executionId);
        ensureWriterSourceCurrent(source);
        for (const event of events) {
          // A reconnecting Sidecar may replay the boundary event for the
          // requested cursor. Replaying preview resets would restart the
          // typewriter forever, so only consume strictly newer events.
          if (event.sequence <= afterSequence) continue;
          afterSequence = Math.max(afterSequence, event.sequence);
          receivePiWriterEvent(articleId, event, agents);
          lastProgressAt = Date.now();
        }
        const current = await desktopBridge.getPiRun(run.id);
        ensureWorkflowExecutionCurrent(articleId, executionId);
        ensureWriterSourceCurrent(source);
        readFailures = 0;
        if (["completed", "failed", "stopped", "interrupted"].includes(current.status)) {
          return current;
        }
      } catch (error) {
        readFailures += 1;
        if (readFailures >= 5) throw error;
      }

      if (Date.now() - lastProgressAt > 10 * 60_000) {
        throw new Error("写作服务连续 10 分钟没有更新，已停止等待。");
      }
      if (Date.now() - startedAt > 30 * 60_000) {
        throw new Error("本次写作已超过 30 分钟，已停止等待。");
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 90));
    }
  };

  const executePiCreation = async (
    article: Article,
    request: CreationRequest,
    retrying = false,
  ) => {
    const startedAt = Date.now();
    const previousLogs = retrying ? (creationActivity?.logs ?? []) : [];
    const agents = request.agentInstructions
      ?? buildWorkflowAgentInstructions(studioAgents, studioSkills);
    const executionId = beginWorkflowExecution(article.id);
    activeCreationRequestRef.current = createFailedCreationContext(article.id, request);
    setCreatingArticle(true);
    setWorkflowRunning(true);
    setFailedCreationContext(null);
    setCreationActivity({
      status: "running",
      phase: "正在准备创作",
      startedAt,
      elapsedSeconds: 0,
      agentLabels: ["写作 Agent"],
      logs: [
        ...previousLogs,
        activityLog(
          `pi-request-${startedAt}`,
          retrying ? "正在重试本次创作" : "已提交创作要求",
        ),
      ],
      error: null,
      retryable: false,
    });
    beginWorkflowWorkspace(article.id);
    showArticleProgress({
      articleId: article.id,
      title: "正在准备创作",
      detail: "正在连接写作服务。",
      value: null,
    });

    try {
      // The existing desktop article/revision store remains the only
      // canonical content store during the Pi migration. Persist the brief
      // before starting Pi so failures and stops always leave a recoverable
      // local revision behind.
      const inputMarkdown = currentArticleMarkdown(article.id, article.markdown);
      const inputSource = captureArticleSource(article.id, inputMarkdown);
      const inputRevisionId = await ensureRevision(article.id, inputMarkdown);
      ensureWorkflowExecutionCurrent(article.id, executionId);
      const writerSource: WriterSourceFence = {
        ...inputSource,
        revisionId: inputRevisionId,
        executionId,
      };
      writerSourceFenceRef.current[article.id] = writerSource;
      ensureWriterSourceCurrent(writerSource);

      const runtimeSnapshot = await desktopBridge.ensurePiRuntime();
      ensureWorkflowExecutionCurrent(article.id, executionId);
      ensureWriterSourceCurrent(writerSource);
      setPiRuntime(runtimeSnapshot);
      const prompt = [
        "请根据下面的创作简报写一篇可直接发布的完整中文 Markdown 文章。",
        "不要把“创作要求”“写作模板规范”等内部说明原样写进正文。",
        "资料不足以支撑具名项目功能、数据或案例时，明确保持克制，不得自行发明。",
        "",
        buildCreationSeed(request),
      ].join("\n");
      const run = await desktopBridge.startPiArticleRun({
        articleId: article.id,
        prompt,
      });
      ensureWorkflowExecutionCurrent(article.id, executionId);
      ensureWriterSourceCurrent(writerSource);
      activePiRunRef.current = { articleId: article.id, runId: run.id };
      setCreationActivity((current) => current ? {
        ...current,
        phase: "正在撰写文章",
        logs: [
          ...current.logs,
          activityLog(`pi-run-${run.id}`, "写作任务已开始"),
        ],
      } : current);

      const completed = await waitForPiWriterRun(article.id, run, agents, executionId);
      ensureWorkflowExecutionCurrent(article.id, executionId);
      ensureWriterSourceCurrent(writerSource);
      if (completed.status !== "completed") {
        throw new Error(completed.error?.message ?? `写作任务已以 ${completed.status} 状态结束。`);
      }
      const stored = await desktopBridge.getPiArticle(article.id);
      ensureWorkflowExecutionCurrent(article.id, executionId);
      ensureWriterSourceCurrent(writerSource);
      writerDraftCompletedRef.current.add(article.id);
      await waitForWriterTypewriterDrain(article.id, executionId);
      ensureWorkflowExecutionCurrent(article.id, executionId);
      ensureWriterSourceCurrent(writerSource);

      // Pi ArticleStore is canonical. Do not write the generated Markdown
      // through the old desktop revision path again: that would use the
      // pre-write base revision and create a stale CAS conflict.
      const persistedWriterArticle = (await desktopBridge.listArticles()).find(
        (candidate) => candidate.articleId === article.id,
      );
      if (!persistedWriterArticle || persistedWriterArticle.revisionId !== stored.currentRevisionId) {
        throw new Error("写作 Agent 已结束，但无法读取其保存的文章修订。");
      }
      ensureWorkflowExecutionCurrent(article.id, executionId);
      ensureWriterSourceCurrent(writerSource);
      const outputRevisionNumber = persistedWriterArticle.revisionNumber;

      // The durable Pi revision is now the stable source for optional visual
      // work. Rendering it here is safe because the writer fence proves the
      // user has not edited since this run began.
      replaceArticleContent(article.id, stored.markdown, false);
      setRevisionIds((current) => {
        const next = { ...current, [article.id]: stored.currentRevisionId };
        revisionIdsRef.current = next;
        return next;
      });
      setDirtyIds((current) => {
        const next = new Set(current);
        next.delete(article.id);
        dirtyIdsRef.current = next;
        return next;
      });
      const outputSource = captureArticleSource(
        article.id,
        stored.markdown,
        stored.currentRevisionId,
      );

      let visualPlan: VisualCompositionPlanSummary | null = null;
      if (request.imagePlan.mode !== "none") {
        appendCreationActivity(
          "正在规划正文配图",
          `pi-visual-plan-${run.id}`,
          "正在根据已生成的文章结构匹配素材并生成配图方案。",
        );
        showArticleProgress({
          articleId: article.id,
          title: "正在规划正文配图",
          detail: "写作内容已保存，视觉 Agent 正在确定图片位置。",
          value: 72,
        });
        const operationId = beginPiOperation("creation-visual", article.id);
        let planned;
        try {
          ensureArticleSourceCurrent(outputSource);
          planned = await desktopBridge.composeVisual({
            operationId,
            articleId: article.id,
            markdown: stored.markdown,
            instruction: "根据当前文章结构规划正文配图；优先使用用户选中的素材，不足时提供生图提示词。",
            visualComposition: visualCompositionFromCreation(request),
          });
        } finally {
          finishPiOperation(operationId);
        }
        ensurePiOperationCurrent(operationId);
        ensureWorkflowExecutionCurrent(article.id, executionId);
        ensureArticleSourceCurrent(outputSource);
        visualPlan = planned.plan;
      }

      let summary: RunWorkflowSummary = {
        runId: run.id,
        status: "completed",
        workflowName: "pi-writer",
        workflowVersion: "2",
        inputRevisionId,
        outputRevisionId: stored.currentRevisionId,
        outputRevisionNumber,
        outputMarkdown: stored.markdown,
        // The visual planner must bind its placement plan to this exact
        // canonical Pi content hash before any image side effect can start.
        outputContentHash: stored.contentHash,
        artifacts: [],
        visualPlan,
        persistence: "local_database",
      };
      completeWorkflowWorkspace(article.id, summary);

      const approvedVisualPlan = await requestVisualConfirmation(
        article.id,
        visualPlan,
        request.imagePlan.materialMatchThreshold,
        request.imageAssets,
      );
      ensureWorkflowExecutionCurrent(article.id, executionId);
      ensureArticleSourceCurrent(outputSource);
      let composed = approvedVisualPlan
        ? await composeVisualPlan(
            article,
            summary,
            approvedVisualPlan,
            request,
            startedAt,
            () => {
              ensureWorkflowExecutionCurrent(article.id, executionId);
              ensureArticleSourceCurrent(outputSource);
            },
          )
        : {
            revisionId: summary.outputRevisionId,
            revisionNumber: summary.outputRevisionNumber,
            markdown: summary.outputMarkdown,
            generatedCount: 0,
          };
      ensureWorkflowExecutionCurrent(article.id, executionId);
      ensureArticleSourceCurrent(outputSource);
      if (!approvedVisualPlan && request.imagePlan.mode !== "none") {
        appendCreationActivity(
          "已跳过正文配图",
          `pi-visual-plan-skipped-${run.id}`,
          "文章已保存，未启动任何图片生成或素材插入。",
        );
      }

      const finalMarkdown = request.template
        ? applyTemplateFixedBlocks(composed.markdown, request.template, article, request)
        : composed.markdown;
      if (finalMarkdown !== composed.markdown) {
        ensureArticleSourceCurrent(outputSource);
        const revisionId = await persistRevision(
          article.id,
          finalMarkdown,
          false,
          composed.revisionId,
        );
        ensureWorkflowExecutionCurrent(article.id, executionId);
        ensureArticleSourceCurrent(outputSource);
        composed = {
          ...composed,
          revisionId,
          revisionNumber: composed.revisionNumber + 1,
          markdown: finalMarkdown,
        };
      }
      summary = {
        ...summary,
        outputRevisionId: composed.revisionId,
        outputRevisionNumber: composed.revisionNumber,
        outputMarkdown: composed.markdown,
      };
      ensureArticleSourceCurrent(outputSource);
      setArticleContentReplacing(true);
      applyWorkflowResult(article.id, summary, request.platforms);
      window.setTimeout(() => setArticleContentReplacing(false), 260);
      setCreationActivity((current) => current ? {
        ...current,
        status: "succeeded",
        phase: composed.generatedCount > 0 ? "文章与配图生成完成" : "文章生成完成",
        elapsedSeconds: Math.max(current.elapsedSeconds, Math.round((Date.now() - startedAt) / 1000)),
        logs: [
          ...current.logs,
          activityLog(
            `pi-completed-${run.id}`,
            `文章已保存为修订 ${composed.revisionNumber}`,
            "success",
          ),
        ],
      } : current);
      setArticleProgress(null);
      setActiveNav("articles");
      setToast(`文章已生成 · 修订 ${composed.revisionNumber}`);
    } catch (error) {
      const activeRun = activePiRunRef.current;
      if (activeRun?.articleId === article.id) {
        // A client-side timeout must not leave the model running in the
        // background and later overwrite a retried draft.
        void desktopBridge.stopPiRun(activeRun.runId).catch(() => undefined);
      }
      if (!isWorkflowExecutionCurrent(article.id, executionId)) return;
      const detail = sanitizeActivityMessage(error instanceof Error ? error.message : String(error));
      clearWriterTypewriter(article.id);
      failWorkflowWorkspace(article.id, detail);
      setFailedCreationContext(createFailedCreationContext(article.id, request));
      setCreationActivity((current) => current ? {
        ...current,
        status: "failed",
        phase: "文章生成失败",
        elapsedSeconds: Math.max(current.elapsedSeconds, Math.round((Date.now() - startedAt) / 1000)),
        error: `失败原因：${detail}`,
        retryable: true,
        logs: [
          ...current.logs,
          activityLog(`pi-failed-${Date.now()}`, `写作任务失败：${detail}`, "error"),
        ],
      } : current);
      setArticleProgress(null);
      setToast("文章生成失败，当前工作稿已保留");
    } finally {
      if (activePiRunRef.current?.articleId === article.id) activePiRunRef.current = null;
      if (writerSourceFenceRef.current[article.id]?.executionId === executionId) {
        delete writerSourceFenceRef.current[article.id];
      }
      if (finishWorkflowExecution(article.id, executionId)) {
        activeCreationRequestRef.current = null;
        setCreatingArticle(false);
        setWorkflowRunning(false);
      }
    }
  };

  const createFromBrief = (request: CreationRequest) => {
    if (creatingArticle || workflowRunning) return;
    if (!requireTextModel()) return;
    if (compositionCanRequireGeneratedImages(request) && !requireImageModel()) return;
    const agentDisabledNodes = disabledOptionalNodesFor(studioAgents);
    const normalizedRequest: CreationRequest = {
      ...request,
      disabledNodeIds: visualNodeDisabledIds(
        [...new Set([...request.disabledNodeIds, ...agentDisabledNodes])],
        request.imagePlan,
      ),
      agentInstructions: buildWorkflowAgentInstructions(studioAgents, studioSkills),
    };
    const id = `article-${Date.now()}`;
    const markdown = buildCreationSeed(normalizedRequest);
    const article: Article = {
      id,
      title: normalizedRequest.title || normalizedRequest.topic,
      deck: normalizedRequest.topic,
      markdown,
      status: "draft",
      updatedAt: "刚刚",
      wordCount: markdown.replace(/\s/g, "").length,
      channels: normalizedRequest.platforms,
      collection: normalizedRequest.contentType,
    };
    setArticleItems((current) => [article, ...current]);
    setDrafts((current) => ({ ...current, [id]: markdown }));
    setSelectedArticleId(id);
    setActiveNav("articles");
    void executePiCreation(article, normalizedRequest);
  };

  const retryCreation = () => {
    if (!failedCreationContext || creatingArticle || workflowRunning) return;
    const retryRequest: CreationRequest = {
      ...failedCreationContext.request,
      template: failedCreationContext.templateId
        ? templates.find((template) => template.id === failedCreationContext.templateId) ?? null
        : failedCreationContext.request.template,
      imageAssets: failedCreationContext.imageAssetIds.length > 0
        ? failedCreationContext.imageAssetIds
            .map((id) => mediaAssets.find((asset) => asset.id === id))
            .filter((asset): asset is MediaAsset => Boolean(asset))
        : failedCreationContext.request.imageAssets,
    };
    if (!requireTextModel()) return;
    if (
      compositionCanRequireGeneratedImages(retryRequest) &&
      !requireImageModel()
    ) {
      return;
    }
    const article = articleItems.find(
      (candidate) => candidate.id === failedCreationContext.articleId,
    );
    if (!article) {
      setToast("未找到上次创作要求，请重新提交");
      return;
    }
    void executePiCreation(article, retryRequest, true);
  };

  useEffect(() => () => {
    // An unmounted workspace must never continue through a later bridge
    // instance (for example after a Tauri reload). Every await in a writer
    // execution rechecks this token before it can start or commit more work.
    activeWorkflowExecutionRef.current = null;
    activeCreationRequestRef.current = null;
    const activeRun = activePiRunRef.current;
    activePiRunRef.current = null;
    if (activeRun) {
      void desktopBridge.stopPiRun(activeRun.runId).catch(() => undefined);
    }
    const activeRewriteRun = activePiRewriteRunRef.current;
    activePiRewriteRunRef.current = null;
    activePiRewriteRequestRef.current = null;
    if (activeRewriteRun) {
      void desktopBridge.stopPiRun(activeRewriteRun.runId).catch(() => undefined);
    }
  }, []);

  const cancelCurrentWorkflow = () => {
    const activeExecution = activeWorkflowExecutionRef.current;
    if (cancellingWorkflow) return;
    if (!activeExecution || !workflowRunning) {
      const articleId = selectedArticleId;
      const rewriteRun = activePiRewriteRunRef.current;
      if (articleId && rewriteRun?.articleId === articleId) {
        setCancellingWorkflow(true);
        void desktopBridge.stopPiRun(rewriteRun.runId)
          .catch(() => {
            setToast("停止请求未被本地服务确认；旧改写结果仍不会写回文章。");
          })
          .finally(() => setCancellingWorkflow(false));
        setToast("正在停止当前 AI 改写请求。");
        return;
      }
      const pendingRewrite = activePiRewriteRequestRef.current;
      if (articleId && pendingRewrite?.articleId === articleId) {
        // ArticleAssistant remembers this request and will issue cancellation
        // again as soon as the native start event supplies its run id.
        setToast("正在等待改写任务启动后停止。");
        return;
      }
      if (!articleId || ![...activePiOperationsRef.current.values()].some((owner) => owner === articleId)) return;
      setCancellingWorkflow(true);
      void cancelPiOperations(articleId).finally(() => setCancellingWorkflow(false));
      setToast("已停止当前 AI 操作，未完成结果不会写入文章。");
      return;
    }

    const { articleId } = activeExecution;
    const piRun = activePiRunRef.current?.articleId === articleId
      ? activePiRunRef.current
      : null;
    activePiRunRef.current = null;
    const creationContext = activeCreationRequestRef.current;
    // Invalidate first. Any response that arrives after this point belongs to
    // the stopped run and must never replace the user's current draft.
    activeWorkflowExecutionRef.current = null;
    activeCreationRequestRef.current = null;
    if (visualConfirmation?.articleId === articleId) {
      resolveVisualConfirmation(null);
    }
    clearWriterTypewriter(articleId);
    setDirtyIds((current) => {
      const next = new Set(current).add(articleId);
      dirtyIdsRef.current = next;
      return next;
    });
    failWorkflowWorkspace(articleId, WORKFLOW_CANCELLED_BY_USER_MESSAGE);
    if (creationContext?.articleId === articleId) {
      setFailedCreationContext(creationContext);
    }
    setCreationActivity((current) => {
      if (!current || current.status !== "running") return current;
      return {
        ...current,
        status: "failed",
        phase: "已停止生成",
        elapsedSeconds: Math.max(
          current.elapsedSeconds,
          Math.round((Date.now() - current.startedAt) / 1000),
        ),
        error: `失败原因：${WORKFLOW_CANCELLED_BY_USER_MESSAGE}`,
        retryable: true,
        logs: [
          ...current.logs,
          activityLog(
            `workflow-cancelled-${Date.now()}`,
            "用户已停止本次生成，已保留当前编辑器内容",
            "error",
          ),
        ],
      };
    });
    setArticleProgress(null);
    setArticleContentReplacing(false);
    setCreatingArticle(false);
    setWorkflowRunning(false);
    setCancellingWorkflow(true);
    setToast("已停止生成，当前已写入的内容仍保留在编辑器中");

    const releaseCancellationState = window.setTimeout(
      () => setCancellingWorkflow(false),
      2_000,
    );
    // Stop both durable writer runs and scoped non-run operations. The latter
    // includes visual planning and every concurrent image request.
    void cancelPiOperations(articleId);
    const cancellation = piRun
      ? desktopBridge.stopPiRun(piRun.runId).then(() => undefined)
      : Promise.resolve();
    void cancellation
      .catch(() => {
        setToast("已停止本地等待；本地服务未确认取消，旧结果不会写回文章。");
      })
      .finally(() => {
        window.clearTimeout(releaseCancellationState);
        setCancellingWorkflow(false);
      });
  };

  const createBlankArticle = () => {
    const id = `article-${Date.now()}`;
    const markdown = "# 未命名文章\n\n";
    const article: Article = {
      id,
      title: "未命名文章",
      deck: "本地草稿",
      markdown,
      status: "draft",
      updatedAt: "刚刚",
      wordCount: 6,
      channels: ["wechat", "csdn"],
      collection: "未分类",
    };
    setArticleItems((current) => [article, ...current]);
    setDrafts((current) => {
      const next = { ...current, [id]: markdown };
      draftsRef.current = next;
      return next;
    });
    setDirtyIds((current) => {
      const next = new Set(current).add(id);
      dirtyIdsRef.current = next;
      return next;
    });
    setSelectedArticleId(id);
    setActiveNav("articles");
  };

  const saveCurrentArticle = async () => {
    if (!selectedArticle) return;
    try {
      await persistRevision(selectedArticle.id, currentMarkdown, true);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setToast(`保存失败：${detail.slice(0, 120)}`);
    }
  };

  const improveCurrentArticle = async () => {
    if (!selectedArticle || workflowRunning) return;
    if (!requireTextModel()) return;
    const article = selectedArticle;
    const markdown = currentMarkdown;
    const inputSource = captureArticleSource(article.id, markdown);
    const agents = buildWorkflowAgentInstructions(studioAgents, studioSkills);
    const executionId = beginWorkflowExecution(article.id);
    setWorkflowRunning(true);
    beginWorkflowWorkspace(article.id);
    showArticleProgress({
      articleId: article.id,
      title: "正在准备全文优化",
      detail: "正在将当前修订交给写作 Agent。",
      value: null,
    });
    try {
      const inputRevisionId = await ensureRevision(article.id, markdown);
      ensureWorkflowExecutionCurrent(article.id, executionId);
      const writerSource: WriterSourceFence = {
        ...inputSource,
        revisionId: inputRevisionId,
        executionId,
      };
      writerSourceFenceRef.current[article.id] = writerSource;
      ensureWriterSourceCurrent(writerSource);
      const snapshot = await desktopBridge.ensurePiRuntime();
      ensureWorkflowExecutionCurrent(article.id, executionId);
      ensureWriterSourceCurrent(writerSource);
      setPiRuntime(snapshot);
      const run = await desktopBridge.startPiArticleRun({
        articleId: article.id,
        prompt: [
          "请完整优化下方的中文 Markdown 文章。",
          "保留已经存在的事实、链接、图片 Markdown、代码块和有效的排版层级；不要虚构数据、功能、案例或用户反馈。",
          "让文字具体、自然、有明确观点，删掉空泛套话。不要解释修改过程，只提交完整的优化后 Markdown。",
          "",
          "## 当前文章",
          markdown,
        ].join("\n"),
      });
      ensureWorkflowExecutionCurrent(article.id, executionId);
      ensureWriterSourceCurrent(writerSource);
      activePiRunRef.current = { articleId: article.id, runId: run.id };
      const completed = await waitForPiWriterRun(article.id, run, agents, executionId);
      ensureWorkflowExecutionCurrent(article.id, executionId);
      ensureWriterSourceCurrent(writerSource);
      if (completed.status !== "completed") {
        throw new Error(completed.error?.message ?? `全文优化以 ${completed.status} 状态结束。`);
      }
      const stored = await desktopBridge.getPiArticle(article.id);
      ensureWorkflowExecutionCurrent(article.id, executionId);
      ensureWriterSourceCurrent(writerSource);
      writerDraftCompletedRef.current.add(article.id);
      await waitForWriterTypewriterDrain(article.id, executionId);
      ensureWorkflowExecutionCurrent(article.id, executionId);
      ensureWriterSourceCurrent(writerSource);
      const persisted = (await desktopBridge.listArticles()).find(
        (candidate) => candidate.articleId === article.id,
      );
      if (!persisted || persisted.revisionId !== stored.currentRevisionId) {
        throw new Error("全文优化已结束，但无法读取保存后的文章修订。" );
      }
      ensureWorkflowExecutionCurrent(article.id, executionId);
      ensureWriterSourceCurrent(writerSource);
      const summary: RunWorkflowSummary = {
        runId: run.id,
        status: "completed",
        workflowName: "pi-writer-full-rewrite",
        workflowVersion: "2",
        inputRevisionId,
        outputRevisionId: stored.currentRevisionId,
        outputRevisionNumber: persisted.revisionNumber,
        outputMarkdown: stored.markdown,
        outputContentHash: stored.contentHash,
        artifacts: [],
        visualPlan: null,
        persistence: "local_database",
      };
      completeWorkflowWorkspace(article.id, summary);
      setArticleContentReplacing(true);
      applyWorkflowResult(article.id, summary);
      window.setTimeout(() => setArticleContentReplacing(false), 260);
      setArticleProgress(null);
      setToast(`AI 处理完成 · 已生成修订 ${summary.outputRevisionNumber}`);
    } catch (error) {
      const activeRun = activePiRunRef.current;
      if (activeRun?.articleId === article.id) {
        void desktopBridge.stopPiRun(activeRun.runId).catch(() => undefined);
      }
      if (!isWorkflowExecutionCurrent(article.id, executionId)) return;
      const detail = error instanceof Error ? error.message : String(error);
      clearWriterTypewriter(article.id);
      failWorkflowWorkspace(article.id, sanitizeActivityMessage(detail));
      setArticleProgress(null);
      setToast(`AI 处理失败：${detail.slice(0, 120)}`);
    } finally {
      if (activePiRunRef.current?.articleId === article.id) activePiRunRef.current = null;
      if (writerSourceFenceRef.current[article.id]?.executionId === executionId) {
        delete writerSourceFenceRef.current[article.id];
      }
      if (finishWorkflowExecution(article.id, executionId)) {
        setWorkflowRunning(false);
      }
    }
  };

  const composeVisualForCurrentArticle = async (
    instruction: string,
    _conversation: RewriteConversationMessage[],
    onActivity: (activity: AssistantActivity) => void,
    sourceMarkdownOverride?: string,
    baseRevisionId?: string,
    replaceExistingImages = false,
    targetSelections: MarkdownSelection[] = [],
  ): Promise<{ summary: string }> => {
    if (!selectedArticle || workflowRunning || saving) {
      throw new Error("当前文章正在保存或执行工作流，请稍后再试。");
    }
    if (!requireTextModel()) {
      throw new Error("请先完成文本模型配置。");
    }
    const requestedSourceMarkdown = sourceMarkdownOverride?.trim()
      ? sourceMarkdownOverride
      : currentMarkdown;
    if (!requestedSourceMarkdown.trim()) {
      throw new Error("当前文章没有可供视觉 Agent 分析的正文。");
    }

    const article = selectedArticle;
    const source = captureArticleSource(
      article.id,
      requestedSourceMarkdown,
      baseRevisionId ?? revisionIdsRef.current[article.id] ?? null,
    );
    ensureArticleSourceCurrent(source);
    const sourceMarkdown = replaceExistingImages
      ? removeArticleImages(requestedSourceMarkdown)
      : requestedSourceMarkdown;
    const stableTargetSelections = targetSelections.filter((selection) => (
      selection.text.trim().length > 0 && sourceMarkdown.includes(selection.text)
    ));
    const requestedCount = requestedVisualCount(instruction)
      ?? (stableTargetSelections.length > 0 ? stableTargetSelections.length : null);
    const visualAssets = (selectedMedia.length > 0 ? selectedMedia : mediaAssets).slice(0, 6);
    const assetScope = selectedMedia.length > 0
      ? "selected_only"
      : visualAssets.length > 0
        ? "library"
        : "none";
    const visualComposition: VisualCompositionRequest = {
      mode: requestedCount ? "fixed" : "auto",
      targetCount: requestedCount ?? 0,
      assets: visualAssets.map((asset) => {
        const description = [
          asset.visualDescription?.trim() && `图片内容：${asset.visualDescription.trim()}`,
          asset.usageHint?.trim() && `使用场景：${asset.usageHint.trim()}`,
          asset.generationPrompt?.trim() && `生成提示词：${asset.generationPrompt.trim()}`,
          asset.tags && asset.tags.length > 0 && `标签：${asset.tags.join("、")}`,
          asset.description?.trim() && `补充说明：${asset.description.trim()}`,
        ].filter(Boolean).join("\n");
        return {
          id: asset.id,
          alt: boundedVisualInstructionText(asset.alt || asset.name, 160) || "文章配图",
          description: boundedVisualInstructionText(description, 600) || "可用于补充文章内容的本地素材。",
        };
      }),
      assetScope,
      preferredType: "infographic",
      density: requestedCount && requestedCount >= 3 ? "per-section" : "balanced",
      style: "清晰、克制的中文技术文章插图，不含品牌标识或额外文字",
      palette: null,
      preferredImageBackend: "auto",
      generationBatchSize: 4,
      materialMatchThreshold: 30,
      skipConfirmation: true,
    };

    onActivity({
      title: "视觉 Agent 正在规划配图",
      detail: "正在理解文章结构，并确定每张图片适合插入的位置。",
      value: 10,
    });
    const planningOperationId = beginPiOperation("editor-visual", article.id);
    let result: { plan: VisualCompositionPlanSummary };
    try {
      ensureArticleSourceCurrent(source);
      result = await desktopBridge.composeVisual({
        operationId: planningOperationId,
        articleId: article.id,
        markdown: sourceMarkdown,
        instruction,
        visualComposition,
      });
    } finally {
      finishPiOperation(planningOperationId);
    }
    ensurePiOperationCurrent(planningOperationId);
    ensureArticleSourceCurrent(source);
    // The visual model proposes the illustration content, but a user-selected
    // paragraph is a stronger placement constraint than a semantic guess. Keep
    // that anchor local and deterministic so the image cannot land elsewhere.
    const plan: VisualCompositionPlanSummary = stableTargetSelections.length > 0
      ? {
          ...result.plan,
          placements: result.plan.placements.map((placement, index) => {
            const target = stableTargetSelections[index];
            if (!target) return placement;
            return {
              ...placement,
              anchorExcerpt: target.text,
              afterHeading: null,
              selectionReason: "由用户选中的正文片段定位。",
            };
          }),
        }
      : result.plan;
    if (plan.placements.length !== plan.targetCount) {
      throw new Error("视觉 Agent 返回的配图数量无效，文章未插入图片。请重试本次操作。");
    }
    if (plan.targetCount === 0) {
      onActivity({
        title: "视觉 Agent 已完成分析",
        detail: "当前文章无需补充正文配图。",
        value: 100,
      });
      return { summary: "视觉 Agent 判断当前文章无需补充正文配图。" };
    }

    onActivity({
      title: "正在匹配素材与生成提示词",
      detail: `视觉 Agent 已规划 ${plan.targetCount} 张配图，正在准备执行。`,
      value: 25,
    });
    const assetsById = new Map(visualAssets.map((asset) => [asset.id, asset]));
    const generatedPlacements = plan.placements.filter((placement) => !placement.assetId);
    if (generatedPlacements.length > 0 && (
      !modelConfiguration?.imageBaseUrl ||
      !modelConfiguration.imageModel ||
      !modelConfiguration.imageSecretConfigured
    )) {
      throw new Error("视觉 Agent 已选出需要生成的配图，但未配置生图模型。");
    }

    const imageModel = modelConfiguration?.imageModel ?? null;
    const generatedAssets: MediaAsset[] = [];
    let completedCount = 0;
    const executePlacement = async (placement: VisualPlacementSummary, index: number) => {
      if (placement.assetId) {
        const asset = assetsById.get(placement.assetId);
        if (!asset) {
          throw new Error("视觉 Agent 选择了当前可用素材之外的图片，请重试本次配图。");
        }
        completedCount += 1;
        onActivity({
          title: "正在插入素材库图片",
          detail: `已安排第 ${index + 1}/${plan.targetCount} 张素材。`,
          value: 25 + Math.round((completedCount / plan.targetCount) * 62),
        });
        return { placement, asset };
      }
      if (!placement.generationPrompt) {
        throw new Error("视觉 Agent 未为待生成图片提供可执行的提示词。");
      }
      onActivity({
        title: "正在生成正文配图",
        detail: `正在生成第 ${index + 1}/${plan.targetCount} 张配图。`,
        value: 28 + Math.round((completedCount / plan.targetCount) * 56),
      });
      const operationId = beginPiOperation("editor-image", article.id);
      let imageResult;
      try {
        ensureArticleSourceCurrent(source);
        imageResult = await desktopBridge.generateImage({
          operationId,
          prompt: placement.generationPrompt,
          size: "1536x1024",
          model: imageModel,
        });
      } finally {
        finishPiOperation(operationId);
      }
      ensurePiOperationCurrent(operationId);
      ensureArticleSourceCurrent(source);
      const image = imageResult.images[0];
      if (!image) {
        throw new Error(`第 ${index + 1} 张配图未返回可保存的图片数据。`);
      }
      const asset: MediaAsset = {
        id: `generated-${image.id}`,
        name: `${article.title} 正文配图 ${index + 1}`.slice(0, 120),
        alt: escapeImageAlt(placement.alt),
        description: `由 AI 根据文章小节“${placement.afterHeading ?? "文章核心观点"}”生成。`,
        visualDescription: placement.alt,
        usageHint: `适合插入“${placement.afterHeading ?? "文章核心观点"}”之后，用于补充正文说明。`,
        generationPrompt: placement.generationPrompt,
        tags: ["AI 生成", "正文配图"],
        descriptionSource: "generation_prompt",
        src: image.dataUrl,
        source: "generated",
        createdAt: "刚刚生成",
      };
      generatedAssets.push(asset);
      completedCount += 1;
      onActivity({
        title: "正在生成正文配图",
        detail: `已完成第 ${completedCount}/${plan.targetCount} 张配图。`,
        value: 25 + Math.round((completedCount / plan.targetCount) * 62),
      });
      return { placement, asset };
    };

    const placements: Array<{ placement: VisualPlacementSummary; asset: MediaAsset }> = [];
    const batchSize = Math.max(1, Math.min(4, Number(plan.settings.generation_batch_size ?? 4)));
    for (let offset = 0; offset < plan.placements.length; offset += batchSize) {
      const batch = plan.placements.slice(offset, offset + batchSize);
      const batchResults = await Promise.all(
        batch.map((placement, index) => executePlacement(placement, offset + index)),
      );
      placements.push(...batchResults);
      ensureArticleSourceCurrent(source);
    }

    ensureArticleSourceCurrent(source);
    const nextMarkdown = insertVisualMarkdown(sourceMarkdown, placements);
    onActivity({
      title: "正在更新文章",
      detail: "配图已按文章结构定位，正在保存新的文章修订。",
      value: 92,
    });
    setArticleContentReplacing(true);
    try {
      ensureArticleSourceCurrent(source);
      const revisionId = await persistRevision(article.id, nextMarkdown, false, baseRevisionId);
      ensureArticleSourceCurrent(source);
      replaceArticleContent(article.id, nextMarkdown, false);
      const previousUndo = rewriteUndoRef.current[article.id];
      rewriteUndoRef.current[article.id] = {
        before: previousUndo?.after === requestedSourceMarkdown
          ? previousUndo.before
          : requestedSourceMarkdown,
        after: nextMarkdown,
      };
      setRewriteUndoArticleId(article.id);
      if (generatedAssets.length > 0) {
        setMediaAssets((current) => [
          ...generatedAssets,
          ...current.filter(
            (asset) => !generatedAssets.some((created) => created.id === asset.id),
          ),
        ]);
        setGeneratedImages((current) => ({
          ...current,
          [article.id]: (current[article.id] ?? 0) + generatedAssets.length,
        }));
      }
      setArticleItems((current) => current.map((currentArticle) => (
        currentArticle.id === article.id
          ? { ...currentArticle, status: "review", revisionId }
          : currentArticle
      )));
    } finally {
      window.setTimeout(() => setArticleContentReplacing(false), 260);
    }
    onActivity({
      title: "配图已写入文章",
      detail: `已按文章结构插入 ${placements.length} 张配图。`,
      value: 100,
    });
    return {
      summary: `已按文章结构插入 ${placements.length} 张配图，其中 ${generatedAssets.length} 张为新生成图片。`,
    };
  };

  const rewriteCurrentArticle = async (
    instruction: string,
    selections: MarkdownSelection[],
    conversation: RewriteConversationMessage[],
    requestId: string,
  ): Promise<RewriteArticleOutcome> => {
    if (!selectedArticle || workflowRunning || saving) {
      throw new Error("当前文章正在保存或执行工作流，请稍后再试。");
    }
    if (!requireTextModel()) {
      throw new Error("请先完成文本模型配置。");
    }
    const article = selectedArticle;
    const source = captureArticleSource(article.id, currentMarkdown);
    activePiRewriteRequestRef.current = { articleId: article.id, requestId };
    try {
      const result = await desktopBridge.rewriteArticle({
        articleId: article.id,
        requestId,
        markdown: source.markdown,
        instruction,
        selectedTexts: selections.map((selection) => selection.text),
        conversation,
      });
      ensureArticleSourceCurrent(source);
      return {
        ...result,
        source,
        visualRefreshRecommended:
          selections.length === 0 &&
          Boolean(result.replacements[0]) &&
          articleChangeRequiresVisualRefresh(source.markdown, result.replacements[0]!),
      };
    } finally {
      if (activePiRewriteRequestRef.current?.requestId === requestId) {
        activePiRewriteRequestRef.current = null;
      }
      if (activePiRewriteRunRef.current?.requestId === requestId) {
        activePiRewriteRunRef.current = null;
      }
    }
  };

  const applyArticleRewrite = async (candidate: RewriteCandidate) => {
    if (workflowRunning || saving) {
      throw new Error("当前文章正在保存或执行工作流，请稍后再试。");
    }
    const source = candidate.source;
    if (!source) {
      throw new Error("改写请求缺少文章版本信息，请重新生成修改建议。");
    }
    ensureArticleSourceCurrent(source);
    if (candidate.replacements.length !== (candidate.selections.length || 1)) {
      throw new Error("AI 返回的修改片段数量不匹配，请重新生成修改建议。");
    }
    let nextMarkdown = source.markdown;
    if (candidate.selections.length) {
      const replacements = candidate.selections
        .map((selection, index) => ({ selection, replacement: candidate.replacements[index]! }))
        .sort((left, right) => right.selection.start - left.selection.start);
      for (const { selection, replacement } of replacements) {
        if (source.markdown.slice(selection.start, selection.end) !== selection.text) {
          throw new Error("选中的原文已经变化，请重新选择后再生成修改建议。");
        }
        assertRewritePreservesImages(selection.text, replacement);
        nextMarkdown = `${nextMarkdown.slice(0, selection.start)}${replacement}${nextMarkdown.slice(selection.end)}`;
      }
    } else {
      nextMarkdown = candidate.replacements[0] ?? "";
      assertRewritePreservesImages(source.markdown, nextMarkdown);
    }
    if (!nextMarkdown.trim()) throw new Error("AI 返回了空内容，未修改文章。");

    setArticleContentReplacing(true);
    try {
      ensureArticleSourceCurrent(source);
      const revisionId = await persistRevision(source.articleId, nextMarkdown, false);
      ensureArticleSourceCurrent(source);
      replaceArticleContent(source.articleId, nextMarkdown, false);
      rewriteUndoRef.current[source.articleId] = {
        before: source.markdown,
        after: nextMarkdown,
      };
      setRewriteUndoArticleId(source.articleId);
      setArticleItems((current) =>
        current.map((article) =>
          article.id === source.articleId
            ? { ...article, status: "review", revisionId }
            : article,
        ),
      );
      setToast(`AI 修改已保存 · ${candidate.model}`);
      return { revisionId, markdown: nextMarkdown };
    } finally {
      window.setTimeout(() => setArticleContentReplacing(false), 260);
    }
  };

  const undoLastArticleRewrite = async () => {
    if (!selectedArticle || workflowRunning || saving) {
      throw new Error("当前文章正在保存或执行工作流，请稍后再试。");
    }
    const undo = rewriteUndoRef.current[selectedArticle.id];
    if (!undo || currentMarkdown !== undo.after) {
      throw new Error("正文已有新的手动修改，无法自动撤销这次 AI 修改。");
    }
    setArticleContentReplacing(true);
    try {
      await persistRevision(selectedArticle.id, undo.before, false);
      delete rewriteUndoRef.current[selectedArticle.id];
      setRewriteUndoArticleId((current) =>
        current === selectedArticle.id ? null : current,
      );
      setToast("已撤销上一次 AI 修改");
    } finally {
      window.setTimeout(() => setArticleContentReplacing(false), 260);
    }
  };

  const publishCurrentArticleToWechatSync = async (targets: PlatformId[]) => {
    if (!selectedArticle || publishAction) {
      throw new Error("当前没有可同步的文章，或已有发布任务正在执行。");
    }
    if (piRuntime?.bridgeMode !== "pi_sidecar") {
      throw new Error("浏览器预览不能同步平台草稿，请在桌面应用中执行。");
    }
    setPublishAction("process");
    setPublishError(null);
    try {
      const status = await desktopBridge.wechatSyncStatus({ forceRefresh: true });
      if (status.available && status.connected && status.platforms.length > 0) {
        lastKnownWechatSyncStatus.current = status;
      }
      setWechatSyncStatus({ ...status, stale: false });
      if (!status.available || !status.connected) {
        throw new Error(status.detail || "WechatSync 本地桥未连接。");
      }
      const unauthenticated = targets.filter(
        (platform) => !status.platforms.find((item) => item.id === platform)?.authenticated,
      );
      if (unauthenticated.length) {
        throw new Error(`${unauthenticated.join("、")} 当前未登录，无法同步草稿。`);
      }

      const revisionId = await ensureRevision(selectedArticle.id, currentMarkdown);
      let plan = await desktopBridge.createPublishPlan({
        articleId: selectedArticle.id,
        revisionId,
        platforms: targets,
        deliveryMode: "wechat_sync_draft",
      });
      plan = await desktopBridge.approvePublishPlan({ planId: plan.planId });
      plan = await desktopBridge.enqueuePublishPlan({ planId: plan.planId });
      const receiptMap = new Map<string, PublishReceiptSummary>();
      for (const job of plan.jobs) {
        const result = await desktopBridge.processPublishJob({ jobId: job.id });
        if (result.receipt) receiptMap.set(result.receipt.jobId, result.receipt);
      }
      plan = await desktopBridge.getPublishPlan({ planId: plan.planId });
      setPublishTargets(new Set(targets));
      setPublishSession({
        articleId: selectedArticle.id,
        revisionId,
        plan,
        receipts: [...receiptMap.values()],
      });
      const failed = plan.jobs.filter((job) => job.state !== "succeeded");
      if (failed.length) {
        const detail = failed.map((job) => `${job.platform}：${job.lastError ?? job.state}`).join("；");
        throw new Error(detail);
      }
      setToast(`已同步 ${receiptMap.size} 个平台草稿，请在浏览器中检查并最终发布。`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setPublishError(`草稿同步失败：${detail.slice(0, 220)}`);
      throw error;
    } finally {
      setPublishAction(null);
    }
  };

  const generateImage = async () => {
    if (!selectedArticle || generatingImage) return;
    if (!requireImageModel()) return;
    setGeneratingImage(true);
    try {
      const operationId = beginPiOperation("cover-image", selectedArticle.id);
      let result;
      try {
        result = await desktopBridge.generateImage({
          operationId,
          prompt: `为《${selectedArticle.title}》生成清晰克制的文章封面，不使用品牌标识。主题：${selectedArticle.deck}`,
          size: "1536x1024",
          model: modelConfiguration?.imageModel ?? null,
        });
      } finally {
        finishPiOperation(operationId);
      }
      ensurePiOperationCurrent(operationId);
      if (result.images.length === 0) {
        throw new Error("生图服务没有返回可保存的图片数据");
      }
      const createdAssets = result.images.map((image, index) => ({
        id: `generated-${image.id}`,
        name: `${selectedArticle.title} 配图 ${index + 1}`.slice(0, 120),
        alt: `${selectedArticle.title} 配图 ${index + 1}`.slice(0, 160),
        description: "AI 生成的文章配图。",
        visualDescription: `${selectedArticle.title} 的文章配图。`,
        usageHint: "适合在文章中补充核心观点或作为封面使用。",
        generationPrompt: `为《${selectedArticle.title}》生成清晰克制的文章封面，不使用品牌标识。主题：${selectedArticle.deck}`,
        tags: ["AI 生成", "文章配图"],
        descriptionSource: "generation_prompt" as const,
        src: image.dataUrl,
        source: "generated" as const,
        createdAt: "刚刚生成",
      }));
      setMediaAssets((current) => [
        ...createdAssets,
        ...current.filter(
          (asset) => !createdAssets.some((created) => created.id === asset.id),
        ),
      ]);
      setGeneratedImages((current) => ({
        ...current,
        [selectedArticle.id]:
          (current[selectedArticle.id] ?? 0) + createdAssets.length,
      }));
      setToast(
        result.mocked
          ? "已生成测试配图并加入本机素材库"
          : `已生成 ${createdAssets.length} 张配图并加入素材库 · ${result.model}`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setToast(`配图生成失败：${detail.slice(0, 120)}`);
    } finally {
      setGeneratingImage(false);
    }
  };

  const extractTemplateFromArticle = async (sourceMarkdown: string) => {
    if (!requireTextModel()) {
      throw new Error("请先在设置中保存并测试文本模型连接。");
    }
    try {
      const operationId = beginPiOperation("template-extraction", null);
      let result;
      try {
        result = await desktopBridge.extractTemplate({ operationId, sourceMarkdown });
      } finally {
        finishPiOperation(operationId);
      }
      ensurePiOperationCurrent(operationId);
      setToast(
        result.provider === "local-fallback"
          ? "模型分析未完成，已按原文 Markdown 结构创建本地蓝图；请检查后保存"
          : result.mocked
          ? "已分析本地演示参考模板，请检查后保存"
          : `已分析高保真参考模板 · ${result.model} · 请检查后保存`,
      );
      const styleProfile = result.styleProfile as unknown as Record<string, unknown>;
      const structureProfile = result.structureProfile as unknown as Record<string, unknown>;
      const layoutProfile = result.layoutProfile as unknown as Record<string, unknown>;
      return {
        id: `template-${Date.now()}`,
        name: result.name,
        description: result.description,
        category: result.category,
        markdown: result.markdown,
        styleProfile: {
          tone: String(styleProfile.tone ?? ""),
          audience: String(styleProfile.audience ?? ""),
          perspective: String(styleProfile.perspective ?? ""),
          sentenceStyle: String(styleProfile.sentenceStyle ?? styleProfile.sentence_style ?? ""),
          pacing: String(styleProfile.pacing ?? ""),
          density: String(styleProfile.density ?? ""),
        },
        structureProfile: {
          openingPattern: String(structureProfile.openingPattern ?? structureProfile.opening_pattern ?? ""),
          sectionPattern: String(structureProfile.sectionPattern ?? structureProfile.section_pattern ?? ""),
          conclusionPattern: String(structureProfile.conclusionPattern ?? structureProfile.conclusion_pattern ?? ""),
          headingDepth: String(structureProfile.headingDepth ?? structureProfile.heading_depth ?? ""),
          paragraphPattern: String(structureProfile.paragraphPattern ?? structureProfile.paragraph_pattern ?? ""),
        },
        layoutProfile: {
          useLists: Boolean(layoutProfile.useLists ?? layoutProfile.use_lists ?? true),
          useTables: Boolean(layoutProfile.useTables ?? layoutProfile.use_tables),
          useBlockquotes: Boolean(layoutProfile.useBlockquotes ?? layoutProfile.use_blockquotes),
          useCodeBlocks: Boolean(layoutProfile.useCodeBlocks ?? layoutProfile.use_code_blocks),
          imagePlacement: String(layoutProfile.imagePlacement ?? layoutProfile.image_placement ?? ""),
          emphasisRules: String(layoutProfile.emphasisRules ?? layoutProfile.emphasis_rules ?? ""),
        },
        fixedBlocks: result.fixedBlocks,
        variables: result.variables,
        usageInstructions: result.usageInstructions,
        mode: "reference",
        referenceMarkdown: sourceMarkdown.replace(/\r\n?/g, "\n").trim(),
        sourceFingerprint: result.sourceFingerprint,
        analysisVersion: result.analysisVersion,
        rightsConfirmed: true,
        isBuiltIn: false,
      } satisfies MarkdownTemplate;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(sanitizeActivityMessage(detail || "模板提取失败"));
    }
  };

  const toggleWorkflowNode = (nodeId: DisabledOptionalNodeId) => {
    setDisabledNodes((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const togglePublishTarget = (platform: PlatformId) => {
    if (publishAction || currentPublishSession) return;
    setPublishTargets((current) => {
      const next = new Set(current);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  };

  const preparePublishPlan = async () => {
    if (!selectedArticle || publishAction || publishTargets.size === 0) return;
    setPublishAction("prepare");
    setPublishError(null);
    try {
      const revisionId = await ensureRevision(selectedArticle.id, currentMarkdown);
      const plan = await desktopBridge.createPublishPlan({
        articleId: selectedArticle.id,
        revisionId,
        platforms: [...publishTargets],
      });
      setPublishSession({
        articleId: selectedArticle.id,
        revisionId,
        plan,
        receipts: [],
      });
      setToast(`已生成 ${plan.variants.length} 个平台版本`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setPublishError(`平台稿生成失败：${detail.slice(0, 160)}`);
    } finally {
      setPublishAction(null);
    }
  };

  const approvePublishPlan = async () => {
    if (!currentPublishSession || publishAction || publishSessionStale) return;
    setPublishAction("approve");
    setPublishError(null);
    try {
      const plan = await desktopBridge.approvePublishPlan({
        planId: currentPublishSession.plan.planId,
      });
      setPublishSession({ ...currentPublishSession, plan });
      setToast("平台稿已确认");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setPublishError(`确认失败：${detail.slice(0, 160)}`);
    } finally {
      setPublishAction(null);
    }
  };

  const enqueuePublishPlan = async () => {
    if (!currentPublishSession || publishAction || publishSessionStale) return;
    setPublishAction("enqueue");
    setPublishError(null);
    try {
      const plan = await desktopBridge.enqueuePublishPlan({
        planId: currentPublishSession.plan.planId,
      });
      setPublishSession({ ...currentPublishSession, plan });
      setToast(`${plan.jobs.length} 个发布任务已进入本地队列`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setPublishError(`加入队列失败：${detail.slice(0, 160)}`);
    } finally {
      setPublishAction(null);
    }
  };

  const processPublishJobs = async () => {
    if (!currentPublishSession || publishAction || publishSessionStale) return;
    const jobs = currentPublishSession.plan.jobs.filter(
      (job) => job.state === "pending" || job.state === "failed_retryable",
    );
    if (jobs.length === 0) return;
    setPublishAction("process");
    setPublishError(null);
    try {
      const receiptMap = new Map(
        currentPublishSession.receipts.map((receipt) => [receipt.jobId, receipt]),
      );
      for (const job of jobs) {
        const result = await desktopBridge.processPublishJob({ jobId: job.id });
        if (result.receipt) receiptMap.set(result.receipt.jobId, result.receipt);
      }
      const plan = await desktopBridge.getPublishPlan({
        planId: currentPublishSession.plan.planId,
      });
      setPublishSession({
        ...currentPublishSession,
        plan,
        receipts: [...receiptMap.values()],
      });
      setToast(`发布演练完成 · ${receiptMap.size} 个平台回执`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setPublishError(`执行失败：${detail.slice(0, 160)}`);
    } finally {
      setPublishAction(null);
    }
  };

  const reconcileUnknownPublishJobs = async () => {
    if (!currentPublishSession || publishAction || publishSessionStale) return;
    const jobs = currentPublishSession.plan.jobs.filter(
      (job) => job.state === "unknown" && job.reconcileRequired,
    );
    if (jobs.length === 0) return;
    setPublishAction("reconcile");
    setPublishError(null);
    try {
      const receiptMap = new Map(
        currentPublishSession.receipts.map((receipt) => [receipt.jobId, receipt]),
      );
      for (const job of jobs) {
        const result = await desktopBridge.reconcilePublishJob({ jobId: job.id });
        if (result.receipt) receiptMap.set(result.receipt.jobId, result.receipt);
      }
      const plan = await desktopBridge.getPublishPlan({
        planId: currentPublishSession.plan.planId,
      });
      setPublishSession({
        ...currentPublishSession,
        plan,
        receipts: [...receiptMap.values()],
      });
      if (plan.jobs.some((job) => job.state === "unknown")) {
        setPublishError("部分平台无法自动核验。请检查对应平台的草稿箱；系统没有重试这些任务，避免重复创建草稿。");
      } else {
        setToast("已完成发布结果核验");
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setPublishError(`核验失败：${detail.slice(0, 220)}`);
    } finally {
      setPublishAction(null);
    }
  };

  const resolveUnknownPublishJob = async (
    jobId: string,
    resolution: "draft_exists" | "draft_missing",
  ) => {
    if (!currentPublishSession || publishAction || publishSessionStale) return;
    setPublishAction("resolve");
    setPublishError(null);
    try {
      const result = await desktopBridge.resolveUnknownPublishJob({ jobId, resolution });
      const plan = await desktopBridge.getPublishPlan({
        planId: currentPublishSession.plan.planId,
      });
      const receipts = new Map(
        currentPublishSession.receipts.map((receipt) => [receipt.jobId, receipt]),
      );
      if (result.receipt) receipts.set(result.receipt.jobId, result.receipt);
      setPublishSession({
        ...currentPublishSession,
        plan,
        receipts: [...receipts.values()],
      });
      setToast(
        resolution === "draft_exists"
          ? "已按你的确认记录平台草稿，不会再次发送"
          : "已恢复为待执行状态；请在确认后手动再次执行发布",
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setPublishError(`人工确认失败：${detail.slice(0, 220)}`);
    } finally {
      setPublishAction(null);
    }
  };

  const refreshPublishPlan = async () => {
    if (!currentPublishSession || publishAction) return;
    setPublishAction("refresh");
    try {
      const plan = await desktopBridge.getPublishPlan({
        planId: currentPublishSession.plan.planId,
      });
      setPublishSession({ ...currentPublishSession, plan });
      setPublishError(null);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setPublishError(`刷新失败：${detail.slice(0, 160)}`);
    } finally {
      setPublishAction(null);
    }
  };

  const resetPublishPlan = () => {
    setPublishSession(null);
    setPublishError(null);
    setPublishTargets(new Set(selectedArticle?.channels ?? ["wechat", "csdn"]));
  };

  const configureModel = async (request: ConfigureModelRequest) => {
    if (configuringModel) return;
    setConfiguringModel(true);
    setModelError(null);
    setModelTest(null);
    try {
      const configuration = await desktopBridge.configureModel(request);
      setModelConfiguration(configuration);
      setModelProfiles(await desktopBridge.listModelProfiles());
      const result = await desktopBridge.testModelConnection();
      setModelTest(result);
      setRuntime(await desktopBridge.piRuntimeSnapshot());
      setToast(
        result.mocked
          ? "当前连接使用 Mock 模型"
          : `模型连接成功 · ${result.model}`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setModelError(`连接测试失败：${detail.slice(0, 160)}`);
    } finally {
      setConfiguringModel(false);
    }
  };

  const activateModelProfile = async (profileId: string) => {
    if (configuringModel) return;
    const previousProfiles = modelProfiles;
    setConfiguringModel(true);
    setModelError(null);
    setModelTest(null);
    setModelProfiles((current) => current.map((profile) => ({
      ...profile,
      active: profile.id === profileId,
    })));
    try {
      const configuration = await desktopBridge.activateModelProfile(profileId);
      setModelConfiguration(configuration);
      setModelProfiles(await desktopBridge.listModelProfiles());
      setRuntime(await desktopBridge.piRuntimeSnapshot());
      setToast(`已切换模型 · ${configuration.textModel}`);
    } catch (error) {
      setModelProfiles(previousProfiles);
      const detail = error instanceof Error ? error.message : String(error);
      setModelError(`切换模型失败：${detail.slice(0, 160)}`);
    } finally {
      setConfiguringModel(false);
    }
  };

  const discoverPiModels = async () => {
    if (modelDiscovering || !modelConfiguration) return;
    setModelDiscovering(true);
    setModelDiscoveryError(null);
    try {
      const discovery = await desktopBridge.discoverPiModels();
      setModelDiscovery(discovery);
      setToast(`已从模型服务读取 ${discovery.models.length} 个模型`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setModelDiscoveryError(detail.slice(0, 240));
    } finally {
      setModelDiscovering(false);
    }
  };

  const checkGitHubApplicationInfo = async () => {
    if (githubApplicationLoading) return;
    setGithubApplicationLoading(true);
    setGithubApplicationError(null);
    try {
      setGithubApplicationInfo(await desktopBridge.githubApplicationInfo());
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setGithubApplicationError(detail.slice(0, 160));
    } finally {
      setGithubApplicationLoading(false);
    }
  };

  const renderPage = () => {
    switch (activeNav) {
      case "create":
        return (
          <CreatePage
            generating={creatingArticle}
            activeModelProfileId={modelConfiguration?.profileId ?? null}
            modelProfiles={modelProfiles}
            onCreate={(request) => void createFromBrief(request)}
            onActivateModelProfile={(profileId) => void activateModelProfile(profileId)}
            onOpenSettings={() => navigate("settings")}
            mediaAssets={mediaAssets}
            onMediaChange={setSelectedMediaIds}
            onTemplateChange={setSelectedTemplateId}
            selectedMedia={selectedMedia}
            selectedTemplate={selectedTemplate}
            switchingModel={configuringModel}
            templates={templates}
          />
        );
      case "articles":
        return (
          <ArticlesPage
            articles={articleItems}
            contentReplacing={articleContentReplacing}
            dirty={dirty}
            editorMode={editorMode}
            generatedImageCount={
              selectedArticle ? generatedImages[selectedArticle.id] ?? 0 : 0
            }
            generatingImage={generatingImage}
            markdown={currentMarkdown}
            mediaAssets={mediaAssets}
            cancellingWorkflow={cancellingWorkflow}
            onCancelWorkflow={cancelCurrentWorkflow}
            onCreate={createBlankArticle}
            onEditorModeChange={setEditorMode}
            onApplyRewriteCandidate={applyArticleRewrite}
            canUndoRewrite={
              Boolean(selectedArticle && rewriteUndoArticleId === selectedArticle.id &&
                rewriteUndoRef.current[selectedArticle.id]?.after === currentMarkdown)
            }
            onGenerateImage={() => void generateImage()}
            onImageFileDrop={importImageIntoArticle}
            onMarkdownChange={updateArticleMarkdown}
            onPlatformChange={setSelectedPlatform}
            onPublishToPlatforms={publishCurrentArticleToWechatSync}
            onRefreshWechatSync={refreshWechatSyncStatus}
            onComposeVisual={composeVisualForCurrentArticle}
            onRewriteArticle={rewriteCurrentArticle}
            onRewriteRunStarted={registerPiRewriteRun}
            onUndoRewrite={undoLastArticleRewrite}
            onRunWorkflow={() => void improveCurrentArticle()}
            onSave={() => void saveCurrentArticle()}
            onSelect={selectArticle}
            platforms={publishablePlatforms}
            publishing={publishAction === "process"}
            saving={saving}
            selectedArticle={selectedArticle}
            selectedPlatform={selectedPlatform}
            workflowProgress={articleProgress}
            workflowWorkspace={
              selectedArticle ? workflowWorkspaces[selectedArticle.id] ?? null : null
            }
            workflowRunning={workflowRunning}
            wechatSyncRefreshing={refreshingWechatSync}
            wechatSyncStatus={wechatSyncStatus}
            writerStreaming={writerStreamingArticleId === selectedArticle?.id}
            workflowFailure={
              creationActivity?.status === "failed" &&
              failedCreationContext?.articleId === selectedArticle?.id
                ? {
                    detail: creationActivity.error ?? "工作流未返回具体失败原因。",
                    logs: creationActivity.logs,
                    retryable: creationActivity.retryable,
                  }
                : null
            }
            onRetryWorkflow={retryCreation}
          />
        );
      case "announcements":
        return <AnnouncementsPage />;
      case "publish":
        return (
          <PublishingPage
            action={publishAction}
            articles={articleItems}
            error={publishError}
            onApprove={() => void approvePublishPlan()}
            onEnqueue={() => void enqueuePublishPlan()}
            onOpenSettings={() => navigate("settings")}
            onPrepare={() => void preparePublishPlan()}
            onProcess={() => void processPublishJobs()}
            onReconcile={() => void reconcileUnknownPublishJobs()}
            onResolveUnknown={(jobId, resolution) =>
              void resolveUnknownPublishJob(jobId, resolution)
            }
            onRefresh={() => void refreshPublishPlan()}
            onReset={resetPublishPlan}
            onSelectArticle={selectArticle}
            onToggleTarget={togglePublishTarget}
            plan={currentPublishSession?.plan ?? null}
            platforms={publishablePlatforms}
            receipts={currentPublishSession?.receipts ?? []}
            selectedArticle={selectedArticle}
            selectedTargets={publishTargets}
            stale={publishSessionStale}
          />
        );
      case "templates":
        return (
          <TemplatesPage
            onChange={setTemplates}
            onCancelExtraction={() => { void cancelPiOperations(); }}
            onExtractTemplate={extractTemplateFromArticle}
            onSelect={setSelectedTemplateId}
            onStartCreating={() => navigate("create")}
            selectedTemplateId={selectedTemplateId}
            templates={templates}
          />
        );
      case "media":
        return (
          <MediaPage
            assets={mediaAssets}
            hasSelectedArticle={Boolean(selectedArticle)}
            onAdd={addMediaAsset}
            onInsertInArticle={insertSelectedMediaInArticle}
            onSelectionChange={setSelectedMediaIds}
            onStartCreating={() => navigate("create")}
            onUpload={createLocalMediaAsset}
            onUpdate={updateMediaAsset}
            selectedAssetIds={selectedMediaIds}
          />
        );
      case "settings":
        return (
          <SettingsPage
            configuring={configuringModel}
            disabledNodes={disabledNodes}
            modelConfiguration={modelConfiguration}
            modelProfiles={modelProfiles}
            modelError={modelError}
            modelDiscovery={modelDiscovery}
            modelDiscoveryError={modelDiscoveryError}
            modelDiscovering={modelDiscovering}
            modelTest={modelTest}
            githubApplicationInfo={githubApplicationInfo}
            githubApplicationLoading={githubApplicationLoading}
            githubApplicationError={githubApplicationError}
            onConfigureModel={(request) => void configureModel(request)}
            onDiscoverModels={() => void discoverPiModels()}
            onActivateModelProfile={(profileId) => void activateModelProfile(profileId)}
            onCheckGitHubApplicationInfo={() => void checkGitHubApplicationInfo()}
            onRevealSecret={(kind) => desktopBridge.revealModelSecret(kind)}
            onRefreshWechatSync={refreshWechatSyncStatus}
            onToggleNode={toggleWorkflowNode}
            platforms={configuredPlatforms}
            runtime={runtime}
            wechatSyncStatus={wechatSyncStatus}
            wechatSyncRefreshing={refreshingWechatSync}
          />
        );
    }
  };

  return (
    <div className="app-shell">
      <AppNavigation
        active={activeNav}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        onNavigate={navigate}
        onToggleTheme={() =>
          setTheme((current) => (current === "light" ? "dark" : "light"))
        }
        runtimeLabel={
          runtime?.bridgeMode === "interface_only" ? "浏览器演示" : "本机 SQLite"
        }
        runtimeReady={runtime?.state === "ready"}
        theme={theme}
      />

      <div className="app-workspace">
        <header className="workspace-topbar">
          <button
            aria-label="打开导航"
            className="icon-button workspace-topbar__menu"
            onClick={() => setMobileNavOpen(true)}
            type="button"
          >
            <Menu size={19} />
          </button>
          <strong>
            {activeNav === "create"
              ? "创作"
              : activeNav === "articles"
                ? "文章"
              : activeNav === "templates"
                ? "模板"
                : activeNav === "media"
                  ? "素材库"
                  : activeNav === "publish"
                    ? "发布"
                    : "设置"}
          </strong>
          <span className="workspace-topbar__spacer" />
          {runtime?.bridgeMode === "interface_only" && (
            <span className="workspace-host-warning" role="alert">
              浏览器预览不能执行 Agent
            </span>
          )}
          {activeNav !== "create" && (
            <button
              className="button button--quiet workspace-new"
              onClick={() => navigate("create")}
              type="button"
            >
              <Plus size={15} />
              新文章
            </button>
          )}
        </header>

        <main className={`page-viewport page-viewport--${activeNav}`} id="main-content">
          <PageErrorBoundary onReturnToCreate={() => navigate("create")} resetKey={activeNav}>
            {loadingArticles && activeNav === "articles" ? (
              <div className="page-loading" role="status">
                <span className="spinner" />
                正在读取本地文章
              </div>
            ) : (
              renderPage()
            )}
          </PageErrorBoundary>
        </main>
      </div>

      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button aria-label="关闭提示" onClick={() => setToast(null)} type="button">
            <X size={14} />
          </button>
        </div>
      )}
      {visualConfirmation && (
        <VisualPlanConfirmationDialog
          assets={visualConfirmation.assets}
          matchThreshold={visualConfirmation.matchThreshold}
          onApprove={resolveVisualConfirmation}
          onSkip={() => resolveVisualConfirmation(null)}
          plan={visualConfirmation.plan}
        />
      )}
    </div>
  );
}
