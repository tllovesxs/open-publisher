import { Check, CopyPlus, FileText, Pencil, Plus, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { MarkdownTemplate } from "../types";

interface TemplatesPageProps {
  selectedTemplateId: string | null;
  templates: MarkdownTemplate[];
  onChange: (templates: MarkdownTemplate[]) => void;
  onSelect: (templateId: string) => void;
  onStartCreating: () => void;
}

const blankTemplate = (): MarkdownTemplate => ({
  id: `template-${Date.now()}`,
  name: "未命名模板",
  description: "自定义 Markdown 写作模板。",
  category: "自定义",
  markdown: "# {{title}}\n\n{{lead}}\n",
  isBuiltIn: false,
});

export function TemplatesPage({
  selectedTemplateId,
  templates,
  onChange,
  onSelect,
  onStartCreating,
}: TemplatesPageProps) {
  const [editing, setEditing] = useState<MarkdownTemplate | null>(null);
  const [query, setQuery] = useState("");
  const selected = templates.find((template) => template.id === selectedTemplateId) ?? templates[0];
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return templates;
    return templates.filter((template) =>
      `${template.name} ${template.description} ${template.category}`.toLocaleLowerCase().includes(normalized),
    );
  }, [query, templates]);

  useEffect(() => {
    if (selected && !selectedTemplateId) onSelect(selected.id);
  }, [onSelect, selected, selectedTemplateId]);

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

  return (
    <section className="page page--studio">
      <header className="page-heading page-heading--actions">
        <div>
          <span className="page-kicker">Markdown 格式库</span>
          <h1>模板</h1>
          <p>选择一份结构作为文章起点，也可以维护自己的常用格式。</p>
        </div>
        <button className="button button--quiet" onClick={() => setEditing(blankTemplate())} type="button"><Plus aria-hidden="true" size={16} />新建模板</button>
      </header>

      <div className="template-layout">
        <aside className="template-browser" aria-label="模板列表">
          <label className="template-search">
            <span className="visually-hidden">搜索模板</span>
            <input onChange={(event) => setQuery(event.target.value)} placeholder="搜索模板" value={query} />
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
                <span className="template-card__icon"><FileText aria-hidden="true" size={18} /></span>
                <span className="template-card__copy">
                  <small>{template.category}</small>
                  <strong>{template.name}</strong>
                  <span>{template.description}</span>
                </span>
                {selected?.id === template.id && <Check aria-hidden="true" className="template-card__check" size={16} />}
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
              <button aria-label="编辑模板" className="icon-button" onClick={() => setEditing(selected)} title="编辑模板" type="button"><Pencil size={16} /></button>
            </header>
            <pre>{selected.markdown}</pre>
            <footer>
              <span>{selected.isBuiltIn ? "内置模板" : "自定义模板"}</span>
              <button className="button button--primary" onClick={onStartCreating} type="button"><CopyPlus aria-hidden="true" size={16} />用此模板创作</button>
            </footer>
          </article>
        )}
      </div>

      {editing && (
        <div className="studio-modal" role="dialog" aria-modal="true" aria-labelledby="template-editor-title">
          <div className="studio-modal__scrim" />
          <section className="template-editor">
            <header>
              <div><span className="page-kicker">Markdown 模板</span><h2 id="template-editor-title">编辑模板</h2></div>
              <button aria-label="关闭模板编辑" className="icon-button" onClick={() => setEditing(null)} type="button"><X size={18} /></button>
            </header>
            <div className="template-editor__body">
              <div className="form-grid form-grid--two">
                <label className="field"><span>名称</span><input onChange={(event) => setEditing({ ...editing, name: event.target.value })} value={editing.name} /></label>
                <label className="field"><span>分类</span><input onChange={(event) => setEditing({ ...editing, category: event.target.value })} value={editing.category} /></label>
              </div>
              <label className="field"><span>说明</span><input onChange={(event) => setEditing({ ...editing, description: event.target.value })} value={editing.description} /></label>
              <label className="field"><span>Markdown 正文</span><textarea onChange={(event) => setEditing({ ...editing, markdown: event.target.value })} rows={16} value={editing.markdown} /></label>
            </div>
            <footer><button className="button button--quiet" onClick={() => setEditing(null)} type="button">取消</button><button className="button button--primary" onClick={save} type="button"><Save aria-hidden="true" size={16} />保存模板</button></footer>
          </section>
        </div>
      )}
    </section>
  );
}
