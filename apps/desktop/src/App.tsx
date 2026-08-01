import { Menu, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppNavigation } from "./components/AppNavigation";
import { AgentsPage } from "./components/AgentsPage";
import { ArticlesPage } from "./components/ArticlesPage";
import {
  CreatePage,
  type CreationActivity,
  type CreationLogEntry,
  type CreationRequest,
} from "./components/CreatePage";
import { LifecycleRail } from "./components/LifecycleRail";
import { MediaPage } from "./components/MediaPage";
import type { EditorMode } from "./components/MarkdownWorkbench";
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

const CREATION_ACTIVITY_STORAGE_KEY = "open-publisher-creation-activity";
const FAILED_CREATION_STORAGE_KEY = "open-publisher-failed-creation";
const AGENTS_STORAGE_KEY = "open-publisher-studio-agents";
const SKILLS_STORAGE_KEY = "open-publisher-studio-skills";
const TEMPLATES_STORAGE_KEY = "open-publisher-studio-templates";
const MEDIA_STORAGE_KEY = "open-publisher-studio-media";
const SELECTED_TEMPLATE_STORAGE_KEY = "open-publisher-studio-selected-template";
const SELECTED_MEDIA_STORAGE_KEY = "open-publisher-studio-selected-media";
const EDITOR_MODE_STORAGE_KEY = "open-publisher-studio-editor-mode";
const WORKFLOW_NODES_STORAGE_KEY = "open-publisher-studio-workflow-nodes";
const MAX_LOCAL_IMAGE_BYTES = 15 * 1024 * 1024;
const WORKFLOW_ACTIVITY_TIMEOUT_MS = 120_000;
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

const LEGACY_BUILT_IN_SKILL_ID_MIGRATIONS: Readonly<Record<string, string>> = {
  "image-planning": "baoyu-article-illustrator",
};

function isOptionalWorkflowNodeId(
  value: string | undefined,
): value is DisabledOptionalNodeId {
  return Boolean(
    value && OPTIONAL_WORKFLOW_NODE_IDS.includes(value as DisabledOptionalNodeId),
  );
}

