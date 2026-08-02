import { Check, Image, Menu, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppNavigation } from "./components/AppNavigation";
import { ArticlesPage } from "./components/ArticlesPage";
import type { MarkdownSelection, RewriteCandidate } from "./components/ArticleAssistant";
import {
  CreatePage,
  type CreationActivity,
  type CreationLogEntry,
  type CreationRequest,
} from "./components/CreatePage";
import { LifecycleRail } from "./components/LifecycleRail";
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
import { platforms } from "./data/mock";
import {
  desktopBridge,
  type ConfigureModelRequest,
  type DisabledOptionalNodeId,
  type ModelConfigurationSummary,
  type ModelConnectionTestSummary,
  type PublishPlanSummary,
  type PublishReceiptSummary,
  type RewriteArticleSummary,
  type RewriteConversationMessage,
  type RuntimeSnapshot,
  type VisualCompositionPlanSummary,
  type VisualCompositionRequest,
  type VisualPlacementSummary,
  type WorkflowActivityEvent,
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
  TemplateContentAtomLedger,
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

interface FailedCreationContext {
  articleId: string;
  request: CreationRequest;
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
  resolve: (approved: boolean) => void;
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
const WORKFLOW_ACTIVITY_TIMEOUT_MS = 120_000;
const WORKFLOW_ACTIVITY_POLL_INTERVAL_MS = 160;
const MAX_AUTO_IN_ARTICLE_IMAGES = 4;
const INLINE_DATA_IMAGE_PATTERN =
  /!\[([^\]\r\n]*)\]\((data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=]+)\)/gi;
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

function isWorkflowNodeId(value: string | undefined): value is WorkflowNodeId {
  return value === "draft" || value === "reference-safety" || value === "risk" || isOptionalWorkflowNodeId(value);
}

function creationAgentLabels(
  agents: WorkflowAgentInstruction[],
) {
  return agents.map((agent) => agent.name);
}

function loadStudioValue<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
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

const emptyContentAtomLedger = (): TemplateContentAtomLedger => ({
  claims: [],
  facts: [],
  examples: [],
  quotes: [],
  namedEntities: [],
  caveats: [],
});

function normalizeTemplateLedger(value: unknown): TemplateContentAtomLedger {
  const candidate = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const list = (key: string, alternate?: string) => {
    const raw = candidate[key] ?? (alternate ? candidate[alternate] : undefined);
    return Array.isArray(raw)
      ? raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim().slice(0, 320)).slice(0, 48)
      : [];
  };
  return {
    claims: list("claims"),
    facts: list("facts"),
    examples: list("examples"),
    quotes: list("quotes"),
    namedEntities: list("namedEntities", "named_entities"),
    caveats: list("caveats"),
  };
}

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
    ? candidate.referenceMarkdown.replace(/\r\n?/g, "\n").trim().slice(0, 60_000)
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
    contentAtomLedger: normalizeTemplateLedger(candidate.contentAtomLedger),
    phraseBlacklist: Array.isArray(candidate.phraseBlacklist)
      ? candidate.phraseBlacklist.filter((phrase): phrase is string => typeof phrase === "string" && phrase.trim().length > 0)
        .map((phrase) => phrase.trim().slice(0, 180)).slice(0, 48)
      : [],
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

