import {
  Bell,
  Bot,
  Command,
  Eye,
  Menu,
  Moon,
  PanelRightOpen,
  Play,
  Search,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ContextRail } from "./components/ContextRail";
import {
  ArticlesPage,
  AssetsPage,
  ConnectionsPage,
  PlatformPreviewCard,
  PublishPage,
  SkillsPage,
  TasksPage,
  WorkflowPage,
} from "./components/FeaturePages";
import { LeftNavigation } from "./components/LeftNavigation";
import { MarkdownWorkbench } from "./components/MarkdownWorkbench";
import { WorkflowStrip } from "./components/WorkflowStrip";
import {
  articles as initialArticles,
  evidenceItems,
  platforms,
  riskItems,
  workflowStages,
} from "./data/mock";
import {
  desktopBridge,
  type ConnectionProfilePublic,
  type CreateConnectionProfileRequest,
  type DisabledOptionalNodeId,
  type PublishPlanSummary,
  type PublishReceiptSummary,
  type RuntimeSnapshot,
  type RunWorkflowSummary,
} from "./lib/desktopBridge";
import type { NavKey, PlatformId, TaskRecord } from "./types";

type EditorMode = "edit" | "split" | "preview";
type Theme = "light" | "ink";
type PublishAction = "prepare" | "approve" | "enqueue" | "process" | "refresh" | null;

interface PublishSession {
  articleId: string;
  revisionId: string;
  plan: PublishPlanSummary;
  receipts: PublishReceiptSummary[];
  idempotencyVerified: boolean;
}

interface ArticleWorkflowRun extends RunWorkflowSummary {
  articleId: string;
}

function preferredTheme(): Theme {
  const saved = window.localStorage.getItem("open-publisher-theme");
  if (saved === "light" || saved === "ink") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "ink" : "light";
}