function isWorkflowNodeId(value: string | undefined): value is WorkflowNodeId {
  return value === "draft" || value === "risk" || isOptionalWorkflowNodeId(value);
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

function isStoredSkill(value: unknown): value is StudioSkill {
  if (!value || typeof value !== "object") return false;
  const skill = value as Partial<StudioSkill>;
  return (
    typeof skill.id === "string" &&
    typeof skill.name === "string" &&
    typeof skill.description === "string" &&
    typeof skill.instructions === "string" &&
    typeof skill.source === "string" &&
    skill.isBuiltIn === false
  );
}

function loadCustomSkills() {
  const stored = loadStudioValue<unknown>(SKILLS_STORAGE_KEY, []);
  return Array.isArray(stored) ? stored.filter(isStoredSkill) : [];
}

function normalizeSavedSkillIds(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const normalized = value
    .filter((id): id is string => typeof id === "string")
    .map((id) => LEGACY_BUILT_IN_SKILL_ID_MIGRATIONS[id] ?? id)
    .slice(0, 12);
  return [...new Set(normalized)];
}

export function normalizeStudioAgents(value: unknown): StudioAgent[] {
  const stored = Array.isArray(value) ? value : [];
  const byId = new Map(
    stored
      .filter((agent): agent is StudioAgent => Boolean(agent && typeof agent === "object" && typeof (agent as StudioAgent).id === "string"))
      .map((agent) => [agent.id, agent]),
  );
  return defaultAgents.map((defaultAgent) => {
    const saved = byId.get(defaultAgent.id);
    if (!saved) return { ...defaultAgent, skillIds: [...defaultAgent.skillIds] };
    return {
      ...defaultAgent,
      name: typeof saved.name === "string" ? saved.name.slice(0, 120) : defaultAgent.name,
      role: typeof saved.role === "string" ? saved.role.slice(0, 120) : defaultAgent.role,
      description:
        typeof saved.description === "string"
          ? saved.description.slice(0, 500)
          : defaultAgent.description,
      prompt:
        typeof saved.prompt === "string" ? saved.prompt.slice(0, 6000) : defaultAgent.prompt,
      skillIds: normalizeSavedSkillIds(saved.skillIds, defaultAgent.skillIds),
      enabled: typeof saved.enabled === "boolean" ? saved.enabled : defaultAgent.enabled,
      // Node ownership is a fixed workflow contract, not a user-editable field.
      runtimeNodeId: defaultAgent.runtimeNodeId,
    };
  });
}

function isStoredMediaAsset(value: unknown): value is MediaAsset {
  if (!value || typeof value !== "object") return false;
  const asset = value as Partial<MediaAsset>;
  return (
    typeof asset.id === "string" &&
    typeof asset.name === "string" &&
    typeof asset.alt === "string" &&
    (asset.description === undefined || typeof asset.description === "string") &&
    typeof asset.src === "string" &&
    (asset.source === "uploaded" || asset.source === "generated") &&
    typeof asset.createdAt === "string"
  );
}

function loadMediaAssets() {
  const stored = loadStudioValue<unknown>(MEDIA_STORAGE_KEY, []);
  return Array.isArray(stored)
    ? stored.filter(isStoredMediaAsset).map((asset) => ({
        ...asset,
        description: asset.description ?? "",
      }))
    : [];
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
  return {
    mode: request.imagePlan.mode,
    targetCount: request.imagePlan.targetCount,
    assets: request.imageAssets.slice(0, 6).map((asset) => ({
      id: asset.id,
      alt: asset.alt.trim().slice(0, 160) || asset.name.slice(0, 160),
      description: asset.description.trim().slice(0, 600),
    })),
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

function insertionLineForHeading(lines: string[], heading: string | null) {
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
      line: insertionLineForHeading(lines, placement.afterHeading),
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

function buildCreationSeed(request: CreationRequest) {
  const title = request.title || request.topic;
  const references = request.references
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
    ? `\n\n## 写作结构\n\n请按「${request.template.name}」的章节组织正文。不要输出花括号占位符、模板说明或创作要求。\n\n${templateHeadings.map((heading) => `- ${heading}`).join("\n")}`
    : "";
  return `# ${title}

## 创作要求

- 主题：${request.topic}
- 类型：${request.contentType}
- 风格：${request.tone}
- 篇幅：${request.length}
${references}${template}`.trim();
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
  const [toast, setToast] = useState<string | null>(null);
  const [studioAgents, setStudioAgents] = useState<StudioAgent[]>(() =>
    normalizeStudioAgents(loadStudioValue<unknown>(AGENTS_STORAGE_KEY, defaultAgents)),
  );
  const [customSkills, setCustomSkills] = useState<StudioSkill[]>(loadCustomSkills);
  const [templates, setTemplates] = useState<MarkdownTemplate[]>(() =>
    loadStudioValue(TEMPLATES_STORAGE_KEY, defaultTemplates),
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

  const studioSkills = useMemo(
    () => [...availableSkills, ...customSkills],
    [customSkills],
  );

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
    window.localStorage.setItem(AGENTS_STORAGE_KEY, JSON.stringify(studioAgents));
  }, [studioAgents]);

  useEffect(() => {
    window.localStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(customSkills));
  }, [customSkills]);

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
    let cancelled = false;
    const loadMedia = async () => {
      try {
        const legacyAssets = loadMediaAssets();
        const databaseAssets = await loadMediaAssetsFromDatabase();
        const merged = new Map(databaseAssets.map((asset) => [asset.id, asset]));
        for (const asset of legacyAssets) merged.set(asset.id, asset);
        const assets = [...merged.values()];
        if (legacyAssets.length > 0) {
          await saveMediaAssetsToDatabase(legacyAssets);
          window.localStorage.removeItem(MEDIA_STORAGE_KEY);
        }
        if (!cancelled) setMediaAssets(assets);
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
    const timer = writerTypewriterTimersRef.current[articleId];
    if (timer !== undefined) window.clearTimeout(timer);
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
    writerTypewriterTimersRef.current[articleId] = window.setTimeout(() => {
      delete writerTypewriterTimersRef.current[articleId];
      const queued = writerTypewriterQueueRef.current[articleId] ?? "";
      if (!queued) {
        completeWriterTypewriterIfDrained(articleId);
        return;
      }

      // A small batch preserves the visual rhythm without re-rendering a full
      // Markdown preview once for every individual character.
      const characters = Array.from(queued);
      const renderedDelta = characters.slice(0, 3).join("");
      writerTypewriterQueueRef.current[articleId] = characters.slice(3).join("");
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
    }, 18);
  };

  useEffect(
    () => () => {
      Object.values(writerTypewriterTimersRef.current).forEach((timer) => {
        if (timer !== undefined) window.clearTimeout(timer);
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
    const interval = window.setInterval(() => void collect(), 1000);
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
    const placements = await Promise.all(
      plan.placements.map(async (placement, index) => {
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
          `正在并发生成第 ${index + 1} 张配图`,
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
      }),
    );

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
      throw error;
    } finally {
      stopActivityPolling();
    }
    clearWriterTypewriter(article.id);
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
      setArticleContentReplacing(true);
      applyWorkflowResult(article.id, summary, request.platforms);
      window.setTimeout(() => setArticleContentReplacing(false), 260);
      const composed = await composeVisualPlan(article, summary, request, startedAt);
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
                  `工作流已完成并生成修订 ${composed.revisionNumber}`,
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
          ? "已提取本地演示模板，请检查后保存"
          : `已提取模板结构 · ${result.model} · 请检查后保存`,
      );
      return {
        id: `template-${Date.now()}`,
        name: result.name,
        description: result.description,
        category: result.category,
        markdown: result.markdown,
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
            agents={studioAgents}
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
            onGenerateImage={() => void generateImage()}
            onImageFileDrop={importImageIntoArticle}
            onMarkdownChange={updateArticleMarkdown}
            onPlatformChange={setSelectedPlatform}
            onRunWorkflow={() => void improveCurrentArticle()}
            onSave={() => void saveCurrentArticle()}
            onSelect={selectArticle}
            platforms={configuredPlatforms}
            saving={saving}
            selectedArticle={selectedArticle}
            selectedPlatform={selectedPlatform}
            workflowProgress={articleProgress}
            workflowRunning={workflowRunning}
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
      case "agents":
        return (
          <AgentsPage
            agents={studioAgents}
            onChange={setStudioAgents}
            onSkillsChange={(skills) => setCustomSkills(skills.filter(isStoredSkill))}
            skills={studioSkills}
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
                : activeNav === "agents"
                  ? "智能体"
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
    </div>
  );
}
