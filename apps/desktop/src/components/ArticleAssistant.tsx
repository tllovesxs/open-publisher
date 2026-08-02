import {
  Bot,
  ChevronLeft,
  ChevronRight,
  FileText,
  LoaderCircle,
  MessageSquareText,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  subscribeToRewriteEvents,
  type RewriteArticleSummary,
  type RewriteConversationMessage,
} from "../lib/desktopBridge";

export interface MarkdownSelection {
  start: number;
  end: number;
  text: string;
}

export interface RewriteCandidate {
  replacements: string[];
  selections: MarkdownSelection[];
  model: string;
  summary: string;
}

interface Message extends RewriteConversationMessage {
  id: string;
  createdAt: number;
}

interface ArticleAssistantProps {
  articleId: string;
  selections: MarkdownSelection[];
  canUndo: boolean;
  onClearSelections: () => void;
  onRemoveSelection: (selection: MarkdownSelection) => void;
  onRewrite: (
    instruction: string,
    selections: MarkdownSelection[],
    conversation: RewriteConversationMessage[],
    requestId: string,
  ) => Promise<RewriteArticleSummary>;
  onApplyCandidate: (candidate: RewriteCandidate) => Promise<void>;
  onUndoLastRewrite: () => Promise<void>;
}

const quickInstructions = ["表达更简洁", "补充可执行步骤", "调整为技术作者口吻"];
const sessionStorageKey = (articleId: string) => `open-publisher.article-assistant.${articleId}`;

function selectionKey(selection: MarkdownSelection) {
  return `${selection.start}:${selection.end}:${selection.text}`;
}

function compactPreview(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 54);
}

function loadSession(articleId: string): Message[] {
  try {
    const raw = window.localStorage.getItem(sessionStorageKey(articleId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item, index) => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as Partial<Message>;
      if (
        (candidate.role !== "user" && candidate.role !== "assistant") ||
        typeof candidate.text !== "string" ||
        !candidate.text.trim()
      ) {
        return [];
      }
      return [{
        id: typeof candidate.id === "string" ? candidate.id : `restored-${index}`,
        role: candidate.role,
        text: candidate.text.slice(0, 8_000),
        createdAt: typeof candidate.createdAt === "number" ? candidate.createdAt : 0,
      }];
    }).slice(-24);
  } catch {
    return [];
  }
}

function saveSession(articleId: string, messages: Message[]) {
  try {
    window.localStorage.setItem(sessionStorageKey(articleId), JSON.stringify(messages.slice(-24)));
  } catch {
    // Conversation history is non-critical. Writing must stay usable if storage is unavailable.
  }
}

function visibleEditorialNote(markup: string) {
  const startToken = "<editorial_note>";
  const endToken = "</editorial_note>";
  const start = markup.indexOf(startToken);
  if (start < 0) return "";
  const contentStart = start + startToken.length;
  const end = markup.indexOf(endToken, contentStart);
  return markup.slice(contentStart, end < 0 ? undefined : end).trimStart();
}

