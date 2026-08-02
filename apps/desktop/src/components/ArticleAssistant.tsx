import {
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  LoaderCircle,
  SendHorizontal,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { RewriteArticleSummary } from "../lib/desktopBridge";

export interface MarkdownSelection {
  start: number;
  end: number;
  text: string;
}

export interface RewriteCandidate {
  replacement: string;
  selection: MarkdownSelection | null;
  model: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
}

interface ArticleAssistantProps {
  selection: MarkdownSelection | null;
  onClearSelection: () => void;
  onRewrite: (
    instruction: string,
    selection: MarkdownSelection | null,
  ) => Promise<RewriteArticleSummary>;
  onApplyCandidate: (candidate: RewriteCandidate) => Promise<void>;
}

const quickInstructions = ["表达更简洁", "补充可执行步骤", "调整为技术作者口吻"];

export function ArticleAssistant({
  selection,
  onClearSelection,
  onRewrite,
  onApplyCandidate,
}: ArticleAssistantProps) {
  const [open, setOpen] = useState(true);
  const [instruction, setInstruction] = useState("");
  const [scope, setScope] = useState<"selection" | "article">("article");
  const [working, setWorking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [candidate, setCandidate] = useState<RewriteCandidate | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    if (!selection?.text.trim()) return;
    setScope("selection");
    setOpen(true);
  }, [selection?.start, selection?.end]);

  const activeSelection = scope === "selection" ? selection : null;
  const scopeLabel = activeSelection ? `选中内容 · ${activeSelection.text.length} 字` : "整篇文章";

  const submit = async (nextInstruction = instruction) => {
    const normalized = nextInstruction.trim();
    if (!normalized || working || applying) return;
    setWorking(true);
    setCandidate(null);
    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", text: `${scopeLabel}：${normalized}` },
    ]);
    try {
      const result = await onRewrite(normalized, activeSelection);
      setCandidate({
        replacement: result.replacement,
        selection: activeSelection,
        model: result.model,
      });
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text: "已生成修改建议。确认后会保存为新的文章修订。",
        },
      ]);
      setInstruction("");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setMessages((current) => [
        ...current,
        { id: `assistant-error-${Date.now()}`, role: "assistant", text: `修改失败：${detail.slice(0, 140)}` },
      ]);
    } finally {
      setWorking(false);
    }
  };

  const applyCandidate = async () => {
    if (!candidate || applying) return;
    setApplying(true);
    try {
      await onApplyCandidate(candidate);
      setMessages((current) => [
        ...current,
        { id: `assistant-applied-${Date.now()}`, role: "assistant", text: "修改已应用，并保存为新的文章修订。" },
      ]);
      setCandidate(null);
      if (scope === "selection") {
        onClearSelection();
        setScope("article");
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setMessages((current) => [
        ...current,
        { id: `assistant-apply-error-${Date.now()}`, role: "assistant", text: `无法应用修改：${detail.slice(0, 140)}` },
      ]);
    } finally {
      setApplying(false);
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
          <small>{activeSelection ? "正在修改选中内容" : "针对全文提出修改"}</small>
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
              disabled={!selection?.text.trim()}
              onClick={() => setScope("selection")}
              type="button"
            >
              <WandSparkles size={13} /> 选中内容
            </button>
          </div>

          <div className="article-assistant__conversation" aria-live="polite">
            {messages.length === 0 && (
              <div className="article-assistant__empty">
                <Sparkles size={17} />
                <p>说明你希望怎样调整文章。修改会先生成候选内容，确认后才写入正文。</p>
              </div>
            )}
            {messages.map((message) => (
              <p className={`article-assistant__message is-${message.role}`} key={message.id}>
                {message.text}
              </p>
            ))}
            {working && (
              <p className="article-assistant__message is-assistant" role="status">
                <LoaderCircle className="spin" size={14} /> AI 正在生成修改建议
              </p>
            )}
            {candidate && (
              <article className="article-assistant__candidate">
                <header>
                  <strong>修改建议</strong>
                  <small>{candidate.selection ? "仅替换选中内容" : "替换全文"}</small>
                </header>
                <pre>{candidate.replacement}</pre>
                <footer>
                  <button
                    className="button button--quiet"
                    disabled={applying}
                    onClick={() => setCandidate(null)}
                    type="button"
                  >
                    <X size={14} /> 舍弃
                  </button>
                  <button
                    className="button button--primary"
                    disabled={applying}
                    onClick={() => void applyCandidate()}
                    type="button"
                  >
                    {applying ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}
                    {applying ? "保存中" : "应用修改"}
                  </button>
                </footer>
              </article>
            )}
          </div>

          <div className="article-assistant__composer">
            <div className="article-assistant__quick-actions" aria-label="常用修改方式">
              {quickInstructions.map((item) => (
                <button key={item} onClick={() => void submit(item)} type="button">
                  {item}
                </button>
              ))}
            </div>
            <label>
              <span className="visually-hidden">对文章的修改要求</span>
              <textarea
                disabled={working || applying}
                onChange={(event) => setInstruction(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submit();
                  }
                }}
                placeholder={activeSelection ? "说明如何修改这段内容" : "例如：删掉重复表达，保留技术细节"}
                value={instruction}
              />
            </label>
            <button
              aria-label="生成 AI 修改建议"
              className="article-assistant__send"
              disabled={!instruction.trim() || working || applying}
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
