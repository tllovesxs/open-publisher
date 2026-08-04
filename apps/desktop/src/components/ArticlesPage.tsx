import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  GripVertical,
  ImagePlus,
  LoaderCircle,
  Plus,
  Save,
  Search,
  Send,
  Sparkles,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { CreationLogEntry } from "./CreatePage";
import {
  ArticleAssistant,
  type MarkdownSelection,
  type RewriteCandidate,
} from "./ArticleAssistant";
import type { Article, MediaAsset, PlatformDefinition, PlatformId } from "../types";
import { ImageInsertDialog } from "./ImageInsertDialog";
import { MarkdownWorkbench, type EditorMode, type ImageInsertion } from "./MarkdownWorkbench";
import { PublishDialog } from "./PublishDialog";
import type { WorkflowWorkspaceSnapshot } from "./WorkflowWorkspace";
import type {
  RewriteArticleSummary,
  RewriteConversationMessage,
  WechatSyncBridgeStatus,
} from "../lib/desktopBridge";
import type { AssistantActivity } from "./ArticleAssistant";

interface WorkflowProgress {
  articleId: string;
  title: string;
  detail: string;
  value: number | null;
}

interface WorkflowFailure {
  detail: string;
  logs: CreationLogEntry[];
  retryable: boolean;
}

interface ArticlesPageProps {
  articles: Article[];
  selectedArticle: Article | null;
  markdown: string;
  dirty: boolean;
  saving: boolean;
  workflowRunning: boolean;
  generatingImage: boolean;
  generatedImageCount: number;
  editorMode: EditorMode;
  selectedPlatform: PlatformId;
  platforms: PlatformDefinition[];
  mediaAssets: MediaAsset[];
  onCreate: () => void;
  onSelect: (articleId: string) => void;
  onMarkdownChange: (markdown: string) => void;
  onSave: () => void;
  onRunWorkflow: () => void;
  onGenerateImage: () => void;
  onEditorModeChange: (mode: EditorMode) => void;
  onPlatformChange: (platform: PlatformId) => void;
  onImageFileDrop?: (file: File) => Promise<ImageInsertion>;
  writerStreaming: boolean;
  workflowProgress: WorkflowProgress | null;
  workflowWorkspace: WorkflowWorkspaceSnapshot | null;
  contentReplacing: boolean;
  workflowFailure: WorkflowFailure | null;
  onRetryWorkflow: () => void;
  onCancelWorkflow: () => void;
  cancellingWorkflow: boolean;
  wechatSyncStatus: WechatSyncBridgeStatus | null;
  wechatSyncRefreshing: boolean;
  publishing: boolean;
  onRefreshWechatSync: () => void;
  onPublishToPlatforms: (platforms: PlatformId[]) => Promise<void>;
  onRewriteArticle: (
    instruction: string,
    selections: MarkdownSelection[],
    conversation: Array<{ role: "user" | "assistant"; text: string }>,
    requestId: string,
  ) => Promise<RewriteArticleSummary>;
  onComposeVisual: (
    instruction: string,
    conversation: RewriteConversationMessage[],
    onActivity: (activity: AssistantActivity) => void,
  ) => Promise<{ summary: string }>;
  onApplyRewriteCandidate: (candidate: RewriteCandidate) => Promise<void>;
  canUndoRewrite: boolean;
  onUndoRewrite: () => Promise<void>;
}

const statusLabel: Record<Article["status"], string> = {
  draft: "草稿",
  review: "待审核",
  ready: "可发布",
  published: "已发布",
};

const articleBrowserPreferenceKey = "open-publisher.articles.browser.v1";
const articleBrowserBounds = { min: 208, max: 320, default: 248 } as const;

interface ArticleBrowserPreference {
  collapsed: boolean;
  width: number;
}

function clampArticleBrowserWidth(width: number) {
  return Math.min(articleBrowserBounds.max, Math.max(articleBrowserBounds.min, Math.round(width)));
}

function loadArticleBrowserPreference(): ArticleBrowserPreference {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(articleBrowserPreferenceKey) ?? "null");
    if (!value || typeof value !== "object") {
      return { collapsed: false, width: articleBrowserBounds.default };
    }
    const preference = value as Partial<ArticleBrowserPreference>;
    return {
      collapsed: preference.collapsed === true,
      width: typeof preference.width === "number"
        ? clampArticleBrowserWidth(preference.width)
        : articleBrowserBounds.default,
    };
  } catch {
    return { collapsed: false, width: articleBrowserBounds.default };
  }
}

