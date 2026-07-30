import {
  Bold,
  Code2,
  Columns2,
  Eye,
  Heading2,
  ImagePlus,
  Italic,
  List,
  MoreHorizontal,
  Quote,
} from "lucide-react";
import { useRef } from "react";
import type { PlatformDefinition, PlatformId } from "../types";
import { MarkdownPreview } from "./MarkdownPreview";

export type EditorMode = "edit" | "split" | "preview";

interface MarkdownWorkbenchProps {
  markdown: string;
  onMarkdownChange: (markdown: string) => void;
  dirty: boolean;
  editorMode: EditorMode;
  onEditorModeChange: (mode: EditorMode) => void;
  selectedPlatform: PlatformId;
  onPlatformChange: (platform: PlatformId) => void;
  platforms: PlatformDefinition[];
}

const editorModes: Array<{
  id: EditorMode;
  label: string;
  icon: typeof Eye;
}> = [
  { id: "edit", label: "编辑", icon: Code2 },
  { id: "split", label: "分栏", icon: Columns2 },
  { id: "preview", label: "预览", icon: Eye },
];

export function MarkdownWorkbench({
  markdown,
  onMarkdownChange,
  dirty,
  editorMode,
  onEditorModeChange,
  selectedPlatform,
  onPlatformChange,
  platforms,
}: MarkdownWorkbenchProps) {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const lines = markdown.split("\n").length;
  const characters = markdown.replace(/\s/g, "").length;

  const applyMarkup = (prefix: string, suffix = prefix, placeholder = "文本") => {
    const editor = editorRef.current;
    if (!editor) return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = markdown.slice(start, end) || placeholder;
    onMarkdownChange(
      `${markdown.slice(0, start)}${prefix}${selected}${suffix}${markdown.slice(end)}`,
    );
    window.requestAnimationFrame(() => {
      editor.focus();
      editor.setSelectionRange(
        start + prefix.length,
        start + prefix.length + selected.length,
      );
    });
  };

  const insertBlock = (prefix: string, placeholder: string) =>
    applyMarkup(prefix, "", placeholder);

  return (
    <section className="markdown-workbench" aria-label="Markdown 编辑器">
      <div className="editor-toolbar">
        <div className="editor-toolbar__tools" aria-label="格式工具">
          <button
            aria-label="插入标题"
            onClick={() => insertBlock("## ", "小节标题")}
            title="标题"
            type="button"
          >
            <Heading2 size={16} />
          </button>
          <button
            aria-label="切换粗体"
            onClick={() => applyMarkup("**")}
            title="粗体"
            type="button"
          >
            <Bold size={16} />
          </button>
          <button
            aria-label="切换斜体"
            onClick={() => applyMarkup("*")}
            title="斜体"
            type="button"
          >
            <Italic size={16} />
          </button>
          <button
            aria-label="插入列表"
            onClick={() => insertBlock("- ", "列表项")}
            title="列表"
            type="button"
          >
            <List size={16} />
          </button>
          <button
            aria-label="插入引用"
            onClick={() => insertBlock("> ", "引用内容")}
            title="引用"
            type="button"
          >
            <Quote size={16} />
          </button>
          <button
            aria-label="插入图片"
            onClick={() => applyMarkup("![图片说明](", ")", "https://")}
            title="插入图片"
            type="button"
          >
            <ImagePlus size={16} />
          </button>
          <button
            aria-label="插入分隔线"
            onClick={() => insertBlock("\n---\n", "")}
            title="分隔线"
            type="button"
          >
            <MoreHorizontal size={17} />
          </button>
        </div>

        <div className="editor-toolbar__right">
          {editorMode !== "edit" && (
            <div className="platform-segments" aria-label="预览平台">
              {platforms.map((platform) => (
                <button
                  aria-pressed={selectedPlatform === platform.id}
                  className={selectedPlatform === platform.id ? "is-active" : ""}
                  key={platform.id}
                  onClick={() => onPlatformChange(platform.id)}
                  type="button"
                >
                  {platform.shortName}
                </button>
              ))}
            </div>
          )}
          <div className="mode-switch" aria-label="编辑器布局">
            {editorModes.map(({ id, label, icon: Icon }) => (
              <button
                aria-label={label}
                aria-pressed={editorMode === id}
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
              ref={editorRef}
              spellCheck="false"
              value={markdown}
            />
          </div>
        )}
        {editorMode !== "edit" && (
          <div className="preview-pane">
            <div className="preview-pane__meta">
              <span>平台预览</span>
              <strong>
                {platforms.find((item) => item.id === selectedPlatform)?.name}
              </strong>
            </div>
            <MarkdownPreview markdown={markdown} />
          </div>
        )}
      </div>

      <footer className="editor-status">
        <span>
          <i className={`status-dot${dirty ? " is-dirty" : " is-saved"}`} />
          {dirty ? "有未保存修改" : "已保存"}
        </span>
        <span>Markdown</span>
        <span>{lines} 行</span>
        <span>{characters} 字</span>
      </footer>
    </section>
  );
}
