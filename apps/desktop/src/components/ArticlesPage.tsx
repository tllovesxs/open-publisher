import {
  Check,
  FileText,
  ImagePlus,
  LoaderCircle,
  Plus,
  Save,
  Search,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { CreationLogEntry } from "./CreatePage";
import type { Article, MediaAsset, PlatformDefinition, PlatformId } from "../types";
import { ImageInsertDialog } from "./ImageInsertDialog";
import { MarkdownWorkbench, type EditorMode, type ImageInsertion } from "./MarkdownWorkbench";

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
  contentReplacing: boolean;
  workflowFailure: WorkflowFailure | null;
  onRetryWorkflow: () => void;
}

const statusLabel: Record<Article["status"], string> = {
  draft: "草稿",
  review: "待审核",
  ready: "可发布",
  published: "已发布",
};

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
  contentReplacing,
  workflowFailure,
  onRetryWorkflow,
}: ArticlesPageProps) {
  const [query, setQuery] = useState("");
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [pendingImageInsertion, setPendingImageInsertion] = useState<ImageInsertion | null>(null);
  const filteredArticles = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return articles;
    return articles.filter((article) =>
      `${article.title} ${article.collection}`.toLocaleLowerCase().includes(normalized),
    );
  }, [articles, query]);

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
    <section className="articles-layout">
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

      <div className="article-editor">
        <header className="article-editor__head">
          <div className="article-editor__title">
            <div>
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

        <MarkdownWorkbench
          contentReplacing={contentReplacing}
          dirty={dirty}
          editorMode={editorMode}
          markdown={markdown}
          onEditorModeChange={onEditorModeChange}
          onMarkdownChange={onMarkdownChange}
          onImageFileDrop={onImageFileDrop}
          onPendingImageInsertionHandled={() => setPendingImageInsertion(null)}
          onRequestImageInsert={() => setImageDialogOpen(true)}
          onPlatformChange={onPlatformChange}
          mediaAssets={mediaAssets}
          platforms={platforms}
          selectedPlatform={selectedPlatform}
          pendingImageInsertion={pendingImageInsertion}
          streaming={writerStreaming}
        />
        {workflowFailure && (
          <aside className="article-workflow-failure" role="alert">
            <div className="article-workflow-failure__summary">
              <div>
                <strong>文章生成失败</strong>
                <p>{workflowFailure.detail}</p>
              </div>
              {workflowFailure.retryable && (
                <button
                  className="button button--primary"
                  onClick={onRetryWorkflow}
                  type="button"
                >
                  <Sparkles size={16} />
                  重试本次生成
                </button>
              )}
            </div>
            <details className="article-workflow-failure__logs" open>
              <summary>查看执行日志</summary>
              <ol>
                {workflowFailure.logs.slice(-8).map((entry) => (
                  <li className={`is-${entry.tone}`} key={entry.id}>
                    <time dateTime={new Date(entry.timestamp).toISOString()}>
                      {new Intl.DateTimeFormat("zh-CN", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      }).format(entry.timestamp)}
                    </time>
                    <span>{entry.message}</span>
                  </li>
                ))}
              </ol>
            </details>
          </aside>
        )}
        {workflowProgress?.articleId === selectedArticle.id && (
          <aside aria-live="polite" className="article-progress" role="status">
            <div>
              <strong>{workflowProgress.title}</strong>
              <span>{workflowProgress.detail}</span>
            </div>
            {workflowProgress.value !== null && (
              <div aria-label={`${workflowProgress.value}%`} className="article-progress__track" role="progressbar" aria-valuemax={100} aria-valuemin={0} aria-valuenow={workflowProgress.value}>
                <i style={{ transform: `scaleX(${workflowProgress.value / 100})` }} />
              </div>
            )}
          </aside>
        )}
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
      </div>
    </section>
  );
}
