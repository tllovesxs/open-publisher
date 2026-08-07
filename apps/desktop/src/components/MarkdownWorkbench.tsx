import {
  Bold,
  Heading2,
  ImagePlus,
  Italic,
  List,
  MoreHorizontal,
  Quote,
  WandSparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MarkdownSelection } from "./ArticleAssistant";
import type { MediaAsset, PlatformDefinition, PlatformId } from "../types";
import { MarkdownPreview } from "./MarkdownPreview";

export type EditorMode = "edit" | "split" | "preview";

export interface ImageInsertion {
  alt: string;
  src: string;
}

interface SelectionActionPosition {
  left: number;
  top: number;
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
}> = [
  { id: "edit", label: "仅编辑" },
  { id: "split", label: "编辑与预览" },
  { id: "preview", label: "仅预览" },
];

type ScrollablePane = HTMLTextAreaElement | HTMLDivElement;

function syncScrollPosition(source: ScrollablePane, target: ScrollablePane): number | null {
  const sourceMaximum = Math.max(0, source.scrollHeight - source.clientHeight);
  const targetMaximum = Math.max(0, target.scrollHeight - target.clientHeight);
  const progress = sourceMaximum > 0
    ? Math.min(1, Math.max(0, source.scrollTop / sourceMaximum))
    : 0;
  const nextScrollTop = progress * targetMaximum;

  // Assign only when needed so the paired scroll handler does not keep
  // bouncing between the two rounded browser scroll positions.
  if (Math.abs(target.scrollTop - nextScrollTop) > 0.5) {
    target.scrollTop = nextScrollTop;
    return nextScrollTop;
  }
  return null;
}

