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
import { useEffect, useMemo, useState } from "react";
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
  initialTasks,
  platforms,
  riskItems,
  workflowStages,
} from "./data/mock";
import { desktopBridge, type RuntimeSnapshot } from "./lib/desktopBridge";
import type { NavKey, PlatformId, TaskRecord } from "./types";

type EditorMode = "edit" | "split" | "preview";
type Theme = "light" | "ink";

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
  const [saving, setSaving] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("split");
  const [selectedPlatform, setSelectedPlatform] = useState<PlatformId>("wechat");
  const [theme, setTheme] = useState<Theme>(preferredTheme);
  const [railOpen, setRailOpen] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null);
  const [runningStageIndex, setRunningStageIndex] = useState<number | null>(null);
  const [workflowCompleted, setWorkflowCompleted] = useState(false);
  const [disabledStages, setDisabledStages] = useState<Set<string>>(new Set());
  const [generatedCount, setGeneratedCount] = useState(0);
  const [enabledSkills, setEnabledSkills] = useState(
    new Set(["social-card", "risk-words", "evidence"]),
  );
  const [tasks, setTasks] = useState<TaskRecord[]>(initialTasks);

  const selectedArticle =
    articleItems.find((article) => article.id === selectedArticleId) ?? articleItems[0];
  const currentMarkdown = drafts[selectedArticle.id] ?? selectedArticle.markdown;
  const currentArticle = { ...selectedArticle, markdown: currentMarkdown };
  const dirty = dirtyIds.has(selectedArticle.id);

  const displayedStages = useMemo(
    () =>
      workflowStages.map((stage) =>
        disabledStages.has(stage.id) ? { ...stage, state: "skipped" as const } : stage,
      ),
    [disabledStages],
  );

  const runOrder = useMemo(
    () =>
      workflowStages
        .map((stage, index) => ({ stage, index }))
        .filter(({ stage }) => !disabledStages.has(stage.id))
        .map(({ index }) => index),
    [disabledStages],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("open-publisher-theme", theme);
  }, [theme]);

  useEffect(() => {
    void desktopBridge.runtimeSnapshot().then(setRuntime);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (runningStageIndex === null) return;
    const timeout = window.setTimeout(() => {
      const orderPosition = runOrder.indexOf(runningStageIndex);
      const nextIndex = runOrder[orderPosition + 1];
      if (nextIndex === undefined) {
        setRunningStageIndex(null);
        setWorkflowCompleted(true);
        setToast("工作流完成：已生成一份待审核修订");
      } else {
        setRunningStageIndex(nextIndex);
      }
    }, 620);
    return () => window.clearTimeout(timeout);
  }, [runOrder, runningStageIndex]);

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

  const saveDraft = async () => {
    setSaving(true);
    try {
      const receipt = await desktopBridge.saveDraft({
        articleId: selectedArticle.id,
        baseRevision: null,
        markdown: currentMarkdown,
      });
      setArticleItems((current) =>
        current.map((article) =>
          article.id === selectedArticle.id
            ? {
                ...article,
                markdown: currentMarkdown,
                updatedAt: "刚刚",
                wordCount: currentMarkdown.replace(/\s/g, "").length,
              }
            : article,
        ),
      );
      setDirtyIds((current) => {
        const next = new Set(current);
        next.delete(selectedArticle.id);
        return next;
      });
      setToast(
        receipt.persistence === "memory"
          ? "修订已记入本地会话（演示模式）"
          : "修订已保存到本地数据库",
      );
    } catch {
      setToast("保存失败：桌面宿主没有响应，请检查本地运行时");
    } finally {
      setSaving(false);
    }
  };

  const runWorkflow = async () => {
    if (runningStageIndex !== null) return;
    try {
      const snapshot = await desktopBridge.ensureAgentRuntime();
      setRuntime(snapshot);
      setWorkflowCompleted(false);
      setRunningStageIndex(runOrder[0] ?? null);
      setToast("已冻结当前修订，工作流开始运行");
    } catch {
      setToast("工作流未启动：本地 Agent 运行时不可用");
    }
  };

  const toggleStage = (stageId: string) => {
    const stage = workflowStages.find((item) => item.id === stageId);
    if (!stage?.optional || runningStageIndex !== null) return;
    setDisabledStages((current) => {
      const next = new Set(current);
      if (next.has(stageId)) next.delete(stageId);
      else next.add(stageId);
      return next;
    });
    setWorkflowCompleted(false);
  };

  const toggleSkill = (skillId: string) => {
    setEnabledSkills((current) => {
      const next = new Set(current);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  };

  const queuePublish = () => {
    const task: TaskRecord = {
      id: `task-${40 + tasks.length}`,
      title: selectedArticle.title,
      platform: selectedPlatform,
      status: "queued",
      scheduledFor: "今天 20:30",
    };
    setTasks((current) => [task, ...current]);
    setToast("演练任务已加入本地 Outbox，没有访问真实平台");
  };

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
            onOpen={selectArticle}
            selectedId={selectedArticle.id}
          />
        );
      case "workflow":
        return (
          <WorkflowPage
            disabledStages={disabledStages}
            onRun={() => void runWorkflow()}
            onToggleStage={toggleStage}
            running={runningStageIndex !== null}
            stages={displayedStages}
          />
        );
      case "assets":
        return (
          <AssetsPage
            generatedCount={generatedCount}
            onGenerate={() => {
              setGeneratedCount((count) => count + 1);
              setToast("已生成一张演示素材，并记录提示词与模型信息");
            }}
          />
        );
      case "publish":
        return (
          <PublishPage
            onQueue={queuePublish}
            platforms={platforms}
            tasks={tasks}
          />
        );
      case "connections":
        return (
          <ConnectionsPage
            onCheck={(name) => setToast(`${name}：本地连接检查完成`)}
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
            disabled={runningStageIndex !== null}
            onClick={() => void runWorkflow()}
            type="button"
          >
            {runningStageIndex !== null ? <span className="spinner" /> : <Play size={14} />}
            {runningStageIndex !== null ? "运行中" : "运行工作流"}
          </button>
          <button className="icon-button" onClick={() => setPreviewOpen(true)} type="button" aria-label="打开平台预览">
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
        runningIndex={runningStageIndex}
        stages={displayedStages}
      />

      <div className="app-body">
        <div className={`nav-drawer${mobileNavOpen ? " is-open" : ""}`}>
          <LeftNavigation
            active={activeNav}
            articles={articleItems}
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
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPreviewOpen(false)}>
          <section
            aria-label="平台预览"
            aria-modal="true"
            className="preview-dialog"
            onMouseDown={(event) => event.stopPropagation()}
            role="dialog"
          >
            <header>
              <div><span className="eyebrow">PLATFORM PREVIEW</span><strong>{platforms.find((item) => item.id === selectedPlatform)?.name}</strong></div>
              <div className="platform-switch">
                {platforms.map((platform) => (
                  <button className={selectedPlatform === platform.id ? "is-active" : ""} key={platform.id} onClick={() => setSelectedPlatform(platform.id)} type="button">{platform.shortName}</button>
                ))}
              </div>
              <button className="icon-button" onClick={() => setPreviewOpen(false)} type="button" aria-label="关闭平台预览"><X size={18} /></button>
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