export function ArticlesPage({
  articles,
  selectedArticle,
  markdown,
  dirty,
  saving,
  workflowRunning,
  generatingImage,
  generatedImageCount,
  editorMode,
  selectedPlatform,
  platforms,
  mediaAssets,
  onCreate,
  onSelect,
  onMarkdownChange,
  onSave,
  onRunWorkflow,
  onGenerateImage,
  onEditorModeChange,
  onPlatformChange,
  onImageFileDrop,
  writerStreaming,
  workflowProgress,
  workflowWorkspace,
  contentReplacing,
  workflowFailure,
  onRetryWorkflow,
  onCancelWorkflow,
  cancellingWorkflow,
  wechatSyncStatus,
  wechatSyncRefreshing,
  publishing,
  onRefreshWechatSync,
  onPublishToPlatforms,
  onRewriteArticle,
  onComposeVisual,
  onApplyRewriteCandidate,
  canUndoRewrite,
  onUndoRewrite,
}: ArticlesPageProps) {
  const [query, setQuery] = useState("");
  const [articleBrowser, setArticleBrowser] = useState<ArticleBrowserPreference>(
    loadArticleBrowserPreference,
  );
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [pendingImageInsertion, setPendingImageInsertion] = useState<ImageInsertion | null>(null);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [selections, setSelections] = useState<MarkdownSelection[]>([]);
  const layoutRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(articleBrowserPreferenceKey, JSON.stringify(articleBrowser));
    } catch {
      // Panel dimensions are a convenience. The article workspace remains usable without storage.
    }
  }, [articleBrowser]);

  useEffect(() => {
    if (!selectedArticle?.id) return;
    setSelections([]);
  }, [selectedArticle?.id]);
  const filteredArticles = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return articles;
    return articles.filter((article) =>
      `${article.title} ${article.collection}`.toLocaleLowerCase().includes(normalized),
    );
  }, [articles, query]);

  const toggleArticleBrowser = () => {
    setArticleBrowser((current) => ({ ...current, collapsed: !current.collapsed }));
  };

  const updateArticleBrowserWidth = (width: number) => {
    setArticleBrowser((current) => ({ ...current, collapsed: false, width: clampArticleBrowserWidth(width) }));
  };

  const handleResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || articleBrowser.collapsed) return;
    event.preventDefault();
    const previousCursor = document.body.style.cursor;
    document.body.style.cursor = "col-resize";
    const onMove = (moveEvent: PointerEvent) => {
      const rect = layoutRef.current?.getBoundingClientRect();
      if (!rect) return;
      updateArticleBrowserWidth(moveEvent.clientX - rect.left);
    };
    const onEnd = () => {
      document.body.style.cursor = previousCursor;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd, { once: true });
    window.addEventListener("pointercancel", onEnd, { once: true });
  };

  const articleLayoutStyle = {
    "--article-browser-width": `${articleBrowser.width}px`,
  } as CSSProperties;

  if (!selectedArticle) {
    return (
      <section className="page empty-page">
        <FileText aria-hidden="true" size={28} />
        <h1>还没有文章</h1>
        <button className="button button--primary" onClick={onCreate} type="button">
          <Plus size={16} />
          新建文章
        </button>
      </section>
    );
  }

  return (
    <section
      className={`articles-layout${articleBrowser.collapsed ? " is-browser-collapsed" : ""}`}
      ref={layoutRef}
      style={articleLayoutStyle}
    >
      <aside className="article-browser" aria-label="文章列表">
        <div className="article-browser__head">
          <div>
            <span className="page-kicker">内容库</span>
            <strong>文章</strong>
          </div>
          <button
            aria-label="新建文章"
            className="icon-button"
            onClick={onCreate}
            title="新建文章"
            type="button"
          >
            <Plus size={18} />
          </button>
        </div>
        <label className="article-search">
          <Search aria-hidden="true" size={15} />
          <span className="visually-hidden">搜索文章</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索文章"
            value={query}
          />
        </label>
        <div className="article-list">
          {filteredArticles.map((article) => (
            <button
              aria-current={selectedArticle.id === article.id ? "true" : undefined}
              className={`article-list-item${
                selectedArticle.id === article.id ? " is-active" : ""
              }`}
              key={article.id}
              onClick={() => onSelect(article.id)}
              type="button"
            >
              <span className={`article-status article-status--${article.status}`}>
                {statusLabel[article.status]}
              </span>
              <strong>{article.title}</strong>
              <span className="article-list-item__meta">
                <span>{article.updatedAt}</span>
                <span>{article.wordCount} 字</span>
              </span>
            </button>
          ))}
          {filteredArticles.length === 0 && (
            <p className="article-list__empty">没有匹配的文章</p>
          )}
        </div>
      </aside>

      <div
        aria-label="调整文章列表宽度"
        aria-orientation="vertical"
        aria-valuemax={articleBrowserBounds.max}
        aria-valuemin={articleBrowserBounds.min}
        aria-valuenow={articleBrowser.width}
        className="article-browser__resizer"
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            updateArticleBrowserWidth(articleBrowser.width - 16);
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            updateArticleBrowserWidth(articleBrowser.width + 16);
          }
        }}
        onPointerDown={handleResizeStart}
        role="separator"
        tabIndex={articleBrowser.collapsed ? -1 : 0}
      >
        <GripVertical aria-hidden="true" size={14} />
      </div>

      <div className="article-editor">
        <header className="article-editor__head">
          <div className="article-editor__title">
            <div>
              <button
                aria-label={articleBrowser.collapsed ? "展开文章列表" : "收起文章列表"}
                aria-pressed={!articleBrowser.collapsed}
                className="icon-button article-editor__browser-toggle"
                onClick={toggleArticleBrowser}
                title={articleBrowser.collapsed ? "展开文章列表" : "收起文章列表"}
                type="button"
              >
                {articleBrowser.collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}
              </button>
              <span className={`article-status article-status--${selectedArticle.status}`}>
                {statusLabel[selectedArticle.status]}
              </span>
              {selectedArticle.revisionNumber && (
                <span>修订 {selectedArticle.revisionNumber}</span>
              )}
            </div>
            <h1>{selectedArticle.title}</h1>
            {writerStreaming && <span className="article-editor__streaming" role="status"><LoaderCircle className="spin" size={13} />写作 Agent 正在输出正文</span>}
          </div>
          <div className="article-editor__actions">
            <button
              className="button button--quiet"
              disabled={generatingImage}
              onClick={onGenerateImage}
              type="button"
            >
              {generatingImage ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <ImagePlus size={16} />
              )}
              {generatedImageCount > 0 ? `配图 ${generatedImageCount}` : "生成配图"}
            </button>
            <button
              className="button button--quiet"
              disabled={publishing}
              onClick={() => {
                setPublishDialogOpen(true);
                onRefreshWechatSync();
              }}
              type="button"
            >
              <Send size={16} />
              发布
            </button>
            <button
              className="button button--quiet"
              disabled={workflowRunning || saving}
              onClick={onRunWorkflow}
              type="button"
            >
              {workflowRunning ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Sparkles size={16} />
              )}
              {workflowRunning ? "处理中" : "AI 完善全文"}
            </button>
            <button
              className="button button--primary"
              disabled={saving || !dirty}
              onClick={onSave}
              type="button"
            >
              {saving ? (
                <LoaderCircle className="spin" size={16} />
              ) : dirty ? (
                <Save size={16} />
              ) : (
                <Check size={16} />
              )}
              {saving ? "保存中" : dirty ? "保存" : "已保存"}
            </button>
          </div>
        </header>

        <div className="article-editor__body">
          <MarkdownWorkbench
            contentReplacing={contentReplacing}
            dirty={dirty}
            editorMode={editorMode}
            markdown={markdown}
            onEditorModeChange={onEditorModeChange}
            onMarkdownChange={onMarkdownChange}
            onImageFileDrop={onImageFileDrop}
            onRequestSelectionRewrite={(nextSelection) => {
              setSelections((current) => {
                const exists = current.some(
                  (selection) =>
                    selection.start === nextSelection.start &&
                    selection.end === nextSelection.end &&
                    selection.text === nextSelection.text,
                );
                return exists ? current : [...current, nextSelection];
              });
            }}
            onPendingImageInsertionHandled={() => setPendingImageInsertion(null)}
            onRequestImageInsert={() => setImageDialogOpen(true)}
            onPlatformChange={onPlatformChange}
            mediaAssets={mediaAssets}
            platforms={platforms}
            selectedPlatform={selectedPlatform}
            pendingImageInsertion={pendingImageInsertion}
            streaming={writerStreaming}
          />
          <ArticleAssistant
            articleId={selectedArticle.id}
            onApplyCandidate={onApplyRewriteCandidate}
            canUndo={canUndoRewrite}
            onClearSelections={() => setSelections([])}
            onRemoveSelection={(selection) => {
              setSelections((current) => current.filter(
                (candidate) =>
                  candidate.start !== selection.start ||
                  candidate.end !== selection.end ||
                  candidate.text !== selection.text,
              ));
            }}
            onRewrite={onRewriteArticle}
            onComposeVisual={onComposeVisual}
            onUndoLastRewrite={onUndoRewrite}
            selections={selections}
            workflowFailure={workflowFailure}
            workflowProgress={
              workflowProgress?.articleId === selectedArticle.id ? workflowProgress : null
            }
            workflowSnapshot={workflowWorkspace}
            workflowRetryable={workflowFailure?.retryable}
            onCancelWorkflow={onCancelWorkflow}
            onRetryWorkflow={onRetryWorkflow}
            cancellingWorkflow={cancellingWorkflow}
          />
        </div>
        <ImageInsertDialog
          assets={mediaAssets}
          onClose={() => setImageDialogOpen(false)}
          onImportFile={async (file) => {
            if (!onImageFileDrop) throw new Error("图片导入服务尚未连接。");
            return onImageFileDrop(file);
          }}
          onInsert={setPendingImageInsertion}
          open={imageDialogOpen}
        />
        <PublishDialog
          article={selectedArticle}
          bridge={wechatSyncStatus}
          onClose={() => setPublishDialogOpen(false)}
          onRefresh={onRefreshWechatSync}
          onSubmit={onPublishToPlatforms}
          open={publishDialogOpen}
          platforms={platforms}
          publishing={publishing}
          refreshing={wechatSyncRefreshing}
        />
      </div>
    </section>
  );
}