export default function App() {
  const [activeNav, setActiveNav] = useState<NavKey>("workspace");
  const [articleItems, setArticleItems] = useState(initialArticles);
  const [selectedArticleId, setSelectedArticleId] = useState(initialArticles[0].id);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialArticles.map((article) => [article.id, article.markdown])),
  );
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [revisionIds, setRevisionIds] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("split");
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformId>("wechat");
  const [theme, setTheme] = useState<Theme>(preferredTheme);
  const [railOpen, setRailOpen] = useState(
    () => !window.matchMedia?.("(max-width: 900px)").matches,
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null);
  const [workflowRunning, setWorkflowRunning] = useState(false);
  const [workflowCompleted, setWorkflowCompleted] = useState(false);
  const [lastWorkflowRun, setLastWorkflowRun] = useState<ArticleWorkflowRun | null>(null);
  const [disabledStages, setDisabledStages] = useState<Set<string>>(new Set());
  const [generatedCount, setGeneratedCount] = useState(0);
  const [generatingAsset, setGeneratingAsset] = useState(false);
  const [enabledSkills, setEnabledSkills] = useState(
    new Set(["risk-words", "evidence"]),
  );
  const [publishTargets, setPublishTargets] = useState<Set<PlatformId>>(
    () => new Set(initialArticles[0].channels),
  );
  const [publishSession, setPublishSession] = useState<PublishSession | null>(null);
  const [publishAction, setPublishAction] = useState<PublishAction>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [connectionProfiles, setConnectionProfiles] = useState<ConnectionProfilePublic[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [connectionsRefreshKey, setConnectionsRefreshKey] = useState(0);
  const [previewTrigger, setPreviewTrigger] = useState<HTMLElement | null>(null);
  const previewDialogRef = useRef<HTMLElement>(null);

  const selectedArticle =
    articleItems.find((article) => article.id === selectedArticleId) ?? articleItems[0];
  const currentMarkdown = drafts[selectedArticle.id] ?? selectedArticle.markdown;
  const currentArticle = { ...selectedArticle, markdown: currentMarkdown };
  const dirty = dirtyIds.has(selectedArticle.id);
  const currentPublishSession =
    publishSession?.articleId === selectedArticle.id ? publishSession : null;
  const publishSessionStale = Boolean(
    currentPublishSession &&
      (dirty || revisionIds[selectedArticle.id] !== currentPublishSession.revisionId),
  );

  const displayedStages = useMemo(
    () =>
      workflowStages.map((stage) =>
        disabledStages.has(stage.id) ? { ...stage, state: "skipped" as const } : stage,
      ),
    [disabledStages],
  );

  const tasks = useMemo<TaskRecord[]>(() => {
    if (!publishSession) return [];
    const article =
      articleItems.find((item) => item.id === publishSession.articleId) ?? selectedArticle;
    return publishSession.plan.jobs.map((job) => ({
      id: job.id,
      title: article.title,
      platform: job.platform,
      status:
        job.state === "succeeded"
          ? "done"
          : job.state === "in_progress" || job.state === "reconciling"
            ? "running"
            : job.state === "pending" || job.state === "failed_retryable"
              ? "queued"
              : "blocked",
      scheduledFor:
        job.state === "succeeded" ? "本地演练已完成" : "SQLite Outbox",
    }));
  }, [articleItems, publishSession, selectedArticle]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("open-publisher-theme", theme);
  }, [theme]);

  useEffect(() => {
    void desktopBridge.runtimeSnapshot().then(setRuntime);
  }, []);

  useEffect(() => {
    if (activeNav !== "connections") return;
    let cancelled = false;
    setConnectionsLoading(true);
    setConnectionsError(null);
    void desktopBridge
      .listConnectionProfiles()
      .then((profiles) => {
        if (!cancelled) {
          setConnectionProfiles(profiles);
          void desktopBridge.runtimeSnapshot().then(setRuntime).catch(() => undefined);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const detail = error instanceof Error ? error.message : String(error);
        setConnectionsError(detail.slice(0, 160));
      })
      .finally(() => {
        if (!cancelled) setConnectionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeNav, connectionsRefreshKey]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    setPublishTargets(new Set(selectedArticle.channels));
    setPublishError(null);
  }, [selectedArticle.id]);

  const selectArticle = (articleId: string) => {
    if (dirty) setToast("当前修改保留在本次会话中，离开前记得保存");
    setSelectedArticleId(articleId);
    setActiveNav("workspace");
    setMobileNavOpen(false);
  };

  const updateMarkdown = (markdown: string) => {
    setDrafts((current) => ({ ...current, [selectedArticle.id]: markdown }));
    setDirtyIds((current) => new Set(current).add(selectedArticle.id));
  };

  const persistRevision = async (
    articleId: string,
    markdown: string,
    announce: boolean,
  ): Promise<string> => {
    setSaving(true);
    try {
      const receipt = await desktopBridge.saveDraft({
        articleId,
        baseRevision: revisionIds[articleId] ?? null,
        markdown,
      });
      setRevisionIds((current) => ({
        ...current,
        [articleId]: receipt.revisionId,
      }));
      setArticleItems((current) =>
        current.map((article) =>
          article.id === articleId
            ? {
                ...article,
                markdown,
                updatedAt: "刚刚",
                wordCount: markdown.replace(/\s/g, "").length,
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
            ? "修订已记入本地会话（演示模式）"
            : "修订已保存到本地数据库",
        );
      }
      return receipt.revisionId;
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = async () => {
    try {
      await persistRevision(selectedArticle.id, currentMarkdown, true);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setToast(`保存失败：${detail.slice(0, 120)}`);
    }
  };

  const ensureRevision = async (articleId: string, markdown: string) => {
    const currentRevisionId = revisionIds[articleId];
    if (currentRevisionId && !dirtyIds.has(articleId)) return currentRevisionId;
    return persistRevision(articleId, markdown, false);
  };

  const runWorkflow = async () => {
    if (workflowRunning) return;
    const articleId = selectedArticle.id;
    const inputMarkdown = currentMarkdown;
    setWorkflowCompleted(false);
    setWorkflowRunning(true);
    try {
      const revisionId = await ensureRevision(articleId, inputMarkdown);
      const summary = await desktopBridge.runWorkflow({
        articleId,
        revisionId,
        topic: selectedArticle.deck,
        disabledOptionalNodeIds: [...disabledStages].filter(
          (nodeId): nodeId is DisabledOptionalNodeId =>
            nodeId === "research" ||
            nodeId === "outline" ||
            nodeId === "natural-style" ||
            nodeId === "review" ||
            nodeId === "visual",
          ),
      });
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
                markdown: summary.outputMarkdown,
                status: "review",
                updatedAt: "刚刚",
                wordCount: summary.outputMarkdown.replace(/\s/g, "").length,
              }
            : article,
        ),
      );
      setDirtyIds((current) => {
        const next = new Set(current);
        next.delete(articleId);
        return next;
      });
      setLastWorkflowRun({ ...summary, articleId });
      setWorkflowCompleted(summary.status === "completed");
      void desktopBridge.runtimeSnapshot().then(setRuntime).catch(() => undefined);
      setToast(
        `工作流已完成 · 修订 ${summary.outputRevisionNumber} · ${summary.artifacts.length} 个持久化产物`,
      );
    } catch (error) {
      setWorkflowCompleted(false);
      const detail = error instanceof Error ? error.message : String(error);
      setToast(`工作流失败：${detail.slice(0, 120)}`);
    } finally {
      setWorkflowRunning(false);
    }
  };

  const toggleStage = (stageId: string) => {
    const stage = workflowStages.find((item) => item.id === stageId);
    if (!stage?.optional || workflowRunning) return;
    setDisabledStages((current) => {
      const next = new Set(current);
      if (next.has(stageId)) next.delete(stageId);
      else next.add(stageId);
      return next;
    });
    setWorkflowCompleted(false);
  };

  const toggleSkill = (skillId: string) => {
    if (skillId === "social-card") return;
    setEnabledSkills((current) => {
      const next = new Set(current);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  };

  const createConnection = async (request: CreateConnectionProfileRequest) => {
    const profile = await desktopBridge.createConnectionProfile(request);
    void desktopBridge.runtimeSnapshot().then(setRuntime).catch(() => undefined);
    setConnectionProfiles((current) => [
      profile,
      ...current.filter((item) => item.id !== profile.id),
    ]);
    setToast(`已保存“${profile.name}”的公开配置与凭证引用`);
  };

  const generateAsset = async () => {
    if (generatingAsset) return;
    setGeneratingAsset(true);
    try {
      const summary = await desktopBridge.generateImage({
        prompt: `为《${selectedArticle.title}》生成一张克制、清晰、无品牌标识的文章封面。主题：${selectedArticle.deck}`,
        size: "1536x1024",
        model: null,
      });
      setGeneratedCount((count) => count + summary.artifactCount);
      setToast(
        `已保存 ${summary.artifactCount} 个配图 Artifact · ${summary.provider}/${summary.model}`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setToast(`配图生成失败：${detail.slice(0, 120)}`);
    } finally {
      setGeneratingAsset(false);
    }
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
    if (publishAction || publishTargets.size === 0) return;
    const articleId = selectedArticle.id;
    setPublishAction("prepare");
    setPublishError(null);
    try {
      const revisionId = await ensureRevision(articleId, currentMarkdown);
      const plan = await desktopBridge.createPublishPlan({
        articleId,
        revisionId,
        platforms: [...publishTargets],
      });
      setPublishSession({
        articleId,
        revisionId,
        plan,
        receipts: [],
        idempotencyVerified: false,
      });
      setToast(`发布计划已生成 · ${plan.variants.length} 个平台变体待检查`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setPublishError(`计划生成失败：${detail.slice(0, 180)}`);
    } finally {
      setPublishAction(null);
    }
  };

  const approvePublishPlan = async () => {
    if (publishAction || !currentPublishSession || publishSessionStale) return;
    setPublishAction("approve");
    setPublishError(null);
    try {
      const plan = await desktopBridge.approvePublishPlan({
        planId: currentPublishSession.plan.planId,
      });
      setPublishSession({ ...currentPublishSession, plan });
      setToast("发布计划已由你明确批准，尚未执行任何平台动作");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setPublishError(`批准失败：${detail.slice(0, 180)}`);
    } finally {
      setPublishAction(null);
    }
  };

  const enqueuePublishPlan = async () => {
    if (publishAction || !currentPublishSession || publishSessionStale) return;
    setPublishAction("enqueue");
    setPublishError(null);
    try {
      const request = { planId: currentPublishSession.plan.planId };
      const first = await desktopBridge.enqueuePublishPlan(request);
      const second = await desktopBridge.enqueuePublishPlan(request);
      const firstIds = first.jobs.map((job) => job.id).sort();
      const secondIds = second.jobs.map((job) => job.id).sort();
      const idempotencyVerified =
        firstIds.length > 0 &&
        firstIds.length === secondIds.length &&
        firstIds.every((id, index) => id === secondIds[index]);
      if (!idempotencyVerified) {
        throw new Error("重复入队返回了不同的任务集合");
      }
      setPublishSession({
        ...currentPublishSession,
        plan: second,
        idempotencyVerified: true,
      });
      setToast(`幂等验证通过 · 两次入队均复用 ${second.jobs.length} 个 SQLite 任务`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setPublishError(`入队失败：${detail.slice(0, 180)}`);
    } finally {
      setPublishAction(null);
    }
  };

  const processPublishJobs = async () => {
    if (publishAction || !currentPublishSession || publishSessionStale) return;
    const processableJobs = currentPublishSession.plan.jobs.filter(
      (job) => job.state === "pending" || job.state === "failed_retryable",
    );
    if (processableJobs.length === 0) return;
    setPublishAction("process");
    setPublishError(null);
    try {
      const receiptByJob = new Map(
        currentPublishSession.receipts.map((receipt) => [receipt.jobId, receipt]),
      );
      for (const job of processableJobs) {
        const result = await desktopBridge.processPublishJob({ jobId: job.id });
        if (result.receipt) receiptByJob.set(result.receipt.jobId, result.receipt);
      }
      const plan = await desktopBridge.getPublishPlan({
        planId: currentPublishSession.plan.planId,
      });
      setPublishSession({
        ...currentPublishSession,
        plan,
        receipts: [...receiptByJob.values()],
      });
      setToast(`本地 dry-run 已完成 · ${receiptByJob.size} 个 Receipt 已写入 SQLite`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setPublishError(`执行失败：${detail.slice(0, 180)}`);
    } finally {
      setPublishAction(null);
    }
  };

  const refreshPublishPlan = async () => {
    if (publishAction || !currentPublishSession) return;
    setPublishAction("refresh");
    setPublishError(null);
    try {
      const plan = await desktopBridge.getPublishPlan({
        planId: currentPublishSession.plan.planId,
      });
      setPublishSession({ ...currentPublishSession, plan });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setPublishError(`刷新失败：${detail.slice(0, 180)}`);
    } finally {
      setPublishAction(null);
    }
  };

  const resetPublishPlan = () => {
    if (publishAction) return;
    setPublishSession(null);
    setPublishTargets(new Set(selectedArticle.channels));
    setPublishError(null);
  };

  const createArticle = () => {
    const id = `art-local-${Date.now()}`;
    const article = {
      id,
      title: "未命名文章",
      deck: "从这里开始记录你的观点、证据和发布计划。",
      markdown: "# 未命名文章\n\n从这里开始写作。",
      status: "draft" as const,
      updatedAt: "刚刚",
      wordCount: 13,
      channels: ["wechat", "csdn"] as PlatformId[],
      collection: "未分类",
    };
    setArticleItems((current) => [article, ...current]);
    setDrafts((current) => ({ ...current, [id]: article.markdown }));
    setSelectedArticleId(id);
    setActiveNav("workspace");
    setMobileNavOpen(false);
    setToast("已创建本地草稿");
  };

  const closePreview = () => {
    setPreviewOpen(false);
    window.setTimeout(() => previewTrigger?.focus(), 0);
  };

  useEffect(() => {
    if (!previewOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePreview();
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(
          previewDialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewOpen, previewTrigger]);

  const navigate = (nav: NavKey) => {
    setActiveNav(nav);
    setMobileNavOpen(false);
  };

  const renderMain = () => {
    switch (activeNav) {
      case "workspace":
        return (
          <MarkdownWorkbench
            article={selectedArticle}
            dirty={dirty}
            editorMode={editorMode}
            markdown={currentMarkdown}
            onEditorModeChange={setEditorMode}
            onMarkdownChange={updateMarkdown}
            onPlatformChange={setSelectedPlatform}
            onSave={() => void saveDraft()}
            platforms={platforms}
            saving={saving}
            selectedPlatform={selectedPlatform}
          />
        );
      case "articles":
        return (
          <ArticlesPage
            articles={articleItems}
            onCreate={createArticle}
            onOpen={selectArticle}
            selectedId={selectedArticle.id}
          />
        );
      case "workflow":
        return (
          <WorkflowPage
            disabledStages={disabledStages}
            lastRun={
              lastWorkflowRun?.articleId === selectedArticle.id ? lastWorkflowRun : null
            }
            onRun={() => void runWorkflow()}
            onToggleStage={toggleStage}
            running={workflowRunning}
            stages={displayedStages}
          />
        );
      case "assets":
        return (
          <AssetsPage
            generatedCount={generatedCount}
            generating={generatingAsset}
            onGenerate={generateAsset}
          />
        );
      case "publish":
        return (
          <PublishPage
            action={publishAction}
            articleTitle={selectedArticle.title}
            error={publishError}
            idempotencyVerified={currentPublishSession?.idempotencyVerified ?? false}
            onApprove={() => void approvePublishPlan()}
            onEnqueue={() => void enqueuePublishPlan()}
            onPrepare={() => void preparePublishPlan()}
            onProcess={() => void processPublishJobs()}
            onRefresh={() => void refreshPublishPlan()}
            onReset={resetPublishPlan}
            onToggleTarget={togglePublishTarget}
            plan={currentPublishSession?.plan ?? null}
            platforms={platforms}
            receipts={currentPublishSession?.receipts ?? []}
            revisionId={revisionIds[selectedArticle.id] ?? null}
            selectedTargets={publishTargets}
            stale={publishSessionStale}
          />
        );
      case "connections":
        return (
          <ConnectionsPage
            error={connectionsError}
            loading={connectionsLoading}
            onCreate={createConnection}
            onRetry={() => setConnectionsRefreshKey((value) => value + 1)}
            profiles={connectionProfiles}
          />
        );
      case "skills":
        return <SkillsPage enabled={enabledSkills} onToggle={toggleSkill} />;
      case "tasks":
        return <TasksPage platforms={platforms} tasks={tasks} />;
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__seal">开</span>
          <div><strong>Open Publisher</strong><small>砚台工作台</small></div>
        </div>
        <button
          aria-expanded={mobileNavOpen}
          aria-label="打开项目导航"
          className="icon-button mobile-menu"
          onClick={() => setMobileNavOpen((open) => !open)}
          type="button"
        >
          <Menu size={19} />
        </button>
        <label className="global-search">
          <Search size={15} />
          <input aria-label="全局搜索" placeholder="搜索稿件、任务或 Skill" />
          <span><Command size={11} /> K</span>
        </label>
        <div className="topbar__actions">
          <span className={`runtime-pill runtime-pill--${runtime?.state ?? "standby"}`}>
            <i />
            {runtime?.state === "ready" ? "本地桥接就绪" : "本地模式"}
          </span>
          <button
            className="button button--quiet run-button"
            disabled={workflowRunning || saving}
            onClick={() => void runWorkflow()}
            type="button"
          >
            {workflowRunning ? <span className="spinner" /> : <Play size={14} />}
            {workflowRunning ? "运行中" : "运行工作流"}
          </button>
          <button className="icon-button" onClick={(event) => { setPreviewTrigger(event.currentTarget); setPreviewOpen(true); }} type="button" aria-label="打开平台预览">
            <Eye size={17} />
          </button>
          <button
            className="icon-button"
            onClick={() => setTheme((current) => (current === "light" ? "ink" : "light"))}
            type="button"
            aria-label={theme === "light" ? "切换深墨主题" : "切换冷瓷主题"}
          >
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
          </button>
          <button className="icon-button notification-button" type="button" aria-label="通知">
            <Bell size={17} /><i />
          </button>
          <button className="icon-button" onClick={() => setRailOpen(true)} type="button" aria-label="打开证据与风险侧栏">
            <PanelRightOpen size={17} />
          </button>
        </div>
      </header>

      <WorkflowStrip
        completed={workflowCompleted}
        running={workflowRunning}
        stages={displayedStages}
      />

      <div className="app-body">
        <div className={`nav-drawer${mobileNavOpen ? " is-open" : ""}`}>
          <LeftNavigation
            active={activeNav}
            articles={articleItems}
            onCreateArticle={createArticle}
            onNavigate={navigate}
            onSelectArticle={selectArticle}
            selectedArticleId={selectedArticle.id}
          />
        </div>
        <main className="main-content">{renderMain()}</main>
        <ContextRail
          evidence={evidenceItems}
          onClose={() => setRailOpen(false)}
          open={railOpen}
          risks={riskItems}
        />
      </div>

      {previewOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={closePreview}>
          <section
            aria-label="平台预览"
            aria-modal="true"
            className="preview-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            ref={previewDialogRef}
            role="dialog"
          >
            <header>
              <div><span className="eyebrow">PLATFORM PREVIEW</span><strong>{platforms.find((item) => item.id === selectedPlatform)?.name}</strong></div>
              <div className="platform-switch">
                {platforms.map((platform) => (
                  <button className={selectedPlatform === platform.id ? "is-active" : ""} key={platform.id} onClick={() => setSelectedPlatform(platform.id)} type="button">{platform.shortName}</button>
                ))}
              </div>
              <button autoFocus className="icon-button" onClick={closePreview} type="button" aria-label="关闭平台预览"><X size={18} /></button>
            </header>
            <PlatformPreviewCard article={currentArticle} platform={selectedPlatform} />
          </section>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          <Bot size={17} />
          <span>{toast}</span>
          <button aria-label="关闭提示" onClick={() => setToast(null)} type="button"><X size={14} /></button>
        </div>
      )}
    </div>
  );
}