function visualCompositionFromCreation(
  request: CreationRequest,
): VisualCompositionRequest {
  const visualAssetDescription = (asset: MediaAsset) => {
    const hasStructuredDescription = Boolean(
      asset.visualDescription?.trim() ||
        asset.generationPrompt?.trim() ||
        (asset.tags && asset.tags.length > 0) ||
        (asset.usageHint?.trim() && asset.usageHint.trim() !== asset.description.trim()),
    );
    if (!hasStructuredDescription) return asset.description.trim().slice(0, 600);
    return [
      asset.visualDescription?.trim() && `图片内容：${asset.visualDescription.trim()}`,
      asset.usageHint?.trim() && `使用场景：${asset.usageHint.trim()}`,
      asset.generationPrompt?.trim() && `生成提示词：${asset.generationPrompt.trim()}`,
      asset.tags && asset.tags.length > 0 && `标签：${asset.tags.join("、")}`,
    ].filter(Boolean).join("\n").slice(0, 1_200);
  };
  return {
    mode: request.imagePlan.mode,
    targetCount: request.imagePlan.targetCount,
    assets: request.imageAssets.slice(0, 6).map((asset) => ({
      id: asset.id,
      alt: asset.alt.trim().slice(0, 160) || asset.name.slice(0, 160),
      description: visualAssetDescription(asset),
    })),
    assetScope: request.imageAssets.length > 0 ? "selected_only" : "none",
    preferredType: "infographic",
    density: request.imagePlan.mode === "auto" ? "balanced" : "minimal",
    style: "sketch-notes",
    palette: "macaron",
    preferredImageBackend: "auto",
    generationBatchSize: 4,
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

const workflowNodeLabel: Record<WorkflowNodeId, string> = {
  research: "资料整理",
  outline: "大纲规划",
  draft: "正文撰写",
  "natural-style": "自然表达",
  "reference-safety": "原创表达检查",
  review: "内容审阅",
  risk: "风险检查",
  visual: "配图规划",
};

function workflowAgentLabel(
  nodeId: WorkflowNodeId,
  agents: WorkflowAgentInstruction[],
) {
  return (
    agents.find((agent) => agent.nodeId === nodeId)?.name ?? workflowNodeLabel[nodeId]
  );
}

function describeWorkflowActivity(
  event: WorkflowActivityEvent,
  agents: WorkflowAgentInstruction[],
): { message: string; phase: string; tone: CreationLogEntry["tone"] } {
  const nodeId = event.nodeId;
  const agent = nodeId ? workflowAgentLabel(nodeId, agents) : null;
  const node = nodeId ? workflowNodeLabel[nodeId] : null;
  switch (event.eventType) {
    case "run.queued":
      return { message: "工作流已进入本地运行队列", phase: "等待 Agent 工作流启动", tone: "info" };
    case "run.started":
      return { message: "本地 Agent 工作流已开始执行", phase: "多 Agent 工作流正在执行", tone: "info" };
    case "run.budget_reserved":
      return { message: "本次模型调用预算已确认", phase: "多 Agent 工作流正在执行", tone: "info" };
    case "run.node_started":
      return {
        message: `${agent} 正在执行${node}`,
        phase: `${agent} 正在执行${node}`,
        tone: "info",
      };
    case "run.node_completed":
      return {
        message: `${agent} 已完成${node}`,
        phase: `${agent} 已完成${node}`,
        tone: "success",
      };
    case "run.node_output_delta":
      return {
        message: `${agent} 正在输出正文`,
        phase: `${agent} 正在撰写正文`,
        tone: "info",
      };
    case "run.node_failed":
      return {
        message: `${agent} 在${node}阶段失败`,
        phase: `${agent} 执行失败`,
        tone: "error",
      };
    case "run.node_skipped":
      return {
        message: `${agent} 已按当前设置跳过${node}`,
        phase: "多 Agent 工作流正在执行",
        tone: "info",
      };
    case "run.interrupted":
      return { message: "工作流正在等待人工审核", phase: "等待人工审核", tone: "info" };
    case "run.failed":
      return { message: "工作流已记录失败状态", phase: "文章生成失败", tone: "error" };
    case "run.completed":
      return { message: "工作流已完成", phase: "文章生成完成", tone: "success" };
    default:
      return { message: "工作流状态已更新", phase: "多 Agent 工作流正在执行", tone: "info" };
  }
}

function activityTimestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
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
  const context = stored as Partial<FailedCreationContext>;
  if (
    typeof context.articleId !== "string" ||
    !context.articleId ||
    !context.request ||
    typeof context.request !== "object"
  ) {
    return null;
  }
  return context as FailedCreationContext;
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

const MAX_CREATION_SEED_CHARACTERS = 78_000;

function truncateCharacters(value: string, maximum: number) {
  const characters = [...value];
  return characters.length <= maximum ? value : `${characters.slice(0, Math.max(0, maximum - 1)).join("")}…`;
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
    content_atom_ledger: template.contentAtomLedger ?? emptyContentAtomLedger(),
    phrase_blacklist: template.phraseBlacklist ?? [],
  }));
  return [
    `<!-- open-publisher-reference-template:v1:${metadata} -->`,
    `<${tag}>`,
    template.referenceMarkdown,
    `</${tag}>`,
  ].join("\n");
}

