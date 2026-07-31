import { Menu, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
  defaultMediaAssets,
  defaultTemplates,
} from "./data/contentStudio";
import { articles as browserExamples, platforms } from "./data/mock";
import {
  desktopBridge,
  type ConfigureModelRequest,
  type DisabledOptionalNodeId,
  type ModelConfigurationSummary,
  type ModelConnectionTestSummary,
  type PublishPlanSummary,
  type PublishReceiptSummary,
  type RuntimeSnapshot,
  type RunWorkflowSummary,
  type StoredArticleSummary,
} from "./lib/desktopBridge";
import type {
  Article,
  MarkdownTemplate,
  MediaAsset,
  NavKey,
  PlatformId,
  StudioAgent,
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

const CREATION_ACTIVITY_STORAGE_KEY = "open-publisher-creation-activity";
const AGENTS_STORAGE_KEY = "open-publisher-studio-agents";
const TEMPLATES_STORAGE_KEY = "open-publisher-studio-templates";
const MEDIA_STORAGE_KEY = "open-publisher-studio-media";

function creationAgentLabels(
  agents: StudioAgent[],
  disabledNodeIds: DisabledOptionalNodeId[],
) {
  const disabled = new Set(disabledNodeIds);
  return agents
    .filter(
      (agent) =>
        agent.enabled &&
        (!agent.runtimeNodeId || !disabled.has(agent.runtimeNodeId as DisabledOptionalNodeId)),
    )
    .map((agent) => agent.name);
}

function loadStudioValue<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
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
): CreationLogEntry {
  return {
    id,
    timestamp: Date.now(),
    message: sanitizeActivityMessage(message),
    tone,
  };
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
  const images = request.imageAssets.length
    ? `\n\n## 已选图片素材\n\n${request.imageAssets
        .map((asset) => `![${asset.alt}](${asset.src})`)
        .join("\n\n")}`
    : "";
  const agentInstructions = request.agents.filter((agent) => agent.enabled).length
    ? `\n\n## 本次智能体工作规则\n\n${request.agents
        .filter((agent) => agent.enabled)
        .map(
          (agent) =>
            `### ${agent.name}（${agent.role}）\n${agent.prompt}\n已加载 Skill：${agent.skillIds.join("、") || "无"}`,
        )
        .join("\n\n")}`
    : "";
  return `# ${title}

## 创作要求

