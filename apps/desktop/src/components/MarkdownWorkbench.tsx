import {
  Bold,
  Check,
  Code2,
  Columns2,
  Eye,
  Heading2,
  ImagePlus,
  Italic,
  List,
  MoreHorizontal,
  Quote,
  Save,
  Sparkles,
} from "lucide-react";
import { MarkdownPreview } from "./MarkdownPreview";
import type { Article, PlatformDefinition, PlatformId } from "../types";

type EditorMode = "edit" | "split" | "preview";

interface MarkdownWorkbenchProps {
  article: Article;
  markdown: string;
  onMarkdownChange: (markdown: string) => void;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
  editorMode: EditorMode;
  onEditorModeChange: (mode: EditorMode) => void;
  selectedPlatform: PlatformId;
  onPlatformChange: (platform: PlatformId) => void;
  platforms: PlatformDefinition[];
}

const editorModes: { id: EditorMode; label: string; icon: typeof Eye }[] = [
  { id: "edit", label: "编辑", icon: Code2 },
  { id: "split", label: "分栏", icon: Columns2 },
  { id: "preview", label: "预览", icon: Eye },
];

export function MarkdownWorkbench({
  article,
  markdown,
  onMarkdownChange,
  onSave,
  saving,
  dirty,
  editorMode,
  onEditorModeChange,
  selectedPlatform,
  onPlatformChange,
  platforms,
}: MarkdownWorkbenchProps) {
  const lines = markdown.split("\n").length;
  const characters = markdown.replace(/\s/g, "").length;

  return (
    <section className="workbench" aria-label="Markdown 稿件工作台">
      <header className="document-head">
        <div>
          <span className="eyebrow">{article.collection} / 当前修订</span>
          <h1>{article.title}</h1>
          <p>{article.deck}</p>
        </div>
        <div className="document-head__actions">
          <div className="platform-switch" aria-label="平台预览">
            {platforms.map((platform) => (
              <button
                className={selectedPlatform === platform.id ? "is-active" : ""}
                key={platform.id}
                onClick={() => onPlatformChange(platform.id)}
                type="button"
              >
                {platform.shortName}
              </button>
            ))}
          </div>
          <button
            className="button button--quiet save-button"
            disabled={saving || !dirty}
            onClick={onSave}
            type="button"
          >
            {saving ? (
              <span className="spinner" aria-hidden="true" />
            ) : dirty ? (
              <Save size={15} aria-hidden="true" />
            ) : (
              <Check size={15} aria-hidden="true" />
            )}
            {saving ? "保存中" : dirty ? "保存修订" : "已保存"}
          </button>
        </div>
      </header>

      <div className="editor-toolbar">
        <div className="editor-toolbar__tools" aria-label="格式工具">
          <button aria-label="插入标题" type="button" title="标题"><Heading2 size={16} /></button>
          <button aria-label="切换粗体" type="button" title="粗体"><Bold size={16} /></button>
          <button aria-label="切换斜体" type="button" title="斜体"><Italic size={16} /></button>
          <button aria-label="插入列表" type="button" title="列表"><List size={16} /></button>
          <button aria-label="插入引用" type="button" title="引用"><Quote size={16} /></button>
          <button aria-label="插入图片" type="button" title="插入图片"><ImagePlus size={16} /></button>
          <span className="toolbar-rule" />
          <button aria-label="让 Agent 处理选中内容" className="ai-tool" type="button" title="让 Agent 处理选中内容">
            <Sparkles size={15} />
            Agent
          </button>
          <button aria-label="更多编辑工具" type="button" title="更多"><MoreHorizontal size={17} /></button>
        </div>
        <div className="mode-switch" aria-label="编辑器布局">
          {editorModes.map(({ id, label, icon: Icon }) => (
            <button
              aria-label={label}
              className={editorMode === id ? "is-active" : ""}
              key={id}
              onClick={() => onEditorModeChange(id)}
              title={label}
              type="button"
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
      </div>

      <div className={`editor-surface editor-surface--${editorMode}`}>
        {editorMode !== "preview" && (
          <div className="source-editor">
            <div className="source-editor__gutter" aria-hidden="true">
              {Array.from({ length: lines }, (_, index) => (
                <span key={index}>{index + 1}</span>
              ))}
            </div>
            <textarea
              aria-label="Markdown 正文"
              onChange={(event) => onMarkdownChange(event.target.value)}
              spellCheck="false"
              value={markdown}
            />
          </div>
        )}
        {editorMode !== "edit" && (
          <div className="preview-pane">
            <div className="preview-pane__meta">
              <span>平台呈现</span>
              <strong>{platforms.find((item) => item.id === selectedPlatform)?.name}</strong>
            </div>
            <MarkdownPreview markdown={markdown} />
          </div>
        )}
      </div>

      <footer className="editor-status">
        <span><i className={dirty ? "dot dot--cinnabar" : "dot dot--jade"} />{dirty ? "有未保存修改" : "修订已同步"}</span>
        <span>Markdown</span>
        <span>UTF-8</span>
        <span>{lines} 行</span>
        <span>{characters} 字</span>
      </footer>
    </section>
  );
}