export function buildCreationSeed(request: CreationRequest) {
  const title = request.title || request.topic;
  const referenceBlock = request.template ? highFidelityReferenceBlock(request.template) : "";
  const maxReferenceCharacters = Math.max(
    0,
    MAX_CREATION_SEED_CHARACTERS - [...referenceBlock].length - 4_000,
  );
  const referenceNotes = request.references
    ? `\n\n## 参考资料\n\n${truncateCharacters(request.references, maxReferenceCharacters)}`
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
  if ([...seed].length <= MAX_CREATION_SEED_CHARACTERS) return seed;
  if (referenceBlock) {
    const minimalSeed = `# ${title}\n\n## 创作要求\n\n- 主题：${request.topic}\n- 类型：${request.contentType}\n- 风格：${request.tone}\n- 篇幅：${request.length}\n\n${referenceBlock}`;
    return truncateCharacters(minimalSeed, MAX_CREATION_SEED_CHARACTERS);
  }
  return truncateCharacters(seed, MAX_CREATION_SEED_CHARACTERS);
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
  onApprove,
  onSkip,
}: {
  plan: VisualCompositionPlanSummary;
  onApprove: () => void;
  onSkip: () => void;
}) {
  const generatedCount = plan.placements.filter((placement) => placement.source === "generate").length;
  return (
    <div className="studio-modal" role="presentation">
      <button aria-label="暂不插入配图" className="studio-modal__scrim" onClick={onSkip} type="button" />
      <section aria-describedby="visual-plan-confirmation-copy" aria-label="确认正文配图方案" aria-modal="true" className="visual-confirmation-dialog" role="dialog">
        <header>
          <div>
            <span className="page-kicker">正文配图方案</span>
            <h2>确认后再开始生成</h2>
            <p id="visual-plan-confirmation-copy">已保存配图大纲和 {generatedCount} 份生图提示词。本次将插入 {plan.targetCount} 张图片。</p>
          </div>
          <button aria-label="暂不插入配图" className="icon-button" onClick={onSkip} type="button"><X size={18} /></button>
        </header>
        <div className="visual-confirmation-dialog__settings" aria-label="方案设置">
          <span>{plan.settings.type ?? "infographic"}</span>
          <span>{plan.settings.style ?? "sketch-notes"}</span>
          <span>{plan.settings.palette ?? "default"}</span>
          <span>并发 {plan.settings.generation_batch_size ?? "4"}</span>
        </div>
        <ol className="visual-confirmation-dialog__list">
          {plan.placements.map((placement, index) => (
            <li key={placement.id}>
              <span className={`visual-confirmation-dialog__source is-${placement.source}`}><Image aria-hidden="true" size={14} /></span>
              <div>
                <div className="visual-confirmation-dialog__title"><strong>配图 {index + 1}</strong><small>{visualSourceLabel(placement.source)}</small></div>
                <p>{placement.purpose}</p>
                <blockquote>{placement.anchorExcerpt ?? placement.afterHeading ?? "需要在文章页确认插入位置"}</blockquote>
                <span className="visual-confirmation-dialog__reason">{placement.selectionReason}</span>
                {placement.candidates.length > 0 && <details><summary>素材匹配候选</summary><ul>{placement.candidates.map((candidate) => <li key={candidate.assetId}><strong>{candidate.assetId}</strong><span>{Math.round(candidate.score / 10)}% · {candidate.description}</span></li>)}</ul></details>}
              </div>
            </li>
          ))}
        </ol>
        <footer>
          <button className="button button--quiet" onClick={onSkip} type="button">暂不配图</button>
          <button className="button button--primary" onClick={onApprove} type="button"><Check size={16} />确认并继续</button>
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
  const [loadingArticles, setLoadingArticles] = useState(true);
  const [articleItems, setArticleItems] = useState<Article[]>([]);
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [revisionIds, setRevisionIds] = useState<Record<string, string>>({});
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [workflowRunning, setWorkflowRunning] = useState(false);
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
  const [modelTest, setModelTest] = useState<ModelConnectionTestSummary | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [configuringModel, setConfiguringModel] = useState(false);
  const [wechatSyncStatus, setWechatSyncStatus] =
    useState<WechatSyncBridgeStatus | null>(null);
  const [refreshingWechatSync, setRefreshingWechatSync] = useState(false);
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
    return typeof stored === "string" ? stored : defaultTemplates[0]?.id ?? null;
  });
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>(loadMediaAssets);
  const [mediaDatabaseReady, setMediaDatabaseReady] = useState(false);
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>(() => {
    const stored = loadStudioValue<unknown>(SELECTED_MEDIA_STORAGE_KEY, []);
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [];
  });
  const writerStreamRef = useRef<Record<string, string>>({});
  const writerTypewriterQueueRef = useRef<Record<string, string>>({});
  const writerTypewriterTimersRef = useRef<Record<string, number | undefined>>({});
  const writerDraftCompletedRef = useRef(new Set<string>());
  const [writerStreamingArticleId, setWriterStreamingArticleId] = useState<string | null>(null);
  const [articleProgress, setArticleProgress] = useState<ArticleProgress | null>(null);
  const [articleContentReplacing, setArticleContentReplacing] = useState(false);
  const [visualConfirmation, setVisualConfirmation] = useState<VisualConfirmationState | null>(null);
  const [rewriteUndoArticleId, setRewriteUndoArticleId] = useState<string | null>(null);
  const rewriteUndoRef = useRef<Record<string, { before: string; after: string }>>({});
  const dismissedWorkflowProgressArticleIds = useRef(new Set<string>());
  const lastWorkflowActivityAt = useRef(Date.now());

  const showArticleProgress = (progress: ArticleProgress) => {
    if (dismissedWorkflowProgressArticleIds.current.has(progress.articleId)) return;
    setArticleProgress(progress);
  };

  const dismissArticleProgress = () => {
    if (articleProgress) {
      dismissedWorkflowProgressArticleIds.current.add(articleProgress.articleId);
    }
    setArticleProgress(null);
  };

  const requestVisualConfirmation = (
    articleId: string,
    plan: VisualCompositionPlanSummary | null,
  ) => {
    if (!plan || plan.targetCount === 0 || !plan.needsConfirmation) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      setVisualConfirmation({ articleId, plan, resolve });
    });
  };

  const resolveVisualConfirmation = (approved: boolean) => {
    const pending = visualConfirmation;
    setVisualConfirmation(null);
    pending?.resolve(approved);
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
    () =>
      platforms.map((platform) => {
        const status = wechatSyncStatus?.platforms.find(
          (item) => item.id === platform.id,
        );
        return {
          ...platform,
          status: status?.authenticated ? "connected" as const : platform.status,
        };
      }),
    [wechatSyncStatus],
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
    if (!runtime) {
      setToast("正在检查本地运行时和模型连接，请稍候再开始创作。");
      return false;
    }
    if (runtime?.bridgeMode !== "python_sidecar") {
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
    if (!modelConfiguration?.imageBaseUrl || !modelConfiguration.imageModel) {
      const message = "请先在设置的“生图模型”中完成图片 API 与模型配置。";
      setModelError(message);
      setActiveNav("settings");
      setToast(message);
      return false;
    }
    return true;
  };

  const refreshWechatSyncStatus = async () => {
    if (runtime?.bridgeMode !== "python_sidecar") return;
    setRefreshingWechatSync(true);
    try {
      setWechatSyncStatus(await desktopBridge.wechatSyncStatus());
    } finally {
      setRefreshingWechatSync(false);
    }
  };

  const lifecycleStep = useMemo(() => {
    if (activeNav === "create") return creatingArticle ? "draft" : "brief";
    if (activeNav === "publish") return "publish";
    return "edit";
  }, [activeNav, creatingArticle]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("open-publisher-theme", theme);
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const snapshot = await desktopBridge.runtimeSnapshot();
        if (cancelled) return;
        setRuntime(snapshot);
        const [storedArticles, configuration] = await Promise.all([
          desktopBridge.listArticles(),
          desktopBridge.modelConfiguration(),
        ]);
        if (cancelled) return;
        setModelConfiguration(configuration);
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
        const readySnapshot = await desktopBridge.runtimeSnapshot();
        if (!cancelled) setRuntime(readySnapshot);
        if (readySnapshot.bridgeMode === "python_sidecar") {
          const publisherStatus = await desktopBridge.wechatSyncStatus();
          if (!cancelled) {
            setWechatSyncStatus(publisherStatus);
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
      window.localStorage.removeItem(CREATION_ACTIVITY_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      CREATION_ACTIVITY_STORAGE_KEY,
      JSON.stringify(creationActivity),
    );
  }, [creationActivity]);

  useEffect(() => {
    if (!failedCreationContext) {
      window.localStorage.removeItem(FAILED_CREATION_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      FAILED_CREATION_STORAGE_KEY,
      JSON.stringify(failedCreationContext),
    );
  }, [failedCreationContext]);

  useEffect(() => {
    window.localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
    if (selectedTemplateId && !templates.some((template) => template.id === selectedTemplateId)) {
      setSelectedTemplateId(templates[0]?.id ?? null);
    }
  }, [selectedTemplateId, templates]);

  useEffect(() => {
    window.localStorage.setItem(SELECTED_TEMPLATE_STORAGE_KEY, JSON.stringify(selectedTemplateId));
  }, [selectedTemplateId]);

  useEffect(() => {
    window.localStorage.setItem(SELECTED_MEDIA_STORAGE_KEY, JSON.stringify(selectedMediaIds));
  }, [selectedMediaIds]);

  useEffect(() => {
    window.localStorage.setItem(EDITOR_MODE_STORAGE_KEY, JSON.stringify(editorMode));
  }, [editorMode]);

  useEffect(() => {
    window.localStorage.setItem(WORKFLOW_NODES_STORAGE_KEY, JSON.stringify([...disabledNodes]));
  }, [disabledNodes]);

  useEffect(() => {
    window.localStorage.setItem(
      WORKFLOW_WORKSPACES_STORAGE_KEY,
      JSON.stringify(workflowWorkspaces),
    );
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
    setDrafts((current) => ({ ...current, [articleId]: compacted.markdown }));
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
    setDirtyIds((current) => new Set(current).add(articleId));
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
    setDrafts((current) => ({ ...current, [articleId]: markdown }));
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
    if (writerTypewriterQueueRef.current[articleId]) return;
    if (!writerDraftCompletedRef.current.has(articleId)) return;
    writerDraftCompletedRef.current.delete(articleId);
    setWriterStreamingArticleId((current) => (current === articleId ? null : current));
  };

  const scheduleWriterTypewriter = (articleId: string) => {
    if (writerTypewriterTimersRef.current[articleId] !== undefined) return;
    writerTypewriterTimersRef.current[articleId] = requestWriterFrame(() => {
      delete writerTypewriterTimersRef.current[articleId];
      const queued = writerTypewriterQueueRef.current[articleId] ?? "";
      if (!queued) {
        completeWriterTypewriterIfDrained(articleId);
        return;
      }

      const characters = Array.from(queued);
      // Never turn an upstream delta into a paragraph-sized visual jump.
      const renderedDelta = characters[0] ?? "";
      writerTypewriterQueueRef.current[articleId] = characters.slice(1).join("");
      const markdown = `${writerStreamRef.current[articleId] ?? ""}${renderedDelta}`;
      writerStreamRef.current[articleId] = markdown;
      setDrafts((current) => ({ ...current, [articleId]: markdown }));

      const remaining = writerTypewriterQueueRef.current[articleId];
      if (markdown.replace(/\s/g, "").length % 36 < renderedDelta.replace(/\s/g, "").length || !remaining) {
        showArticleProgress({
          articleId,
          title: "写作 Agent 正在输出正文",
          detail: `已流式写入 ${markdown.replace(/\s/g, "").length} 字。`,
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
      writerTypewriterQueueRef.current[articleId] =
        `${writerTypewriterQueueRef.current[articleId] ?? ""}${event.draftDelta}`;
      scheduleWriterTypewriter(articleId);
      showArticleProgress({
        articleId,
        title: "写作 Agent 正在输出正文",
        detail: "正在以打字机效果写入编辑器。",
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
        title: "写作 Agent 正在生成正文",
        detail: "正在等待模型返回第一段文本。",
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

  const startWorkflowActivityPolling = (
    articleId: string,
    agents: WorkflowAgentInstruction[],
  ) => {
    let stopped = false;
    let polling = false;
    let failedReads = 0;
    lastWorkflowActivityAt.current = Date.now();
    const seenEventIds = new Set(creationActivity?.logs.map((entry) => entry.id) ?? []);
    const collect = async () => {
      if (stopped || polling) return;
      polling = true;
      try {
        const activity = await desktopBridge.getWorkflowActivity(articleId);
        if (!activity || stopped) return;
        failedReads = 0;
        const unseen = activity.events.filter((event) => !seenEventIds.has(event.id));
        unseen.forEach((event) => seenEventIds.add(event.id));
        if (unseen.length > 0) lastWorkflowActivityAt.current = Date.now();
        appendWorkflowWorkspaceEvents(articleId, activity.runId, unseen);
        unseen.forEach((event) => receiveWorkflowActivity(articleId, event, agents));
        setCreationActivity((current) => {
          if (!current || current.status !== "running") return current;
          const visible = unseen.filter((event) => event.eventType !== "run.node_output_delta");
          if (visible.length === 0) return current;
          const latest = visible[visible.length - 1];
          const latestDescription = describeWorkflowActivity(latest, agents);
          return {
            ...current,
            phase: latestDescription.phase,
            logs: [
              ...current.logs,
              ...visible.map((event) => {
                const description = describeWorkflowActivity(event, agents);
                return activityLog(
                  event.id,
                  description.message,
                  description.tone,
                  activityTimestamp(event.createdAt),
                );
              }),
            ],
          };
        });
      } catch {
        failedReads += 1;
        if (failedReads >= 3) {
          showArticleProgress({
            articleId,
            title: "暂时无法读取本地运行时进度",
            detail: "仍在尝试恢复连接；若长时间无更新会自动提示重试。",
            value: null,
          });
        }
      } finally {
        polling = false;
      }
    };
    void collect();
    const interval = window.setInterval(
      () => void collect(),
      WORKFLOW_ACTIVITY_POLL_INTERVAL_MS,
    );
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  };

  const awaitWorkflowWithActivityTimeout = <Result,>(
    workflowPromise: Promise<Result>,
    articleId: string,
  ) =>
    new Promise<Result>((resolve, reject) => {
      let settled = false;
      const finish = (callback: (value: Result) => void, value: Result) => {
        if (settled) return;
        settled = true;
        window.clearInterval(timeout);
        callback(value);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        window.clearInterval(timeout);
        reject(error);
      };
      const timeout = window.setInterval(() => {
        if (Date.now() - lastWorkflowActivityAt.current < WORKFLOW_ACTIVITY_TIMEOUT_MS) return;
        showArticleProgress({
          articleId,
          title: "本地 Agent 已停止返回进度",
          detail: "等待已结束，请重试本次生成。",
          value: null,
        });
        fail(
          new Error(
            "本地 Agent 连续 2 分钟没有返回新的进度，可能已停止或网络请求卡住。请重试本次生成。",
          ),
        );
      }, 5_000);
      workflowPromise.then(
        (result) => finish(resolve, result),
        (error: unknown) => fail(error instanceof Error ? error : new Error(String(error))),
      );
    });

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
    setDrafts((current) => ({ ...current, [selectedArticle.id]: nextMarkdown }));
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
    setDirtyIds((current) => new Set(current).add(selectedArticle.id));
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
  ) => {
    setSaving(true);
    try {
      const receipt = await desktopBridge.saveDraft({
        articleId,
        baseRevision: revisionIds[articleId] ?? null,
        markdown,
      });
      setRevisionIds((current) => ({ ...current, [articleId]: receipt.revisionId }));
      setDrafts((current) => ({ ...current, [articleId]: markdown }));
      setArticleItems((current) =>
        current.map((article) =>
          article.id === articleId
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
            : article,
        ),
      );
      setDirtyIds((current) => {
        const next = new Set(current);
        next.delete(articleId);
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
    } finally {
      setSaving(false);
    }
  };

  const ensureRevision = async (articleId: string, markdown: string) => {
    const revisionId = revisionIds[articleId];
    if (revisionId && !dirtyIds.has(articleId)) return revisionId;
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
    setRevisionIds((current) => ({
      ...current,
      [articleId]: summary.outputRevisionId,
    }));
    setDrafts((current) => ({
      ...current,
      [articleId]: outputMarkdown,
    }));
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
    request: CreationRequest,
    startedAt: number,
  ) => {
    if (request.imagePlan.mode === "none") {
      return {
        revisionId: summary.outputRevisionId,
        revisionNumber: summary.outputRevisionNumber,
        markdown: summary.outputMarkdown,
        generatedCount: 0,
      };
    }

    const plan = summary.visualPlan;
    if (!plan) {
      throw new Error("视觉 Agent 没有返回配图计划，文章未插入图片。请重试本次生成。");
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
    const generatedCount = plan.placements.filter((placement) => !placement.assetId).length;
    let completedCount = 0;
    const updateVisualProgress = (detail: string) => {
      completedCount += 1;
      showArticleProgress({
        articleId: article.id,
        title: generatedCount > 0 ? "正在并发生成正文配图" : "正在插入素材库图片",
        detail,
        value: plan.targetCount ? Math.round((completedCount / plan.targetCount) * 86) : 86,
      });
    };
    if (plan.targetCount > 0) {
      showArticleProgress({
        articleId: article.id,
        title: generatedCount > 0 ? "正在并发生成正文配图" : "正在插入素材库图片",
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
        const result = await desktopBridge.generateImage({
          prompt: placement.generationPrompt,
          size: "1536x1024",
          model: modelConfiguration?.imageModel ?? null,
        });
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

    // The workflow output is durable before image composition. Use that exact
    // revision as the parent instead of waiting for React state to flush.
    const receipt = await desktopBridge.saveDraft({
      articleId: article.id,
      baseRevision: summary.outputRevisionId,
      markdown,
    });

    if (generatedAssets.length > 0) {
      setMediaAssets((current) => [
        ...generatedAssets,
        ...current.filter(
          (asset) => !generatedAssets.some((created) => created.id === asset.id),
        ),
      ]);
      setSelectedMediaIds((current) => [
        ...new Set([...current, ...generatedAssets.map((asset) => asset.id)]),
      ]);
      setGeneratedImages((current) => ({
        ...current,
        [article.id]: (current[article.id] ?? 0) + generatedAssets.length,
      }));
    }
    setArticleContentReplacing(true);
    setRevisionIds((current) => ({ ...current, [article.id]: receipt.revisionId }));
    setDrafts((current) => ({ ...current, [article.id]: markdown }));
    setArticleItems((current) =>
      current.map((currentArticle) =>
        currentArticle.id === article.id
          ? {
              ...currentArticle,
              title: titleFromMarkdown(markdown, currentArticle.title),
              deck: deckFromMarkdown(markdown),
              markdown,
              status: "review",
              updatedAt: "刚刚",
              wordCount: markdown.replace(/\s/g, "").length,
              revisionId: receipt.revisionId,
              revisionNumber: summary.outputRevisionNumber + 1,
            }
          : currentArticle,
      ),
    );
    setDirtyIds((current) => {
      const next = new Set(current);
      next.delete(article.id);
      return next;
    });
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
      revisionId: receipt.revisionId,
      revisionNumber: summary.outputRevisionNumber + 1,
      markdown,
      generatedCount: generatedAssets.length,
    };
  };

  const runWorkflowForArticle = async (
    article: Article,
    markdown: string,
    disabledNodeIds: DisabledOptionalNodeId[],
    channels?: PlatformId[],
    agentInstructions = buildWorkflowAgentInstructions(studioAgents, studioSkills),
  ) => {
    const revisionId = await ensureRevision(article.id, markdown);
    dismissedWorkflowProgressArticleIds.current.delete(article.id);
    lastWorkflowActivityAt.current = Date.now();
    beginWorkflowWorkspace(article.id);
    const workflowPromise = desktopBridge.runWorkflow({
      articleId: article.id,
      revisionId,
      topic: article.deck || article.title,
      disabledOptionalNodeIds: disabledNodeIds,
      agentInstructions,
      webSearchMode: "auto",
      maxWebSearchCalls: 2,
    });
    const stopActivityPolling = startWorkflowActivityPolling(article.id, agentInstructions);
    let summary: RunWorkflowSummary;
    try {
      summary = await awaitWorkflowWithActivityTimeout(workflowPromise, article.id);
    } catch (error) {
      clearWriterTypewriter(article.id);
      failWorkflowWorkspace(
        article.id,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    } finally {
      stopActivityPolling();
    }
    clearWriterTypewriter(article.id);
    completeWorkflowWorkspace(article.id, summary);
    setArticleContentReplacing(true);
    applyWorkflowResult(article.id, summary, channels);
    window.setTimeout(() => setArticleContentReplacing(false), 260);
    setArticleProgress(null);
    const snapshot = await desktopBridge.runtimeSnapshot();
    setRuntime(snapshot);
    return summary;
  };

  const executeCreation = async (
    article: Article,
    markdown: string,
    request: CreationRequest,
    retrying = false,
  ) => {
    const startedAt = Date.now();
    const previousLogs = retrying ? (creationActivity?.logs ?? []) : [];
    const agentInstructions =
      request.agentInstructions ?? buildWorkflowAgentInstructions(studioAgents, studioSkills);
    setCreatingArticle(true);
    setWorkflowRunning(true);
    dismissedWorkflowProgressArticleIds.current.delete(article.id);
    lastWorkflowActivityAt.current = Date.now();
    showArticleProgress({
      articleId: article.id,
      title: "正在准备创作",
      detail: "创作要求已保存后，会自动开始撰写正文。",
      value: null,
    });
    setFailedCreationContext(null);
    setCreationActivity({
      status: "running",
      phase: "正在保存创作要求",
      startedAt,
      elapsedSeconds: 0,
      agentLabels: creationAgentLabels(agentInstructions),
      logs: [
        ...previousLogs,
        activityLog(
          `${retrying ? "retry-started" : "request-accepted"}-${startedAt}`,
          retrying ? "开始重试本次生成" : "已接收创作请求",
        ),
      ],
      error: null,
      retryable: false,
    });
    let revisionSaved = false;
    try {
      const revisionId = await ensureRevision(article.id, markdown);
      revisionSaved = true;
      setCreationActivity((current) =>
        current
          ? {
              ...current,
              phase: "多 Agent 工作流正在执行",
              logs: [
                ...current.logs,
                activityLog(
                  `brief-saved-${startedAt}`,
                  "创作要求已保存",
                  "success",
                ),
                activityLog(
                  `workflow-started-${startedAt}`,
                  "已向本地 Agent 运行时提交工作流",
                ),
              ],
            }
          : current,
      );
      beginWorkflowWorkspace(article.id);
      const workflowPromise = desktopBridge.runWorkflow({
        articleId: article.id,
        revisionId,
        topic: article.deck || article.title,
        disabledOptionalNodeIds: visualNodeDisabledIds(
          request.disabledNodeIds,
          request.imagePlan,
        ),
        agentInstructions,
        webSearchMode: request.webSearchMode,
        maxWebSearchCalls: request.webSearchMode === "off" ? 0 : 2,
        visualComposition: visualCompositionFromCreation(request),
      });
      const stopActivityPolling = startWorkflowActivityPolling(article.id, agentInstructions);
      let summary: RunWorkflowSummary;
      try {
        summary = await awaitWorkflowWithActivityTimeout(workflowPromise, article.id);
      } catch (error) {
        clearWriterTypewriter(article.id);
        throw error;
      } finally {
        stopActivityPolling();
      }
      clearWriterTypewriter(article.id);
      completeWorkflowWorkspace(article.id, summary);
      setArticleContentReplacing(true);
      applyWorkflowResult(article.id, summary, request.platforms);
      window.setTimeout(() => setArticleContentReplacing(false), 260);
      const approvedVisualPlan = await requestVisualConfirmation(article.id, summary.visualPlan);
      let composed = approvedVisualPlan
        ? await composeVisualPlan(article, summary, request, startedAt)
        : {
            revisionId: summary.outputRevisionId,
            revisionNumber: summary.outputRevisionNumber,
            markdown: summary.outputMarkdown,
            generatedCount: 0,
          };
      if (!approvedVisualPlan && request.imagePlan.mode !== "none") {
        appendCreationActivity(
          "已跳过正文配图",
          `visual-plan-skipped-${startedAt}`,
          "文章已保留；未启动任何图片生成或素材插入。",
        );
      }
      const finalMarkdown = request.template
        ? applyTemplateFixedBlocks(composed.markdown, request.template, article, request)
        : composed.markdown;
      if (finalMarkdown !== composed.markdown) {
        const receipt = await desktopBridge.saveDraft({
          articleId: article.id,
          baseRevision: composed.revisionId,
          markdown: finalMarkdown,
        });
        composed = {
          ...composed,
          revisionId: receipt.revisionId,
          revisionNumber: composed.revisionNumber + 1,
          markdown: finalMarkdown,
        };
        applyWorkflowResult(
          article.id,
          {
            ...summary,
            outputRevisionId: composed.revisionId,
            outputRevisionNumber: composed.revisionNumber,
            outputMarkdown: composed.markdown,
          },
          request.platforms,
        );
      }
      setRuntime(await desktopBridge.runtimeSnapshot());
      setCreationActivity((current) =>
        current
          ? {
              ...current,
              status: "succeeded",
              phase: composed.generatedCount > 0 ? "文章与配图生成完成" : "文章生成完成",
              elapsedSeconds: Math.max(
                current.elapsedSeconds,
                Math.round((Date.now() - startedAt) / 1000),
              ),
              logs: [
                ...current.logs,
                activityLog(
                  `workflow-completed-${startedAt}`,
                  `工作流已完成，已按模板合成固定片段并生成修订 ${composed.revisionNumber}`,
                  "success",
                ),
              ],
            }
          : current,
      );
      setActiveNav("articles");
      setToast(
        `文章已生成 · 修订 ${composed.revisionNumber} · ${summary.artifacts.length} 项产物`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const safeDetail = sanitizeActivityMessage(detail || "未知错误");
      clearWriterTypewriter(article.id);
      failWorkflowWorkspace(article.id, safeDetail);
      if (!revisionSaved) {
        setDirtyIds((current) => new Set(current).add(article.id));
      }
      setFailedCreationContext({ articleId: article.id, request });
      setCreationActivity((current) =>
        current
          ? {
              ...current,
              status: "failed",
              phase: "文章生成失败",
              elapsedSeconds: Math.max(
                current.elapsedSeconds,
                Math.round((Date.now() - startedAt) / 1000),
              ),
              error: `失败原因：${safeDetail}`,
              retryable: true,
              logs: [
                ...current.logs,
                activityLog(
                  `workflow-failed-${startedAt}`,
                  `工作流失败：${safeDetail}`,
                  "error",
                ),
              ],
            }
          : current,
      );
      setWriterStreamingArticleId((current) => (current === article.id ? null : current));
      setArticleProgress(null);
      setToast("生成失败，创作要求已保留，可返回创作页修改后重试");
    } finally {
      setCreatingArticle(false);
      setWorkflowRunning(false);
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
    void executeCreation(article, markdown, normalizedRequest);
  };

  const retryCreation = () => {
    if (!failedCreationContext || creatingArticle || workflowRunning) return;
    if (!requireTextModel()) return;
    if (
      compositionCanRequireGeneratedImages(failedCreationContext.request) &&
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
    const markdown = drafts[article.id] ?? article.markdown;
    void executeCreation(article, markdown, failedCreationContext.request, true);
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
    setDrafts((current) => ({ ...current, [id]: markdown }));
    setDirtyIds((current) => new Set(current).add(id));
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
    setWorkflowRunning(true);
    try {
      const summary = await runWorkflowForArticle(
        selectedArticle,
        currentMarkdown,
        [
          ...new Set([
            ...disabledNodes,
            ...disabledOptionalNodesFor(studioAgents),
          ]),
        ],
      );
      setToast(`AI 处理完成 · 已生成修订 ${summary.outputRevisionNumber}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setToast(`AI 处理失败：${detail.slice(0, 120)}`);
    } finally {
      setWorkflowRunning(false);
    }
  };

  const rewriteCurrentArticle = async (
    instruction: string,
    selections: MarkdownSelection[],
    conversation: RewriteConversationMessage[],
    requestId: string,
  ): Promise<RewriteArticleSummary> => {
    if (!selectedArticle || workflowRunning || saving) {
      throw new Error("当前文章正在保存或执行工作流，请稍后再试。");
    }
    if (!requireTextModel()) {
      throw new Error("请先完成文本模型配置。");
    }
    return desktopBridge.rewriteArticle({
      articleId: selectedArticle.id,
      requestId,
      markdown: currentMarkdown,
      instruction,
      selectedTexts: selections.map((selection) => selection.text),
      conversation,
    });
  };

  const applyArticleRewrite = async (candidate: RewriteCandidate) => {
    if (!selectedArticle || workflowRunning || saving) {
      throw new Error("当前文章正在保存或执行工作流，请稍后再试。");
    }
    if (candidate.replacements.length !== (candidate.selections.length || 1)) {
      throw new Error("AI 返回的修改片段数量不匹配，请重新生成修改建议。");
    }
    let nextMarkdown = currentMarkdown;
    if (candidate.selections.length) {
      const replacements = candidate.selections
        .map((selection, index) => ({ selection, replacement: candidate.replacements[index]! }))
        .sort((left, right) => right.selection.start - left.selection.start);
      for (const { selection, replacement } of replacements) {
        if (currentMarkdown.slice(selection.start, selection.end) !== selection.text) {
          throw new Error("选中的原文已经变化，请重新选择后再生成修改建议。");
        }
        nextMarkdown = `${nextMarkdown.slice(0, selection.start)}${replacement}${nextMarkdown.slice(selection.end)}`;
      }
    } else {
      nextMarkdown = candidate.replacements[0] ?? "";
    }
    if (!nextMarkdown.trim()) throw new Error("AI 返回了空内容，未修改文章。");

    setArticleContentReplacing(true);
    try {
      const revisionId = await persistRevision(selectedArticle.id, nextMarkdown, false);
      rewriteUndoRef.current[selectedArticle.id] = {
        before: currentMarkdown,
        after: nextMarkdown,
      };
      setRewriteUndoArticleId(selectedArticle.id);
      setArticleItems((current) =>
        current.map((article) =>
          article.id === selectedArticle.id
            ? { ...article, status: "review", revisionId }
            : article,
        ),
      );
      setToast(`AI 修改已保存 · ${candidate.model}`);
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
    if (runtime?.bridgeMode !== "python_sidecar") {
      throw new Error("浏览器预览不能同步平台草稿，请在桌面应用中执行。");
    }
    setPublishAction("process");
    setPublishError(null);
    try {
      const status = await desktopBridge.wechatSyncStatus();
      setWechatSyncStatus(status);
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
      const result = await desktopBridge.generateImage({
        prompt: `为《${selectedArticle.title}》生成清晰克制的文章封面，不使用品牌标识。主题：${selectedArticle.deck}`,
        size: "1536x1024",
        model: modelConfiguration?.imageModel ?? null,
      });
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
      setSelectedMediaIds((current) => [
        ...new Set([...current, ...createdAssets.map((asset) => asset.id)]),
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
      const result = await desktopBridge.extractTemplate({ sourceMarkdown });
      setToast(
        result.mocked
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
        contentAtomLedger: normalizeTemplateLedger(result.contentAtomLedger),
        phraseBlacklist: result.phraseBlacklist,
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
      const result = await desktopBridge.testModelConnection();
      setModelTest(result);
      setRuntime(await desktopBridge.runtimeSnapshot());
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

  const renderPage = () => {
    switch (activeNav) {
      case "create":
        return (
          <CreatePage
            generating={creatingArticle}
            modelLabel={modelConfiguration?.textModel ?? "配置模型"}
            onCreate={(request) => void createFromBrief(request)}
            onOpenSettings={() => navigate("settings")}
            mediaAssets={mediaAssets}
            onMediaChange={setSelectedMediaIds}
            onTemplateChange={setSelectedTemplateId}
            selectedMedia={selectedMedia}
            selectedTemplate={selectedTemplate}
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
            onCreate={createBlankArticle}
            onDismissWorkflowProgress={dismissArticleProgress}
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
            onRefreshWechatSync={() => void refreshWechatSyncStatus()}
            onRewriteArticle={rewriteCurrentArticle}
            onUndoRewrite={undoLastArticleRewrite}
            onRunWorkflow={() => void improveCurrentArticle()}
            onSave={() => void saveCurrentArticle()}
            onSelect={selectArticle}
            platforms={configuredPlatforms}
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
            onRefresh={() => void refreshPublishPlan()}
            onReset={resetPublishPlan}
            onSelectArticle={selectArticle}
            onToggleTarget={togglePublishTarget}
            plan={currentPublishSession?.plan ?? null}
            platforms={configuredPlatforms}
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
            modelError={modelError}
            modelTest={modelTest}
            onConfigureModel={(request) => void configureModel(request)}
            onRefreshWechatSync={() => void refreshWechatSyncStatus()}
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

        {(activeNav === "create" || activeNav === "articles") && (
          <LifecycleRail
            active={lifecycleStep}
            busy={creatingArticle || workflowRunning || publishAction !== null}
          />
        )}

        <main className="page-viewport" id="main-content">
          {loadingArticles && activeNav === "articles" ? (
            <div className="page-loading" role="status">
              <span className="spinner" />
              正在读取本地文章
            </div>
          ) : (
            renderPage()
          )}
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
          onApprove={() => resolveVisualConfirmation(true)}
          onSkip={() => resolveVisualConfirmation(false)}
          plan={visualConfirmation.plan}
        />
      )}
    </div>
  );
}