function positionSelectionAction(editor: HTMLTextAreaElement): SelectionActionPosition {
  const selectionEnd = editor.selectionEnd;
  const document = editor.ownerDocument;
  const mirror = document.createElement("div");
  const marker = document.createElement("span");
  const computed = window.getComputedStyle(editor);
  const rect = editor.getBoundingClientRect();
  const copiedStyles = [
    "boxSizing",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "letterSpacing",
    "lineHeight",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "tabSize",
    "textTransform",
    "wordSpacing",
  ] as const;
  Object.assign(mirror.style, {
    position: "fixed",
    visibility: "hidden",
    overflow: "hidden",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    wordBreak: "break-word",
    top: `${rect.top - editor.scrollTop}px`,
    left: `${rect.left - editor.scrollLeft}px`,
    width: `${editor.clientWidth}px`,
  });
  copiedStyles.forEach((property) => {
    mirror.style[property] = computed[property];
  });
  mirror.textContent = editor.value.slice(0, selectionEnd);
  marker.textContent = editor.value.slice(selectionEnd, selectionEnd + 1) || "\u200b";
  mirror.append(marker);
  document.body.append(mirror);
  const markerRect = marker.getBoundingClientRect();
  mirror.remove();
  return {
    left: Math.max(8, Math.min(markerRect.right + 10, window.innerWidth - 205)),
    top: Math.max(8, Math.min(markerRect.bottom + 10, window.innerHeight - 42)),
  };
}

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
  const previewRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const scrollSourceRef = useRef<"editor" | "preview">("editor");
  // A programmatic scroll dispatches the same event as a user gesture in
  // Chromium. Keep its expected position so it cannot steal the source role
  // before a resize or image load recalculates the proportional position.
  const synchronizedScrollTopsRef = useRef<Record<"editor" | "preview", number | null>>({
    editor: null,
    preview: null,
  });
  const [isDroppingImage, setIsDroppingImage] = useState(false);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const [imageDropError, setImageDropError] = useState<string | null>(null);
  const [selectedText, setSelectedText] = useState<MarkdownSelection | null>(null);
  const [selectionActionPosition, setSelectionActionPosition] = useState<SelectionActionPosition | null>(null);
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
    setSelectionActionPosition(next ? positionSelectionAction(editor) : null);
    onSelectionChange?.(next);
  };

  const updateSelectionActionPosition = (editor: HTMLTextAreaElement) => {
    if (!selectedText?.text.trim()) return;
    setSelectionActionPosition(positionSelectionAction(editor));
  };

  const syncPaneScroll = (
    source: ScrollablePane,
    target: ScrollablePane,
    targetKey: "editor" | "preview",
  ) => {
    const synchronizedTop = syncScrollPosition(source, target);
    if (synchronizedTop !== null) {
      synchronizedScrollTopsRef.current[targetKey] = synchronizedTop;
    }
  };

  const consumesSynchronizedScroll = (
    pane: "editor" | "preview",
    element: ScrollablePane,
  ) => {
    const expectedTop = synchronizedScrollTopsRef.current[pane];
    if (expectedTop === null) return false;
    synchronizedScrollTopsRef.current[pane] = null;
    return Math.abs(element.scrollTop - expectedTop) <= 0.5;
  };

  const syncPreviewToEditorScroll = (editor: HTMLTextAreaElement) => {
    const preview = previewRef.current;
    if (editorMode === "split" && preview) {
      if (consumesSynchronizedScroll("editor", editor)) return;
      scrollSourceRef.current = "editor";
      syncPaneScroll(editor, preview, "preview");
    }
  };

  const syncEditorToPreviewScroll = (preview: HTMLDivElement) => {
    const editor = editorRef.current;
    if (editorMode === "split" && editor) {
      if (consumesSynchronizedScroll("preview", preview)) return;
      scrollSourceRef.current = "preview";
      syncPaneScroll(preview, editor, "editor");
    }
  };

  useEffect(() => {
    if (editorMode !== "split") return;
    let frame: number | null = null;
    const syncFromActivePane = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const editor = editorRef.current;
        const preview = previewRef.current;
        if (!editor || !preview) return;
        if (scrollSourceRef.current === "preview") {
          syncPaneScroll(preview, editor, "editor");
          return;
        }
        syncPaneScroll(editor, preview, "preview");
      });
    };

    syncFromActivePane();
    window.addEventListener("resize", syncFromActivePane);

    // The two panes do not have the same line height or content height. Keep
    // the last-scrolled pane as the source when a resize or lazy-loaded image
    // changes either scroll range.
    const preview = previewRef.current;
    const editor = editorRef.current;
    const ResizeObserverConstructor = typeof ResizeObserver === "undefined"
      ? null
      : ResizeObserver;
    const observer = ResizeObserverConstructor
      ? new ResizeObserverConstructor(syncFromActivePane)
      : null;
    if (observer && editor && preview) {
      observer.observe(editor);
      observer.observe(preview);
      const previewContent = preview.querySelector(".markdown-preview");
      if (previewContent) observer.observe(previewContent);
    }

    return () => {
      window.removeEventListener("resize", syncFromActivePane);
      observer?.disconnect();
      synchronizedScrollTopsRef.current.editor = null;
      synchronizedScrollTopsRef.current.preview = null;
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [editorMode, markdown]);

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
            <select
              aria-label="编辑器布局"
              className="mode-switch__select"
              onChange={(event) => onEditorModeChange(event.target.value as EditorMode)}
              value={editorMode}
            >
              {editorModes.map(({ id, label }) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
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
              onScroll={(event) => {
                syncPreviewToEditorScroll(event.currentTarget);
                updateSelectionActionPosition(event.currentTarget);
              }}
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
            {selectedText && selectionActionPosition && onRequestSelectionRewrite && (
              <button
                className="selection-rewrite-button"
                onClick={() => {
                  onRequestSelectionRewrite(selectedText);
                  setSelectedText(null);
                  setSelectionActionPosition(null);
                }}
                onPointerDown={(event) => event.preventDefault()}
                style={selectionActionPosition}
                type="button"
              >
                <WandSparkles size={14} /> AI 修改选中内容
              </button>
            )}
          </div>
        )}
        {editorMode !== "edit" && (
          <div
            className="preview-pane"
            onScroll={(event) => syncEditorToPreviewScroll(event.currentTarget)}
            ref={previewRef}
          >
            <div className="preview-pane__meta">
              <span>平台预览</span>
              <strong>
                {platforms.find((item) => item.id === selectedPlatform)?.name}
              </strong>
            </div>
            <MarkdownPreview
              markdown={markdown}
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