- 主题：${request.topic}
- 类型：${request.contentType}
- 风格：${request.tone}
- 篇幅：${request.length}
${references}${template}${images}${agentInstructions}`.trim();
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
  const [editorMode, setEditorMode] = useState<EditorMode>("split");
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformId>("wechat");
  const [disabledNodes, setDisabledNodes] = useState<Set<DisabledOptionalNodeId>>(
    () => new Set(["visual"]),
  );
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
  const [creationActivity, setCreationActivity] =
    useState<CreationActivity | null>(loadCreationActivity);
  const [failedCreationContext, setFailedCreationContext] =
    useState<FailedCreationContext | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [studioAgents, setStudioAgents] = useState<StudioAgent[]>(() =>
    loadStudioValue(AGENTS_STORAGE_KEY, defaultAgents),
  );
  const [templates, setTemplates] = useState<MarkdownTemplate[]>(() =>
    loadStudioValue(TEMPLATES_STORAGE_KEY, defaultTemplates),
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    () => defaultTemplates[0]?.id ?? null,
  );
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>(() =>
    loadStudioValue(MEDIA_STORAGE_KEY, defaultMediaAssets),
  );
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);

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
        const loaded =
          storedArticles.length > 0
            ? storedArticles.map(storedArticleToArticle)
            : snapshot.bridgeMode === "interface_only"
              ? browserExamples
              : [];
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
    window.localStorage.setItem(AGENTS_STORAGE_KEY, JSON.stringify(studioAgents));
  }, [studioAgents]);

  useEffect(() => {
    window.localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
    if (selectedTemplateId && !templates.some((template) => template.id === selectedTemplateId)) {
      setSelectedTemplateId(templates[0]?.id ?? null);
    }
  }, [selectedTemplateId, templates]);

  useEffect(() => {
    window.localStorage.setItem(MEDIA_STORAGE_KEY, JSON.stringify(mediaAssets));
    setSelectedMediaIds((current) => current.filter((id) => mediaAssets.some((asset) => asset.id === id)));
  }, [mediaAssets]);

  useEffect(() => {
    if (creationActivity?.status !== "running") return;
    const interval = window.setInterval(() => {
      setCreationActivity((current) => {
        if (!current || current.status !== "running") return current;
        const elapsedSeconds = Math.max(
          current.elapsedSeconds,
          Math.round((Date.now() - current.startedAt) / 1000),
        );
        const logs = [...current.logs];
        if (
          elapsedSeconds >= 15 &&
          !logs.some(
            (entry) => entry.id === `model-still-working-${current.startedAt}`,
          )
        ) {
          logs.push(
            activityLog(
              `model-still-working-${current.startedAt}`,
              "模型仍在处理，复杂工作流可能需要较长时间",
            ),
          );
        }
        if (
          elapsedSeconds >= 60 &&
          !logs.some((entry) => entry.id === `not-frozen-${current.startedAt}`)
        ) {
          logs.push(
            activityLog(
              `not-frozen-${current.startedAt}`,
              "应用没有卡死，正在等待多 Agent 工作流返回结果",
            ),
          );
        }
        return { ...current, elapsedSeconds, logs };
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [creationActivity?.status, creationActivity?.startedAt]);

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
    const nextTitle = titleFromMarkdown(markdown, selectedArticle.title);
    setDrafts((current) => ({ ...current, [selectedArticle.id]: markdown }));
    setArticleItems((current) =>
      current.map((article) =>
        article.id === selectedArticle.id
          ? {
              ...article,
              title: nextTitle,
              deck: deckFromMarkdown(markdown),
              wordCount: markdown.replace(/\s/g, "").length,
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
      .map((asset) => `![${asset.alt}](${asset.src})`)
      .join("\n\n");
    updateArticleMarkdown(`${currentMarkdown.trim()}\n\n${additions}\n`);
    setActiveNav("articles");
    setToast(`已插入 ${selectedMedia.length} 张图片，请在编辑器中调整位置和说明`);
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

  const applyWorkflowResult = (
    articleId: string,
    summary: RunWorkflowSummary,
    channels?: PlatformId[],
  ) => {
    const nextTitle = titleFromMarkdown(summary.outputMarkdown);
    setRevisionIds((current) => ({
      ...current,
      [articleId]: summary.outputRevisionId,
    }));
    setDrafts((current) => ({
      ...current,
      [articleId]: summary.outputMarkdown,
    }));
    setArticleItems((current) =>
      current.map((article) =>
        article.id === articleId
          ? {
              ...article,
              title: nextTitle,
              deck: deckFromMarkdown(summary.outputMarkdown),
              markdown: summary.outputMarkdown,
              status: "review",
              updatedAt: "刚刚",
              wordCount: summary.outputMarkdown.replace(/\s/g, "").length,
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

  const runWorkflowForArticle = async (
    article: Article,
    markdown: string,
    disabledNodeIds: DisabledOptionalNodeId[],
    channels?: PlatformId[],
  ) => {
    const revisionId = await ensureRevision(article.id, markdown);
    const summary = await desktopBridge.runWorkflow({
      articleId: article.id,
      revisionId,
      topic: article.deck || article.title,
      disabledOptionalNodeIds: disabledNodeIds,
    });
    applyWorkflowResult(article.id, summary, channels);
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
    setCreatingArticle(true);
    setWorkflowRunning(true);
    setFailedCreationContext(null);
    setCreationActivity({
      status: "running",
      phase: "正在保存创作要求",
      startedAt,
      elapsedSeconds: 0,
      agentLabels: creationAgentLabels(studioAgents, request.disabledNodeIds),
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
                  "多 Agent 工作流已启动",
                ),
              ],
            }
          : current,
      );
      const summary = await desktopBridge.runWorkflow({
        articleId: article.id,
        revisionId,
        topic: article.deck || article.title,
        disabledOptionalNodeIds: request.disabledNodeIds,
      });
      applyWorkflowResult(article.id, summary, request.platforms);
      setRuntime(await desktopBridge.runtimeSnapshot());
      setCreationActivity((current) =>
        current
          ? {
              ...current,
              status: "succeeded",
              phase: "文章生成完成",
              elapsedSeconds: Math.max(
                current.elapsedSeconds,
                Math.round((Date.now() - startedAt) / 1000),
              ),
              logs: [
                ...current.logs,
                activityLog(
                  `workflow-completed-${startedAt}`,
                  `工作流已完成并生成修订 ${summary.outputRevisionNumber}`,
                  "success",
                ),
              ],
            }
          : current,
      );
      setActiveNav("articles");
      setToast(
        `文章已生成 · 修订 ${summary.outputRevisionNumber} · ${summary.artifacts.length} 项产物`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const safeDetail = sanitizeActivityMessage(detail || "未知错误");
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
      setActiveNav("create");
      setToast("生成失败，创作要求已保留，可在日志下方重试");
    } finally {
      setCreatingArticle(false);
      setWorkflowRunning(false);
    }
  };

  const createFromBrief = (request: CreationRequest) => {
    if (creatingArticle || workflowRunning) return;
    const agentDisabledNodes = studioAgents
      .filter((agent) => !agent.enabled && agent.runtimeNodeId)
      .map((agent) => agent.runtimeNodeId as DisabledOptionalNodeId);
    const normalizedRequest = {
      ...request,
      disabledNodeIds: [...new Set([...request.disabledNodeIds, ...agentDisabledNodes])],
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
    void executeCreation(article, markdown, normalizedRequest);
  };

  const retryCreation = () => {
    if (!failedCreationContext || creatingArticle || workflowRunning) return;
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
    setWorkflowRunning(true);
    try {
      const summary = await runWorkflowForArticle(
        selectedArticle,
        currentMarkdown,
        [
          ...new Set([
            ...disabledNodes,
            ...studioAgents
              .filter((agent) => !agent.enabled && agent.runtimeNodeId)
              .map((agent) => agent.runtimeNodeId as DisabledOptionalNodeId),
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
    setGeneratingImage(true);
    try {
      const result = await desktopBridge.generateImage({
        prompt: `为《${selectedArticle.title}》生成清晰克制的文章封面，不使用品牌标识。主题：${selectedArticle.deck}`,
        size: "1536x1024",
        model: modelConfiguration?.imageModel ?? null,
      });
      setGeneratedImages((current) => ({
        ...current,
        [selectedArticle.id]:
          (current[selectedArticle.id] ?? 0) + result.artifactCount,
      }));
      setToast(
        result.mocked
          ? "已生成本地演示配图"
          : `已生成 ${result.artifactCount} 张配图 · ${result.model}`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setToast(`配图生成失败：${detail.slice(0, 120)}`);
    } finally {
      setGeneratingImage(false);
    }
  };

  const extractTemplateFromArticle = async (sourceMarkdown: string) => {
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
            activity={creationActivity}
            generating={creatingArticle}
            modelLabel={modelConfiguration?.textModel ?? "配置模型"}
            onCreate={(request) => void createFromBrief(request)}
            onOpenMedia={() => navigate("media")}
            onOpenSettings={() => navigate("settings")}
            onOpenTemplates={() => navigate("templates")}
            onRetry={retryCreation}
            platforms={platforms}
            agents={studioAgents}
            selectedMedia={selectedMedia}
            selectedTemplate={selectedTemplate}
          />
        );
      case "articles":
        return (
          <ArticlesPage
            articles={articleItems}
            dirty={dirty}
            editorMode={editorMode}
            generatedImageCount={
              selectedArticle ? generatedImages[selectedArticle.id] ?? 0 : 0
            }
            generatingImage={generatingImage}
            markdown={currentMarkdown}
            onCreate={createBlankArticle}
            onEditorModeChange={setEditorMode}
            onGenerateImage={() => void generateImage()}
            onMarkdownChange={updateArticleMarkdown}
            onPlatformChange={setSelectedPlatform}
            onRunWorkflow={() => void improveCurrentArticle()}
            onSave={() => void saveCurrentArticle()}
            onSelect={selectArticle}
            platforms={platforms}
            saving={saving}
            selectedArticle={selectedArticle}
            selectedPlatform={selectedPlatform}
            workflowRunning={workflowRunning}
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
            platforms={platforms}
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
            skills={availableSkills}
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
            onAdd={(asset) => setMediaAssets((current) => [asset, ...current])}
            onInsertInArticle={insertSelectedMediaInArticle}
            onSelectionChange={setSelectedMediaIds}
            onStartCreating={() => navigate("create")}
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
            onToggleNode={toggleWorkflowNode}
            platforms={platforms}
            runtime={runtime}
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