export function ArticleAssistant({
  articleId,
  selections,
  canUndo,
  onClearSelections,
  onRemoveSelection,
  onRewrite,
  onApplyCandidate,
  onUndoLastRewrite,
}: ArticleAssistantProps) {
  const [open, setOpen] = useState(true);
  const [instruction, setInstruction] = useState("");
  const [scope, setScope] = useState<"selection" | "article">("article");
  const [working, setWorking] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => loadSession(articleId));
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [liveNote, setLiveNote] = useState("");
  const activeRequestRef = useRef<string | null>(null);
  const streamedMarkupRef = useRef("");
  const streamedNoteRef = useRef("");
  const typewriterQueueRef = useRef("");
  const typewriterFrameRef = useRef<number | null>(null);

  const scheduleTypewriter = () => {
    if (typewriterFrameRef.current !== null) return;
    typewriterFrameRef.current = window.requestAnimationFrame(() => {
      typewriterFrameRef.current = null;
      const [nextCharacter, ...remaining] = Array.from(typewriterQueueRef.current);
      if (!nextCharacter) return;
      typewriterQueueRef.current = remaining.join("");
      setLiveNote((current) => `${current}${nextCharacter}`);
      if (typewriterQueueRef.current) scheduleTypewriter();
    });
  };

  useEffect(() => {
    setMessages(loadSession(articleId));
    setInstruction("");
    setLiveStatus(null);
    setLiveNote("");
    activeRequestRef.current = null;
    streamedMarkupRef.current = "";
    streamedNoteRef.current = "";
    typewriterQueueRef.current = "";
  }, [articleId]);

  useEffect(() => {
    saveSession(articleId, messages);
  }, [articleId, messages]);

  useEffect(() => {
    if (!selections.length) {
      if (scope === "selection") setScope("article");
      return;
    }
    setScope("selection");
    setOpen(true);
  }, [selections]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void subscribeToRewriteEvents((event) => {
      if (
        event.articleId !== articleId ||
        event.requestId !== activeRequestRef.current
      ) {
        return;
      }
      if (event.eventType === "status") {
        setLiveStatus(event.detail || "AI 正在处理修改请求");
        return;
      }
      if (event.eventType !== "delta" || !event.delta) return;
      streamedMarkupRef.current += event.delta;
      const nextNote = visibleEditorialNote(streamedMarkupRef.current);
      if (!nextNote.startsWith(streamedNoteRef.current)) return;
      const delta = nextNote.slice(streamedNoteRef.current.length);
      streamedNoteRef.current = nextNote;
      if (!delta) return;
      typewriterQueueRef.current += delta;
      scheduleTypewriter();
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
      if (typewriterFrameRef.current !== null) {
        window.cancelAnimationFrame(typewriterFrameRef.current);
        typewriterFrameRef.current = null;
      }
    };
  }, [articleId]);

  const addMessage = (role: Message["role"], text: string) => {
    setMessages((current) => [
      ...current,
      { id: `${role}-${Date.now()}-${current.length}`, role, text, createdAt: Date.now() },
    ].slice(-24));
  };

  const activeSelections = scope === "selection" ? selections : [];
  const scopeLabel = activeSelections.length
    ? `${activeSelections.length} 个选中文本片段`
    : "整篇文章";

  const submit = async (nextInstruction = instruction) => {
    const normalized = nextInstruction.trim();
    if (!normalized || working || undoing) return;
    const requestId = `rewrite-${crypto.randomUUID?.() ?? Date.now()}`;
    activeRequestRef.current = requestId;
    streamedMarkupRef.current = "";
    streamedNoteRef.current = "";
    typewriterQueueRef.current = "";
    setLiveNote("");
    setLiveStatus("AI 正在读取文章与已选片段");
    setWorking(true);
    addMessage("user", `${scopeLabel}：${normalized}`);
    try {
      const result = await onRewrite(
        normalized,
        activeSelections,
        messages.slice(-12).map(({ role, text }) => ({ role, text })),
        requestId,
      );
      const candidate: RewriteCandidate = {
        replacements: result.replacements,
        selections: activeSelections,
        model: result.model,
        summary: result.summary,
      };
      await onApplyCandidate(candidate);
      addMessage(
        "assistant",
        `${result.summary}\n\n已同步修改正文，可使用“撤销上次 AI 修改”恢复。`,
      );
      setInstruction("");
      activeSelections.forEach(onRemoveSelection);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      addMessage("assistant", `修改失败：${detail.slice(0, 180)}`);
    } finally {
      activeRequestRef.current = null;
      setWorking(false);
      setLiveStatus(null);
    }
  };

  const undo = async () => {
    if (!canUndo || undoing || working) return;
    setUndoing(true);
    try {
      await onUndoLastRewrite();
      addMessage("assistant", "已撤销上一次 AI 修改，并保存为新的文章修订。");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      addMessage("assistant", `撤销失败：${detail.slice(0, 180)}`);
    } finally {
      setUndoing(false);
    }
  };

  return (
    <aside className={`article-assistant${open ? " is-open" : ""}`} aria-label="AI 修改助手">
      <button
        aria-expanded={open}
        className="article-assistant__toggle"
        onClick={() => setOpen((current) => !current)}
        title={open ? "收起 AI 修改助手" : "打开 AI 修改助手"}
        type="button"
      >
        <span className="article-assistant__icon"><Bot size={16} /></span>
        <span className="article-assistant__toggle-copy">
          <strong>AI 修改</strong>
          <small>{selections.length ? `已选 ${selections.length} 个文本片段` : "针对全文提出修改"}</small>
        </span>
        {open ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>

      {open && (
        <div className="article-assistant__content">
          <div className="article-assistant__scope" role="group" aria-label="修改范围">
            <button
              aria-pressed={scope === "article"}
              className={scope === "article" ? "is-active" : ""}
              onClick={() => setScope("article")}
              type="button"
            >
              <FileText size={13} /> 全文
            </button>
            <button
              aria-pressed={scope === "selection"}
              className={scope === "selection" ? "is-active" : ""}
              disabled={!selections.length}
              onClick={() => setScope("selection")}
              type="button"
            >
              <MessageSquareText size={13} /> 已选片段 {selections.length || ""}
            </button>
          </div>

          {selections.length > 0 && (
            <section className="article-assistant__selections" aria-label="已选文本片段">
              <div className="article-assistant__selections-head">
                <strong>{selections.length} 个已选文本片段</strong>
                <button className="text-button" onClick={onClearSelections} type="button">全部移除</button>
              </div>
              <div className="article-assistant__selection-list">
                {selections.map((selection, index) => (
                  <div className="article-assistant__selection-chip" key={selectionKey(selection)}>
                    <span>{index + 1}</span>
                    <strong>{compactPreview(selection.text)}</strong>
                    <div className="article-assistant__selection-preview" role="tooltip">
                      {selection.text}
                    </div>
                    <button
                      aria-label={`移除已选片段 ${index + 1}`}
                      onClick={() => onRemoveSelection(selection)}
                      title="移除片段"
                      type="button"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="article-assistant__conversation" aria-live="polite">
            {messages.length === 0 && !working && (
              <div className="article-assistant__empty">
                <Sparkles size={17} />
                <p>选择正文片段后可逐段加入这里，也可以直接针对全文提出修改。每篇文章保留独立的修改会话。</p>
              </div>
            )}
            {messages.map((message) => (
              <p className={`article-assistant__message is-${message.role}`} key={message.id}>
                {message.text}
              </p>
            ))}
            {(working || liveNote) && (
              <section className="article-assistant__live" role="status">
                <header>
                  {working ? <LoaderCircle className="spin" size={14} /> : <Sparkles size={14} />}
                  {working ? liveStatus || "AI 正在生成修改" : "AI 编辑说明"}
                </header>
                {liveNote && <p>{liveNote}</p>}
              </section>
            )}
          </div>

          <div className="article-assistant__composer">
            <div className="article-assistant__composer-head">
              <span>{scopeLabel}</span>
              <button
                className="text-button"
                disabled={!canUndo || working || undoing}
                onClick={() => void undo()}
                type="button"
              >
                {undoing ? <LoaderCircle className="spin" size={13} /> : <RotateCcw size={13} />}
                撤销上次 AI 修改
              </button>
            </div>
            <div className="article-assistant__quick-actions" aria-label="常用修改方式">
              {quickInstructions.map((item) => (
                <button disabled={working || undoing} key={item} onClick={() => void submit(item)} type="button">
                  {item}
                </button>
              ))}
            </div>
            <label>
              <span className="visually-hidden">对文章的修改要求</span>
              <textarea
                disabled={working || undoing}
                onChange={(event) => setInstruction(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submit();
                  }
                }}
                placeholder={activeSelections.length ? "说明如何修改这些片段" : "例如：删掉重复表达，保留技术细节"}
                value={instruction}
              />
            </label>
            <button
              aria-label="应用 AI 修改"
              className="article-assistant__send"
              disabled={!instruction.trim() || working || undoing}
              onClick={() => void submit()}
              type="button"
            >
              {working ? <LoaderCircle className="spin" size={16} /> : <SendHorizontal size={16} />}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
