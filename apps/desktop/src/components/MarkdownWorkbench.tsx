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
  WandSparkles,
} from "lucide-react";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import type { MarkdownSelection } from "./ArticleAssistant";
import type { MediaAsset, PlatformDefinition, PlatformId } from "../types";
import { MarkdownPreview } from "./MarkdownPreview";

export type EditorMode = "edit" | "split" | "preview";

export interface ImageInsertion {
  alt: string;
  src: string;
}

interface MarkdownWorkbenchProps {
  markdown: string;
  onMarkdownChange: (markdown: string) => void;
  dirty: boolean;
  editorMode: EditorMode;
  onEditorModeChange: (mode: EditorMode) => void;
  selectedPlatform: PlatformId;
  onPlatformChange: (platform: PlatformId) => void;
  platforms: PlatformDefinition[];
  mediaAssets?: MediaAsset[];
  onImageFileDrop?: (file: File) => Promise<ImageInsertion>;
  onRequestImageInsert?: () => void;
  pendingImageInsertion?: ImageInsertion | null;
  onPendingImageInsertionHandled?: () => void;
  streaming?: boolean;
  contentReplacing?: boolean;
  onSelectionChange?: (selection: MarkdownSelection | null) => void;
  onRequestSelectionRewrite?: (selection: MarkdownSelection) => void;
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
  mediaAssets = [],
  onImageFileDrop,
  onRequestImageInsert,
  pendingImageInsertion,
  onPendingImageInsertionHandled,
  streaming = false,
  contentReplacing = false,
  onSelectionChange,
  onRequestSelectionRewrite,
}: MarkdownWorkbenchProps) {
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const deferredPreviewMarkdown = useDeferredValue(markdown);
  const [isDroppingImage, setIsDroppingImage] = useState(false);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [imageDropError, setImageDropError] = useState<string | null>(null);
  const [selectedText, setSelectedText] = useState<MarkdownSelection | null>(null);
  const lines = markdown.split("\n").length;
  const characters = markdown.replace(/\s/g, "").length;

  const applyMarkup = (prefix: string, suffix = prefix, placeholder = "文本") => {
    const editor = editorRef.current;
    if (!editor) return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    selectionRef.current = { start, end };
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

  const insertAtSelection = (value: string) => {
    const editor = editorRef.current;
    const start = editor ? editor.selectionStart : selectionRef.current.start;
    const end = editor ? editor.selectionEnd : selectionRef.current.end;
    const before = markdown.slice(0, start);
    const after = markdown.slice(end);
    const prefix = before && !before.endsWith("\n") ? "\n\n" : "";
    const suffix = after && !after.startsWith("\n") ? "\n\n" : "";
    onMarkdownChange(`${before}${prefix}${value}${suffix}${after}`);
    selectionRef.current = { start: start + prefix.length + value.length, end: start + prefix.length + value.length };
    window.requestAnimationFrame(() => {
      if (!editor) return;
      editor.focus();
      const position = start + prefix.length + value.length;
      editor.setSelectionRange(position, position);
    });
  };

  useEffect(() => {
    if (!pendingImageInsertion) return;
    insertAtSelection(`![${pendingImageInsertion.alt}](${pendingImageInsertion.src})`);
    onPendingImageInsertionHandled?.();
  }, [pendingImageInsertion]); // Selection is intentionally captured before the dialog takes focus.

  const importFiles = async (files: File[]) => {
    if (!onImageFileDrop) {
      setImageDropError("图片导入服务尚未连接。");
      return;
    }
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!images.length) {
      setImageDropError("只能拖入图片文件。");
      return;
    }
    setIsDroppingImage(true);
    setImageDropError(null);
    try {
      const inserted = await Promise.all(images.map(onImageFileDrop));
      insertAtSelection(inserted.map(({ alt, src }) => `![${alt}](${src})`).join("\n\n"));
    } catch (error) {
      setImageDropError(error instanceof Error ? error.message : "图片导入失败，请重试。");
    } finally {
      setIsDroppingImage(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    setIsDropTarget(false);
    const markdownImage = event.dataTransfer.getData("application/x-open-publisher-markdown-image");
    if (markdownImage) {
      setImageDropError(null);
      insertAtSelection(markdownImage);
      return;
    }
    void importFiles(Array.from(event.dataTransfer.files));
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;
    event.preventDefault();
    void importFiles(images);
  };

  const captureSelection = (editor: HTMLTextAreaElement) => {
    const selection = {
      start: editor.selectionStart,
      end: editor.selectionEnd,
      text: markdown.slice(editor.selectionStart, editor.selectionEnd),
    };
    selectionRef.current = selection;
    const next = selection.text.trim() ? selection : null;
    setSelectedText(next);
    onSelectionChange?.(next);
  };

  return (
    <section className={`markdown-workbench${contentReplacing ? " is-content-replacing" : ""}`} aria-label="Markdown 编辑器">
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
            onClick={() => onRequestImageInsert?.()}
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
              aria-busy={isDroppingImage || undefined}
              className={isDropTarget ? "is-drop-target" : undefined}
              onChange={(event) => onMarkdownChange(event.target.value)}
              onDragEnter={(event) => {
                if (event.dataTransfer.types.includes("Files") || event.dataTransfer.types.includes("application/x-open-publisher-markdown-image")) {
                  event.preventDefault();
                  setIsDropTarget(true);
                }
              }}
              onDragLeave={(event) => {
                if (event.currentTarget === event.target) setIsDropTarget(false);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
              onPaste={handlePaste}
              onSelect={(event) => {
                captureSelection(event.currentTarget);
              }}
              onBlur={(event) => {
                selectionRef.current = {
                  start: event.currentTarget.selectionStart,
                  end: event.currentTarget.selectionEnd,
                };
              }}
              ref={editorRef}
              spellCheck="false"
              value={markdown}
            />
            {selectedText && onRequestSelectionRewrite && (
              <button
                className="selection-rewrite-button"
                onClick={() => onRequestSelectionRewrite(selectedText)}
                onMouseDown={(event) => event.preventDefault()}
                type="button"
              >
                <WandSparkles size={14} /> AI 修改选中内容
              </button>
            )}
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
            <MarkdownPreview
              markdown={streaming ? deferredPreviewMarkdown : markdown}
              mediaAssets={mediaAssets}
            />
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
        {isDroppingImage && <span className="editor-status__progress" role="status">正在导入图片</span>}
        {streaming && <span className="editor-status__progress" role="status">写作 Agent 正在流式写入</span>}
        {imageDropError && <span className="editor-status__error" role="alert">{imageDropError}</span>}
      </footer>
    </section>
  );
}
