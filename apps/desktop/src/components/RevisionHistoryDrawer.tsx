import {
  ArrowLeft,
  Clock3,
  FileText,
  LoaderCircle,
  RotateCcw,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ArticleRevisionDetail,
  ArticleRevisionSummary,
} from "../lib/desktopBridge";

interface RevisionHistoryDrawerProps {
  articleId: string;
  currentMarkdown: string;
  currentRevisionId: string | null;
  open: boolean;
  onClose: () => void;
  onList: (articleId: string) => Promise<ArticleRevisionSummary[]>;
  onRead: (articleId: string, revisionId: string) => Promise<ArticleRevisionDetail>;
  onRestore: (articleId: string, revisionId: string) => Promise<void>;
}

const revisionLabel = (reason: string) => {
  if (reason.startsWith("restore:")) return "恢复历史版本";
  const normalized = reason.toLocaleLowerCase();
  if (normalized.includes("visual") || normalized.includes("image")) return "更新文章配图";
  if (normalized.includes("undo")) return "撤销 AI 修改";
  if (normalized.includes("rewrite") || normalized.includes("patch")) return "AI 修改文章";
  if (normalized.includes("writer") || normalized.includes("create")) return "AI 写作";
  if (normalized.includes("template")) return "应用文章模板";
  if (normalized.includes("autosave")) return "编辑文章";
  if (normalized.includes("editor") || normalized.includes("draft")) return "保存草稿";
  if (normalized.includes("legacy")) return "迁入历史稿件";
  return reason.length <= 48 ? reason : "更新文章";
};

const formatRevisionTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const elapsed = Date.now() - date.getTime();
  if (elapsed >= 0 && elapsed < 60_000) return "刚刚";
  if (elapsed >= 0 && elapsed < 3_600_000) return `${Math.max(1, Math.floor(elapsed / 60_000))} 分钟前`;
  if (elapsed >= 0 && elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  if (elapsed >= 0 && elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)} 天前`;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const countCharacters = (markdown: string) => markdown.replace(/\s/g, "").length;

export function RevisionHistoryDrawer({
  articleId,
  currentMarkdown,
  currentRevisionId,
  open,
  onClose,
  onList,
  onRead,
  onRestore,
}: RevisionHistoryDrawerProps) {
  const [revisions, setRevisions] = useState<ArticleRevisionSummary[]>([]);
  const [preview, setPreview] = useState<ArticleRevisionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = async () => {
    setLoading(true);
    setError(null);
    try {
      setRevisions(await onList(articleId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setConfirmingId(null);
    void loadHistory();
  }, [articleId, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  const currentCharacterCount = useMemo(
    () => countCharacters(currentMarkdown),
    [currentMarkdown],
  );

  if (!open) return null;

  const openPreview = async (revision: ArticleRevisionSummary) => {
    setPreviewLoadingId(revision.revisionId);
    setError(null);
    try {
      setPreview(await onRead(articleId, revision.revisionId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPreviewLoadingId(null);
    }
  };

  const restore = async (revisionId: string) => {
    setRestoringId(revisionId);
    setError(null);
    try {
      await onRestore(articleId, revisionId);
      setPreview(null);
      setConfirmingId(null);
      await loadHistory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRestoringId(null);
    }
  };

  const previewDelta = preview
    ? countCharacters(preview.markdown) - currentCharacterCount
    : 0;

  return (
    <div className="revision-history-layer">
      <button
        aria-label="关闭版本记录"
        className="revision-history-layer__scrim"
        onClick={onClose}
        type="button"
      />
      <aside aria-label="文章版本记录" aria-modal="true" className="revision-history-drawer" role="dialog">
        <header className="revision-history-drawer__head">
          <div>
            <span className="page-kicker">版本记录</span>
            <h2>{preview ? `修订 ${preview.revisionNumber}` : "文章修改时间线"}</h2>
          </div>
          <button aria-label="关闭版本记录" className="icon-button" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </header>

        {preview ? (
          <div className="revision-history-preview">
            <button className="revision-history-preview__back" onClick={() => setPreview(null)} type="button">
              <ArrowLeft size={15} />返回时间线
            </button>
            <div className="revision-history-preview__meta">
              <strong>{revisionLabel(preview.reason)}</strong>
              <span>{formatRevisionTime(preview.createdAt)} · {new Date(preview.createdAt).toLocaleString("zh-CN")}</span>
              <span>
                {countCharacters(preview.markdown)} 字
                {preview.isCurrent
                  ? " · 当前版本"
                  : ` · 比当前${previewDelta >= 0 ? "多" : "少"} ${Math.abs(previewDelta)} 字`}
              </span>
            </div>
            <pre className="revision-history-preview__content">{preview.markdown}</pre>
            {!preview.isCurrent && (
              <div className="revision-history-preview__restore">
                {confirmingId === preview.revisionId ? (
                  <div className="revision-history-confirm">
                    <p>当前内容会先保存，再由此版本创建一个新的修订。</p>
                    <div>
                      <button className="button button--quiet" onClick={() => setConfirmingId(null)} type="button">取消</button>
                      <button className="button button--primary" disabled={restoringId !== null} onClick={() => void restore(preview.revisionId)} type="button">
                        {restoringId === preview.revisionId ? <LoaderCircle className="spin" size={15} /> : <RotateCcw size={15} />}
                        确认恢复
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="button button--primary" onClick={() => setConfirmingId(preview.revisionId)} type="button">
                    <RotateCcw size={15} />恢复到此版本
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="revision-history-drawer__body">
            {loading && revisions.length === 0 ? (
              <div className="revision-history-empty" role="status">
                <LoaderCircle className="spin" size={18} />正在读取版本记录
              </div>
            ) : revisions.length === 0 ? (
              <div className="revision-history-empty">
                <Clock3 size={20} />
                <strong>还没有版本记录</strong>
                <span>第一次保存或 AI 修改后会出现在这里。</span>
              </div>
            ) : (
              <ol className="revision-timeline">
                {revisions.map((revision) => (
                  <li className={revision.revisionId === currentRevisionId || revision.isCurrent ? "is-current" : ""} key={revision.revisionId}>
                    <span className="revision-timeline__node" aria-hidden="true" />
                    <button className="revision-timeline__entry" onClick={() => void openPreview(revision)} type="button">
                      <span className="revision-timeline__title">
                        <strong>{revisionLabel(revision.reason)}</strong>
                        {(revision.revisionId === currentRevisionId || revision.isCurrent) && <em>当前</em>}
                      </span>
                      <span>{formatRevisionTime(revision.createdAt)} · 修订 {revision.revisionNumber}</span>
                      <small>{revision.title}</small>
                      <span className="revision-timeline__open">
                        {previewLoadingId === revision.revisionId ? <LoaderCircle className="spin" size={13} /> : <FileText size={13} />}
                        查看版本
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
        {error && <p className="revision-history-error" role="alert">{error}</p>}
      </aside>
    </div>
  );
}
