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
import type {
  MarkdownTemplate,
  TemplateFixedBlock,
  TemplateFixedBlockPosition,
} from "../types";

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
const EXTRACTION_WAIT_LIMIT_MS = 90_000;

const blankTemplate = (): MarkdownTemplate => ({
  id: `template-${Date.now()}`,
  name: "未命名模板",
  description: "自定义 Markdown 写作模板。",
  category: "自定义",
  markdown: "# {{title}}\n\n{{lead}}\n",
  styleProfile: {
    tone: "",
    audience: "",
    perspective: "",
    sentenceStyle: "",
    pacing: "",
    density: "",
  },
  structureProfile: {
    openingPattern: "",
    sectionPattern: "",
    conclusionPattern: "",
    headingDepth: "",
    paragraphPattern: "",
  },
  layoutProfile: {
    useLists: true,
    useTables: false,
    useBlockquotes: false,
    useCodeBlocks: false,
    imagePlacement: "",
    emphasisRules: "",
  },
  fixedBlocks: [],
  variables: ["title", "lead", "closing"],
  usageInstructions: "",
  isBuiltIn: false,
});

const fixedPositions: Array<{ value: TemplateFixedBlockPosition; label: string }> = [
  { value: "before_title", label: "标题之前" },
  { value: "after_intro", label: "导语之后" },
  { value: "before_closing", label: "结语之前" },
  { value: "after_article", label: "全文之后" },
];

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
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [query, setQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceInputRef = useRef<HTMLTextAreaElement>(null);
  const extractionAttemptRef = useRef(0);
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
    && rightsConfirmed
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
      if (event.key !== "Escape") return;
      if (editing) setEditing(null);
      else if (extractionOpen) closeExtraction();
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
    // The native command cannot be cancelled after dispatch. Invalidate the attempt so a
    // late response never reopens the editor or overwrites a later retry.
    extractionAttemptRef.current += 1;
    setExtracting(false);
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
      setExtractError(rightsConfirmed
        ? "请先粘贴或导入一篇不超过 60000 字符的 Markdown 文章。"
        : "请确认你拥有这篇文章的使用授权后再创建参考模板。",
      );
      return;
    }
    const attempt = extractionAttemptRef.current + 1;
    extractionAttemptRef.current = attempt;
    setExtracting(true);
    setExtractError(null);
    try {
      const template = await new Promise<MarkdownTemplate>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          reject(new Error("分析等待超过 90 秒，已停止等待。请检查模型连接后重试。"));
        }, EXTRACTION_WAIT_LIMIT_MS);
        void Promise.resolve()
          .then(() => onExtractTemplate(sourceMarkdown))
          .then(
            (result) => {
              window.clearTimeout(timer);
              resolve(result);
            },
            (error: unknown) => {
              window.clearTimeout(timer);
              reject(error);
            },
          );
      });
      if (attempt !== extractionAttemptRef.current) return;
      setEditorSource("extracted");
      setEditing(template);
      setExtractionOpen(false);
      setSourceMarkdown("");
      setSourceFileName(null);
      setRightsConfirmed(false);
    } catch (error) {
      if (attempt !== extractionAttemptRef.current) return;
      setExtractError(`提取失败：${errorMessage(error)}`);
    } finally {
      if (attempt === extractionAttemptRef.current) setExtracting(false);
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
            创建参考模板
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
            {selected.mode === "reference" && selected.referenceMarkdown ? (
              <details className="template-preview__reference">
                <summary>完整参考原文（仅保存在本机）</summary>
                <pre>{selected.referenceMarkdown}</pre>
              </details>
            ) : <pre>{selected.markdown}</pre>}
            <div className="template-preview__profiles">
              <span>{selected.mode === "reference" ? "高保真参考" : "结构模板"}</span>
              <span>文风：{selected.styleProfile.tone || "未设置"}</span>
              <span>结构：{selected.structureProfile.sectionPattern || "按 Markdown 骨架"}</span>
              <span>固定片段：{selected.fixedBlocks.filter((block) => block.enabled && block.content.trim()).length} 个</span>
            </div>
            <footer>
              <span>{selected.isBuiltIn ? "内置模板" : selected.mode === "reference" ? "本地参考模板" : "自定义模板"}</span>
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
                <span className="page-kicker">高保真参考模板</span>
                <h2 id="template-extraction-title">从文章分析写法</h2>
              </div>
              <button
                aria-label="关闭文章提取"
                className="icon-button"
                onClick={closeExtraction}
                type="button"
              >
                <X size={18} />
              </button>
            </header>
            <div className="template-editor__body template-extractor__body">
              <p id="template-extraction-description" className="template-extractor__note">
                完整原文只保存在本机；AI 只提取可编辑的文风、结构和排版蓝图，不将原文变成占位符。
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
              <label className="template-extractor__rights">
                <input
                  checked={rightsConfirmed}
                  disabled={extracting}
                  onChange={(event) => setRightsConfirmed(event.target.checked)}
                  type="checkbox"
                />
                我确认拥有这篇文章的使用授权，且不会将原文用于未经许可的复制发布。
              </label>
              {extracting && (
                <div aria-live="polite" className="template-extractor__loading">
                  <LoaderCircle aria-hidden="true" className="is-spinning" size={16} />
                  正在分析文章结构
                </div>
              )}
              {extractError && <p className="form-error" role="alert">{extractError}</p>}
            </div>
            <footer>
              <button className="button button--quiet" onClick={closeExtraction} type="button">
                {extracting ? "停止等待" : "取消"}
              </button>
              <button className="button button--primary" disabled={!canExtract} onClick={() => void extractTemplate()} type="button">
                {extracting ? <LoaderCircle aria-hidden="true" className="is-spinning" size={16} /> : <Sparkles aria-hidden="true" size={16} />}
                {extractError ? "重新分析" : "分析参考模板"}
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
                  {editorSource === "extracted" ? "AI 分析结果" : editing.mode === "reference" ? "高保真参考模板" : "Markdown 模板"}
                </span>
                <h2 id="template-editor-title">
                  {editorSource === "extracted" ? "审核并保存参考模板" : "编辑模板"}
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
              {editing.mode === "reference" && editing.referenceMarkdown ? (
                <section className="template-reference-source">
                  <span>完整参考原文</span>
                  <p>原文作为高保真写法参考保留；请在下方编辑蓝图和固定片段，不会改写这份原文。</p>
                  <pre>{editing.referenceMarkdown}</pre>
                </section>
              ) : (
                <label className="field">
                  <span>Markdown 正文</span>
                  <textarea
                    onChange={(event) => setEditing({ ...editing, markdown: event.target.value })}
                    rows={16}
                    value={editing.markdown}
                  />
                </label>
              )}
              <fieldset className="template-editor__fieldset">
                <legend>文风规范</legend>
                <div className="form-grid form-grid--two">
                  {([
                    ["tone", "整体语气"],
                    ["audience", "目标读者"],
                    ["perspective", "叙述视角"],
                    ["sentenceStyle", "句式习惯"],
                    ["pacing", "节奏"],
                    ["density", "信息密度"],
                  ] as const).map(([key, label]) => (
                    <label className="field" key={key}>
                      <span>{label}</span>
                      <input
                        onChange={(event) => setEditing({ ...editing, styleProfile: { ...editing.styleProfile, [key]: event.target.value } })}
                        value={editing.styleProfile[key]}
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="template-editor__fieldset">
                <legend>结构与排版</legend>
                <div className="form-grid form-grid--two">
                  {([
                    ["openingPattern", "开头方式"],
                    ["sectionPattern", "章节组织"],
                    ["conclusionPattern", "结尾方式"],
                    ["headingDepth", "标题层级"],
                    ["paragraphPattern", "段落习惯"],
                    ["imagePlacement", "图片位置"],
                    ["emphasisRules", "强调规则"],
                  ] as const).map(([key, label]) => (
                    <label className="field" key={key}>
                      <span>{label}</span>
                      <input
                        onChange={(event) => setEditing({
                          ...editing,
                          ...(key === "imagePlacement" || key === "emphasisRules"
                            ? { layoutProfile: { ...editing.layoutProfile, [key]: event.target.value } }
                            : { structureProfile: { ...editing.structureProfile, [key]: event.target.value } }),
                        })}
                        value={String(key === "imagePlacement" || key === "emphasisRules"
                          ? editing.layoutProfile[key as keyof typeof editing.layoutProfile]
                          : editing.structureProfile[key as keyof typeof editing.structureProfile])}
                      />
                    </label>
                  ))}
                </div>
                <div className="template-editor__toggles">
                  {([
                    ["useLists", "列表"],
                    ["useTables", "表格"],
                    ["useBlockquotes", "引用"],
                    ["useCodeBlocks", "代码块"],
                  ] as const).map(([key, label]) => (
                    <label key={key}><input checked={editing.layoutProfile[key]} onChange={(event) => setEditing({ ...editing, layoutProfile: { ...editing.layoutProfile, [key]: event.target.checked } })} type="checkbox" />{label}</label>
                  ))}
                </div>
              </fieldset>
              <label className="field">
                <span>使用说明</span>
                <textarea maxLength={4000} onChange={(event) => setEditing({ ...editing, usageInstructions: event.target.value })} placeholder="告诉 Agent 哪些规则必须保持，以及哪些内容需要替换。" rows={3} value={editing.usageInstructions} />
              </label>
              <fieldset className="template-editor__fieldset">
                <legend>固定片段</legend>
                <p className="template-extractor__note">固定片段由程序在文章生成后插入，不会被模型改写或删除。可直接填写项目介绍、项目地址和求 Star 文案；{"{{title}}"}、{"{{topic}}"} 会自动替换。</p>
                {editing.fixedBlocks.map((block, index) => (
                  <div className="template-fixed-block" key={block.id}>
                    <div className="form-grid form-grid--two">
                      <label className="field"><span>名称</span><input value={block.label} onChange={(event) => setEditing({ ...editing, fixedBlocks: editing.fixedBlocks.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) })} /></label>
                      <label className="field"><span>位置</span><select value={block.position} onChange={(event) => setEditing({ ...editing, fixedBlocks: editing.fixedBlocks.map((item, itemIndex) => itemIndex === index ? { ...item, position: event.target.value as TemplateFixedBlockPosition } : item) })}>{fixedPositions.map((position) => <option key={position.value} value={position.value}>{position.label}</option>)}</select></label>
                    </div>
                    <label className="field"><span><input checked={block.enabled} onChange={(event) => setEditing({ ...editing, fixedBlocks: editing.fixedBlocks.map((item, itemIndex) => itemIndex === index ? { ...item, enabled: event.target.checked } : item) })} type="checkbox" /> 启用</span><textarea maxLength={4000} onChange={(event) => setEditing({ ...editing, fixedBlocks: editing.fixedBlocks.map((item, itemIndex) => itemIndex === index ? { ...item, content: event.target.value } : item) })} placeholder="例如：项目地址：{{project_link}}\n如果有帮助，欢迎 Star。" rows={3} value={block.content} /></label>
                    <button className="text-button" onClick={() => setEditing({ ...editing, fixedBlocks: editing.fixedBlocks.filter((_, itemIndex) => itemIndex !== index) })} type="button">删除片段</button>
                  </div>
                ))}
                <button className="button button--quiet" onClick={() => { const block: TemplateFixedBlock = { id: `block-${Date.now()}`, label: "新固定片段", enabled: true, content: "", position: "after_article" }; setEditing({ ...editing, fixedBlocks: [...editing.fixedBlocks, block] }); }} type="button">添加固定片段</button>
              </fieldset>
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
