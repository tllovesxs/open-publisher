import {
  Check,
  CopyPlus,
  FileText,
  FileUp,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MarkdownTemplate } from "../types";

interface TemplatesPageProps {
  selectedTemplateId: string | null;
  templates: MarkdownTemplate[];
  onChange: (templates: MarkdownTemplate[]) => void;
  onExtractTemplate: (sourceMarkdown: string) => Promise<MarkdownTemplate>;
  onSelect: (templateId: string) => void;
  onStartCreating: () => void;
}

type EditorSource = "manual" | "extracted";

const MAX_SOURCE_MARKDOWN_CHARACTERS = 60_000;
const MAX_SOURCE_FILE_BYTES = 512 * 1024;

const blankTemplate = (): MarkdownTemplate => ({
  id: `template-${Date.now()}`,
  name: "未命名模板",
  description: "自定义 Markdown 写作模板。",
  category: "自定义",
  markdown: "# {{title}}\n\n{{lead}}\n",
  isBuiltIn: false,
});

function errorMessage(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return detail.replace(/\s+/g, " ").trim().slice(0, 180) || "本地运行时没有返回可用模板。";
}

export function TemplatesPage({
  selectedTemplateId,
  templates,
  onChange,
  onExtractTemplate,
  onSelect,
  onStartCreating,
}: TemplatesPageProps) {
  const [editing, setEditing] = useState<MarkdownTemplate | null>(null);
  const [editorSource, setEditorSource] = useState<EditorSource>("manual");
  const [extractionOpen, setExtractionOpen] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [sourceMarkdown, setSourceMarkdown] = useState("");
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceInputRef = useRef<HTMLTextAreaElement>(null);
  const selected = templates.find((template) => template.id === selectedTemplateId) ?? templates[0];
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return templates;
    return templates.filter((template) =>
      `${template.name} ${template.description} ${template.category}`
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [query, templates]);
  const sourceCharacterCount = [...sourceMarkdown].length;
  const canExtract = sourceMarkdown.trim().length > 0
    && sourceCharacterCount <= MAX_SOURCE_MARKDOWN_CHARACTERS
    && !extracting;

  useEffect(() => {
    if (selected && !selectedTemplateId) onSelect(selected.id);
  }, [onSelect, selected, selectedTemplateId]);

  useEffect(() => {
    if (!extractionOpen) return;
    const frame = window.requestAnimationFrame(() => sourceInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [extractionOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || extracting) return;
      if (editing) setEditing(null);
      else if (extractionOpen) setExtractionOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editing, extracting, extractionOpen]);

  const openManualEditor = (template: MarkdownTemplate) => {
    setEditorSource("manual");
    setEditing(template);
  };

  const openExtraction = () => {
    setExtractError(null);
    setExtractionOpen(true);
  };

  const closeExtraction = () => {
    if (extracting) return;
    setExtractionOpen(false);
    setExtractError(null);
  };

  const save = () => {
    if (!editing) return;
    onChange(
      templates.some((template) => template.id === editing.id)
        ? templates.map((template) => (template.id === editing.id ? editing : template))
        : [editing, ...templates],
    );
    onSelect(editing.id);
    setEditing(null);
  };

  const importMarkdown = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_SOURCE_FILE_BYTES) {
      setExtractError("导入文件超过 512 KB，请先保留需要复用的文章正文。");
      return;
    }
    try {
      const content = await file.text();
      setSourceMarkdown(content);
      setSourceFileName(file.name);
      setExtractError(null);
    } catch {
      setExtractError("无法读取这个文件，请改为粘贴 Markdown 正文。");
    }
  };

  const extractTemplate = async () => {
    if (!canExtract) {
      setExtractError("请先粘贴或导入一篇不超过 60000 字符的 Markdown 文章。");
      return;
    }
    setExtracting(true);
    setExtractError(null);
    try {
      const template = await onExtractTemplate(sourceMarkdown);
      setEditorSource("extracted");
      setEditing(template);
      setExtractionOpen(false);
      setSourceMarkdown("");
      setSourceFileName(null);
    } catch (error) {
      setExtractError(`提取失败：${errorMessage(error)}`);
    } finally {
      setExtracting(false);
    }
  };

  return (
    <section className="page page--studio">
      <header className="page-heading page-heading--actions">
        <div>
          <span className="page-kicker">Markdown 格式库</span>
          <h1>模板</h1>
          <p>选择一份结构作为文章起点，也可以维护自己的常用格式。</p>
        </div>
        <div className="template-heading-actions">
          <button
            className="button button--quiet"
            onClick={() => openManualEditor(blankTemplate())}
            type="button"
          >
            <Plus aria-hidden="true" size={16} />
            新建模板
          </button>
          <button className="button button--primary" onClick={openExtraction} type="button">
            <Sparkles aria-hidden="true" size={16} />
            从文章提取
          </button>
        </div>
      </header>

      <div className="template-layout">
        <aside className="template-browser" aria-label="模板列表">
          <label className="template-search">
            <span className="visually-hidden">搜索模板</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索模板"
              value={query}
            />
          </label>
          <div className="template-grid">
            {filtered.map((template) => (
              <button
                aria-pressed={selected?.id === template.id}
                className={`template-card${selected?.id === template.id ? " is-selected" : ""}`}
                key={template.id}
                onClick={() => onSelect(template.id)}
                type="button"
              >
                <span className="template-card__icon">
                  <FileText aria-hidden="true" size={18} />
                </span>
                <span className="template-card__copy">
                  <small>{template.category}</small>
                  <strong>{template.name}</strong>
                  <span>{template.description}</span>
                </span>
                {selected?.id === template.id && (
                  <Check aria-hidden="true" className="template-card__check" size={16} />
                )}
              </button>
            ))}
          </div>
        </aside>

        {selected && (
          <article className="template-preview">
            <header>
              <div>
                <span className="page-kicker">{selected.category}</span>
                <h2>{selected.name}</h2>
                <p>{selected.description}</p>
              </div>
              <button
                aria-label="编辑模板"
                className="icon-button"
                onClick={() => openManualEditor(selected)}
                title="编辑模板"
                type="button"
              >
                <Pencil size={16} />
              </button>
            </header>
            <pre>{selected.markdown}</pre>
            <footer>
              <span>{selected.isBuiltIn ? "内置模板" : "自定义模板"}</span>
              <button className="button button--primary" onClick={onStartCreating} type="button">
                <CopyPlus aria-hidden="true" size={16} />
                用此模板创作
              </button>
            </footer>
          </article>
        )}
      </div>

      {extractionOpen && (
        <div
          aria-describedby="template-extraction-description"
          aria-labelledby="template-extraction-title"
          aria-modal="true"
          className="studio-modal"
          role="dialog"
        >
          <div className="studio-modal__scrim" />
          <section className="template-editor template-extractor">
            <header>
              <div>
                <span className="page-kicker">AI 模板提取</span>
                <h2 id="template-extraction-title">从文章提取模板</h2>
              </div>
              <button
                aria-label="关闭文章提取"
                className="icon-button"
                disabled={extracting}
                onClick={closeExtraction}
                type="button"
              >
                <X size={18} />
              </button>
            </header>
            <div className="template-editor__body template-extractor__body">
              <p id="template-extraction-description" className="template-extractor__note">
                原文只用于提取结构；结果会在保存前打开供你检查。
              </p>
              <div className="template-extractor__actions">
                <input
                  accept=".md,text/markdown,text/plain"
                  aria-label="导入 Markdown 文件"
                  className="visually-hidden"
                  onChange={(event) => void importMarkdown(event)}
                  ref={fileInputRef}
                  type="file"
                />
                <button
                  className="button button--quiet"
                  disabled={extracting}
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  <FileUp aria-hidden="true" size={16} />
                  导入 .md
                </button>
                {sourceFileName && <span className="template-extractor__file">{sourceFileName}</span>}
              </div>
              <label className="field" htmlFor="template-source-markdown">
                <span>原始 Markdown</span>
                <textarea
                  aria-describedby="template-source-count"
                  id="template-source-markdown"
                  onChange={(event) => {
                    setSourceMarkdown(event.target.value);
                    setSourceFileName(null);
                    setExtractError(null);
                  }}
                  placeholder="# 文章标题\n\n粘贴一篇完整 Markdown 文章"
                  ref={sourceInputRef}
                  rows={15}
                  value={sourceMarkdown}
                />
              </label>
              <div className="template-extractor__meta" id="template-source-count">
                <span>{sourceCharacterCount.toLocaleString()} / 60,000 字符</span>
                {sourceCharacterCount > MAX_SOURCE_MARKDOWN_CHARACTERS && (
                  <span className="template-extractor__limit">内容超出限制</span>
                )}
              </div>
              {extracting && (
                <div aria-live="polite" className="template-extractor__loading">
                  <LoaderCircle aria-hidden="true" className="is-spinning" size={16} />
                  正在分析文章结构
                </div>
              )}
              {extractError && <p className="form-error" role="alert">{extractError}</p>}
            </div>
            <footer>
              <button className="button button--quiet" disabled={extracting} onClick={closeExtraction} type="button">
                取消
              </button>
              <button className="button button--primary" disabled={!canExtract} onClick={() => void extractTemplate()} type="button">
                {extracting ? <LoaderCircle aria-hidden="true" className="is-spinning" size={16} /> : <Sparkles aria-hidden="true" size={16} />}
                {extractError ? "重试提取" : "提取为模板"}
              </button>
            </footer>
          </section>
        </div>
      )}

      {editing && (
        <div
          aria-labelledby="template-editor-title"
          aria-modal="true"
          className="studio-modal"
          role="dialog"
        >
          <div className="studio-modal__scrim" />
          <section className="template-editor">
            <header>
              <div>
                <span className="page-kicker">
                  {editorSource === "extracted" ? "AI 提取结果" : "Markdown 模板"}
                </span>
                <h2 id="template-editor-title">
                  {editorSource === "extracted" ? "审核并保存模板" : "编辑模板"}
                </h2>
              </div>
              <button
                aria-label="关闭模板编辑"
                className="icon-button"
                onClick={() => setEditing(null)}
                type="button"
              >
                <X size={18} />
              </button>
            </header>
            <div className="template-editor__body">
              <div className="form-grid form-grid--two">
                <label className="field">
                  <span>名称</span>
                  <input
                    onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                    value={editing.name}
                  />
                </label>
                <label className="field">
                  <span>分类</span>
                  <input
                    onChange={(event) => setEditing({ ...editing, category: event.target.value })}
                    value={editing.category}
                  />
                </label>
              </div>
              <label className="field">
                <span>说明</span>
                <input
                  onChange={(event) => setEditing({ ...editing, description: event.target.value })}
                  value={editing.description}
                />
              </label>
              <label className="field">
                <span>Markdown 正文</span>
                <textarea
                  onChange={(event) => setEditing({ ...editing, markdown: event.target.value })}
                  rows={16}
                  value={editing.markdown}
                />
              </label>
            </div>
            <footer>
              <button className="button button--quiet" onClick={() => setEditing(null)} type="button">
                取消
              </button>
              <button className="button button--primary" onClick={save} type="button">
                <Save aria-hidden="true" size={16} />
                保存模板
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
