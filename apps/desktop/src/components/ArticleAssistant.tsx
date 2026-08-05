import {
  AlertCircle,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Image,
  LoaderCircle,
  RotateCcw,
  Search,
  SendHorizontal,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  subscribeToRewriteEvents,
  type RewriteArticleSummary,
  type RewriteConversationMessage,
} from "../lib/desktopBridge";
import type { WorkflowWorkspaceSnapshot } from "./WorkflowWorkspace";

export interface MarkdownSelection {
  start: number;
  end: number;
  text: string;
}

/** Immutable editor snapshot captured before a rewrite request starts. */
export interface RewriteSourceSnapshot {
  articleId: string;
  markdown: string;
  revisionId: string | null;
  editVersion: number;
}

export interface RewriteCandidate {
  replacements: string[];
  selections: MarkdownSelection[];
  model: string;
  summary: string;
  source: RewriteSourceSnapshot;
}

export interface RewriteArticleOutcome extends RewriteArticleSummary {
  source: RewriteSourceSnapshot;
  visualRefreshRecommended?: boolean;
}

export interface AppliedRewrite {
  revisionId: string;
  markdown: string;
}

export interface AssistantActivity {
  title: string;
  detail: string;
  value: number | null;
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
  ) => Promise<RewriteArticleOutcome>;
  onRewriteRunStarted?: (articleId: string, requestId: string, runId: string) => void;
  onComposeVisual: (
    instruction: string,
    conversation: RewriteConversationMessage[],
    onActivity: (activity: AssistantActivity) => void,
    sourceMarkdown?: string,
    baseRevisionId?: string,
    replaceExistingImages?: boolean,
    targetSelections?: MarkdownSelection[],
  ) => Promise<{ summary: string }>;
  onApplyCandidate: (candidate: RewriteCandidate) => Promise<AppliedRewrite>;
  onUndoLastRewrite: () => Promise<void>;
  workflowSnapshot?: WorkflowWorkspaceSnapshot | null;
  workflowRunning?: boolean;
  workflowProgress?: { title: string; detail: string; value: number | null } | null;
  workflowFailure?: {
    detail: string;
    logs: Array<{
      id: string;
      timestamp: number;
      message: string;
      tone: "info" | "success" | "error";
    }>;
    retryable: boolean;
  } | null;
  workflowRetryable?: boolean;
  onRetryWorkflow?: () => void;
  onCancelWorkflow?: () => void;
  cancellingWorkflow?: boolean;
}

const sessionStorageKey = (articleId: string) => `open-publisher.article-assistant.${articleId}`;

type WorkflowEvent = WorkflowWorkspaceSnapshot["events"][number];

const workflowNodeLabels: Record<string, string> = {
  research: "公开资料",
  outline: "文章结构",
  draft: "正文",
  "natural-style": "表达调整",
  review: "内容审阅",
  "reference-safety": "资料核验",
  risk: "风险检查",
  visual: "配图方案",
};

function workflowEventLabel(event: WorkflowEvent) {
  const node = event.nodeId ? workflowNodeLabels[event.nodeId] ?? "文章" : "文章";
  switch (event.eventType) {
    case "run.queued":
      return "已准备本次创作";
    case "run.started":
      return "开始生成文章";
    case "run.node_started":
      return event.nodeId === "draft" ? "正在撰写正文" : `正在处理${node}`;
    case "run.node_completed":
      return `${node}已完成`;
    case "run.node_failed":
      return `${node}未完成`;
    case "run.node_skipped":
      return `已跳过${node}`;
    case "run.node_tool_called":
      return event.toolName === "github_repository" ? "已读取项目资料" : "已检索公开资料";
    case "run.node_research_degraded":
      return "外部资料不可用，已按现有资料继续";
    case "run.node_precheck":
      return "已检查配图设置";
    case "run.node_outline_saved":
      return "已整理配图方案";
    case "run.node_prompts_saved":
      return "已准备生图描述";
    case "run.completed":
      return "文章处理完成";
    case "run.failed":
      return "本次创作未完成";
    default:
      return "正在处理文章";
  }
}

function workflowEventState(event: WorkflowEvent) {
  if (event.eventType === "run.node_failed" || event.eventType === "run.failed") return "error";
  if (
    event.eventType === "run.node_completed" ||
    event.eventType === "run.completed" ||
    event.eventType === "run.node_tool_called" ||
    event.eventType === "run.node_research_degraded" ||
    event.eventType === "run.node_skipped" ||
    event.eventType === "run.queued" ||
    event.eventType === "run.started" ||
    event.eventType === "run.node_precheck" ||
    event.eventType === "run.node_outline_saved" ||
    event.eventType === "run.node_prompts_saved"
  ) return "complete";
  return "running";
}

function workflowEventIcon(event: WorkflowEvent) {
  if (event.eventType === "run.node_tool_called") return Search;
  if (event.eventType === "run.node_research_degraded") return AlertCircle;
  if (event.eventType === "run.node_failed" || event.eventType === "run.failed") return AlertCircle;
  if (
    event.eventType === "run.node_completed" ||
    event.eventType === "run.completed" ||
    event.eventType === "run.node_skipped"
  ) return Check;
  if (event.nodeId === "draft") return FileText;
  if (event.nodeId === "visual") return Image;
  if (event.nodeId === "review" || event.nodeId === "risk" || event.nodeId === "reference-safety") return ShieldCheck;
  return LoaderCircle;
}

function compactWorkflowEvents(events: WorkflowEvent[]) {
  const stages = new Map<string, WorkflowEvent>();
  events.forEach((event) => {
    if (
      event.eventType === "run.node_output_delta" ||
      event.eventType === "run.node_skipped" ||
      event.eventType === "run.queued" ||
      event.eventType === "run.started" ||
      event.eventType === "run.node_precheck"
    ) return;
    const key = event.eventType === "run.node_tool_called"
      ? `${event.nodeId ?? "research"}:${event.toolName ?? "search"}`
      : event.nodeId ?? event.eventType;
    stages.set(key, event);
  });
  return [...stages.values()]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-6);
}

function workflowProcessSummary(events: WorkflowEvent[]) {
  const completedStages = new Set(
    events
      .filter((event) => event.eventType === "run.node_completed" && event.nodeId)
      .map((event) => event.nodeId),
  ).size;
  const toolCalls = events.filter((event) => event.eventType === "run.node_tool_called").length;
  const parts = [`${Math.max(1, completedStages)} 项完成`];
  if (toolCalls > 0) parts.push(`${toolCalls} 次资料读取`);
  return parts.join(" · ");
}

function visibleProgressLabel(value: string) {
  if (/打字机|流式/u.test(value)) return "正在撰写正文";
  if (value.includes("暂时无法读取本地运行时进度")) return "正在准备下一步";
  return value
    .replace(/(?:主写作|写作|视觉|配图)\s*Agent\s*/gu, "")
    .replace(/\s*Agent\s*/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

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

function withoutNegatedVisualClauses(instruction: string) {
  return instruction.replace(
    /(?:不要|不用|无需|不需要|别|保持|保留|维持|禁止)(?:再|去)?[^，。；;\n]{0,12}(?:配图|插图|图片|图像|封面|(?:[一二三四五六1-6])?(?:张|幅)?图)/gu,
    "",
  );
}

function hasExplicitVisualRequest(instruction: string) {
  const actionable = withoutNegatedVisualClauses(instruction);
  return (
    /(?:同步|一起)?(?:修改|更新|调整|替换|重做|重画|重新生成|生成|新增|增加|添加|插入|补充|删除|移除|更换|配|插|加|补).{0,12}(?:配图|插图|图片|图像|封面|(?:[一二三四五六1-6])?(?:张|幅)?图)/u.test(actionable) ||
    /(?:配图|插图|图片|图像|封面).{0,12}(?:修改|更新|调整|替换|重做|重画|重新生成|生成|新增|增加|添加|插入|补充|删除|移除|更换)/u.test(actionable)
  );
}

function hasTextRewriteRequest(instruction: string) {
  return (
    /(?:重写|改写|润色|精简|扩写|续写|调整|修改|优化|重构|删减|补充).{0,12}(?:全文|整篇|文章|正文|段落|标题|文字|文案|内容|措辞|表达|结构|语气|风格|开头|结尾)/u.test(instruction) ||
    /(?:全文|整篇|文章|正文|段落|标题|文字|文案|内容|措辞|表达|结构|语气|风格|开头|结尾).{0,12}(?:重写|改写|润色|精简|扩写|续写|调整|修改|优化|重构|删减|补充)/u.test(instruction) ||
    /(?:改得|写得|变得|更简洁|更自然|去\s*AI|降低\s*AI)/iu.test(instruction)
  );
}

function requestsImageReplacement(instruction: string) {
  const actionable = withoutNegatedVisualClauses(instruction);
  return (
    /(?:同步|修改|更新|调整|替换|重做|重画|重新生成|删除|移除|更换).{0,12}(?:配图|插图|图片|图像|封面|(?:[一二三四五六1-6])?(?:张|幅)?图)/u.test(actionable) ||
    /(?:配图|插图|图片|图像|封面|(?:[一二三四五六1-6])?(?:张|幅)?图).{0,12}(?:同步|修改|更新|调整|替换|重做|重画|重新生成|删除|移除|更换)/u.test(actionable)
  );
}

export function ArticleAssistant({
  articleId,
  selections,
  canUndo,
  onClearSelections,
  onRemoveSelection,
  onRewrite,
  onRewriteRunStarted,
  onComposeVisual,
  onApplyCandidate,
  onUndoLastRewrite,
  workflowSnapshot = null,
  workflowRunning = false,
  workflowProgress = null,
  workflowFailure = null,
  workflowRetryable = false,
  onRetryWorkflow,
  onCancelWorkflow,
  cancellingWorkflow = false,
}: ArticleAssistantProps) {
  const [open, setOpen] = useState(true);
  const [instruction, setInstruction] = useState("");
  const [working, setWorking] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [messages, setMessages] = useState<Message[]>(() => loadSession(articleId));
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [liveNote, setLiveNote] = useState("");
  const [liveProgress, setLiveProgress] = useState<number | null>(null);
  const activeRequestRef = useRef<string | null>(null);
  const activeRewriteRunIdRef = useRef<string | null>(null);
  const cancellationRequestedRef = useRef(false);
  const rewriteRunStartedCallbackRef = useRef(onRewriteRunStarted);
  const cancelWorkflowCallbackRef = useRef(onCancelWorkflow);
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
    rewriteRunStartedCallbackRef.current = onRewriteRunStarted;
  }, [onRewriteRunStarted]);

  useEffect(() => {
    cancelWorkflowCallbackRef.current = onCancelWorkflow;
  }, [onCancelWorkflow]);

  useEffect(() => {
    setMessages(loadSession(articleId));
    setInstruction("");
    setLiveStatus(null);
    setLiveNote("");
    setLiveProgress(null);
    activeRequestRef.current = null;
    activeRewriteRunIdRef.current = null;
    cancellationRequestedRef.current = false;
    streamedMarkupRef.current = "";
    streamedNoteRef.current = "";
    typewriterQueueRef.current = "";
  }, [articleId]);

  useEffect(() => {
    saveSession(articleId, messages);
  }, [articleId, messages]);

  useEffect(() => {
    if (selections.length) setOpen(true);
  }, [selections.length]);

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
      if (event.eventType === "started") {
        if (event.runId) {
          activeRewriteRunIdRef.current = event.runId;
          rewriteRunStartedCallbackRef.current?.(event.articleId, event.requestId, event.runId);
          if (cancellationRequestedRef.current) {
            cancelWorkflowCallbackRef.current?.();
          }
        }
        setLiveStatus(event.detail || "AI 正在读取文章与已选片段");
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

  const activeSelections = selections;
  const scopeLabel = activeSelections.length
    ? `${activeSelections.length} 个选中文本片段`
    : "整篇文章";
  const activeWorkflowSnapshot = workflowSnapshot ?? (
    workflowProgress || workflowFailure
      ? {
          runId: null,
          status: workflowFailure ? "failed" : "running",
          events: [],
          artifacts: [],
          visualPlan: null,
          error: workflowFailure?.detail ?? null,
          updatedAt: Date.now(),
        } satisfies WorkflowWorkspaceSnapshot
      : null
  );
  const workflowActive = workflowRunning && activeWorkflowSnapshot?.status === "running";
  const workflowEvents = compactWorkflowEvents(activeWorkflowSnapshot?.events ?? []);
  const workflowRecordEvents = workflowActive && workflowProgress
    ? workflowEvents.filter((event, index) => (
        index !== workflowEvents.length - 1 || workflowEventState(event) !== "running"
      ))
    : workflowEvents;
  const workflowCompleted = !workflowActive && activeWorkflowSnapshot?.status === "completed";
  const showWorkflow = workflowActive || workflowCompleted || Boolean(workflowFailure);

  const submit = async (nextInstruction = instruction) => {
    const normalized = nextInstruction.trim();
    if (!normalized || working || undoing) return;
    const visualRequested = hasExplicitVisualRequest(normalized);
    const visualOnly = visualRequested && !hasTextRewriteRequest(normalized);
    const requestId = `rewrite-${crypto.randomUUID?.() ?? Date.now()}`;
    activeRequestRef.current = requestId;
    activeRewriteRunIdRef.current = null;
    cancellationRequestedRef.current = false;
    streamedMarkupRef.current = "";
    streamedNoteRef.current = "";
    typewriterQueueRef.current = "";
    setLiveNote("");
    setLiveProgress(null);
    setLiveStatus(visualOnly ? "视觉 Agent 正在读取文章结构" : "AI 正在读取文章与已选片段");
    setWorking(true);
    addMessage("user", `${scopeLabel}：${normalized}`);
    try {
      if (visualOnly) {
        const conversation = messages.slice(-12).map(({ role, text }) => ({ role, text }));
        const targetSelections = activeSelections.length > 0 ? activeSelections : undefined;
        const onVisualActivity = (activity: AssistantActivity) => {
          setLiveStatus(activity.detail || activity.title);
          setLiveProgress(activity.value);
        };
        const result = requestsImageReplacement(normalized)
          ? await onComposeVisual(
              normalized,
              conversation,
              onVisualActivity,
              undefined,
              undefined,
              true,
            )
          : await onComposeVisual(
              normalized,
              conversation,
              onVisualActivity,
              undefined,
              undefined,
              false,
              targetSelections,
            );
        addMessage("assistant", result.summary);
        setInstruction("");
        // Selection ranges are anchored to the revision that was just replaced.
        // Keeping them would make a subsequent operation target stale text.
        targetSelections?.forEach((selection) => onRemoveSelection(selection));
        return;
      }
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
        source: result.source,
      };
      const applied = await onApplyCandidate(candidate);
      addMessage(
        "assistant",
        `${result.summary}\n\n已同步修改正文，可使用“撤销上次 AI 修改”恢复。`,
      );
      if (visualRequested || result.visualRefreshRecommended) {
        try {
          const visualResult = await onComposeVisual(
            visualRequested
              ? normalized
              : "全文变化较大，请根据修改后的文章重新规划并更新现有正文配图。",
            messages.slice(-12).map(({ role, text }) => ({ role, text })),
            (activity) => {
              setLiveStatus(activity.detail || activity.title);
              setLiveProgress(activity.value);
            },
            applied.markdown,
            applied.revisionId,
            true,
          );
          addMessage("assistant", visualResult.summary);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          addMessage(
            "assistant",
            `正文修改已经保存，但同步更新配图失败：${detail.slice(0, 180)}。可以稍后单独重试配图。`,
          );
        }
      }
      setInstruction("");
      activeSelections.forEach(onRemoveSelection);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      addMessage("assistant", `修改失败：${detail.slice(0, 180)}`);
    } finally {
      activeRequestRef.current = null;
      activeRewriteRunIdRef.current = null;
      cancellationRequestedRef.current = false;
      setWorking(false);
      setLiveStatus(null);
      setLiveProgress(null);
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

  const stopCurrentRequest = () => {
    if (!working && !workflowActive) return;
    cancellationRequestedRef.current = true;
    setLiveStatus(activeRewriteRunIdRef.current
      ? "正在停止当前 AI 请求"
      : "正在等待改写任务启动后停止");
    onCancelWorkflow?.();
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
        <span className="article-assistant__icon"><Bot size={17} /></span>
        <span className="article-assistant__toggle-copy">
          <strong>AI 修改</strong>
        </span>
        {open ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>

      {open && (
        <div className={`article-assistant__content${selections.length > 0 ? " has-selections" : ""}`}>
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
            {messages.length === 0 && !working && !showWorkflow && (
              <div className="article-assistant__empty">
                <Bot size={17} />
                <p>还没有修改记录</p>
              </div>
            )}
            {messages.map((message) => (
              <p className={`article-assistant__message is-${message.role}`} key={message.id}>
                {message.text}
              </p>
            ))}
            {showWorkflow && (
              <section
                className="article-assistant__workflow"
                aria-label="本次创作记录"
                role={workflowActive ? "status" : undefined}
              >
                {workflowActive && (
                  <ol className="article-assistant__workflow-events">
                    {workflowRecordEvents.map((event) => {
                      const Icon = workflowEventIcon(event);
                      const state = workflowEventState(event);
                      return (
                        <li className={`is-${state}`} key={event.id}>
                          <Icon aria-hidden="true" className={state === "running" ? "spin" : undefined} size={14} />
                          <span>{workflowEventLabel(event)}</span>
                        </li>
                      );
                    })}
                    {workflowProgress && (
                      <li className="is-running is-current">
                        <LoaderCircle aria-hidden="true" className="spin" size={14} />
                        <span>{visibleProgressLabel(workflowProgress.title)}</span>
                        {workflowProgress.value !== null && (
                          <span className="article-assistant__progress" aria-label={`进度 ${workflowProgress.value}%`}>
                            <i style={{ width: `${Math.max(3, workflowProgress.value)}%` }} />
                          </span>
                        )}
                      </li>
                    )}
                    {workflowEvents.length === 0 && !workflowProgress && (
                      <li className="is-running is-current">
                        <LoaderCircle aria-hidden="true" className="spin" size={14} />
                        <span>正在准备本次创作</span>
                      </li>
                    )}
                  </ol>
                )}
                {workflowCompleted && workflowEvents.length > 0 && (
                  <details className="article-assistant__process-details">
                    <summary>
                      <ChevronRight aria-hidden="true" size={13} />
                      <span>创作过程</span>
                      <small>{workflowProcessSummary(workflowEvents)}</small>
                    </summary>
                    <ol className="article-assistant__workflow-events">
                      {workflowEvents.map((event) => {
                        const Icon = workflowEventIcon(event);
                        const state = workflowEventState(event);
                        return (
                          <li className={`is-${state}`} key={event.id}>
                            <Icon aria-hidden="true" size={14} />
                            <span>{workflowEventLabel(event)}</span>
                          </li>
                        );
                      })}
                    </ol>
                  </details>
                )}
                {workflowFailure && (
                  <div className="article-assistant__workflow-error" role="alert">
                    <div><AlertCircle aria-hidden="true" size={14} /><strong>本次工作流未完成</strong></div>
                    <p>{workflowFailure.detail}</p>
                    {workflowFailure.logs.length > 0 && (
                      <details>
                        <summary>查看执行记录</summary>
                        <ol>{workflowFailure.logs.slice(-5).map((entry) => <li key={entry.id}>{entry.message}</li>)}</ol>
                      </details>
                    )}
                    {workflowRetryable && onRetryWorkflow && (
                      <button className="text-button" onClick={onRetryWorkflow} type="button">重试这次工作流</button>
                    )}
                  </div>
                )}
              </section>
            )}
            {(working || liveNote) && (
              <section className="article-assistant__live-activity" role="status">
                <div>
                  {working ? <LoaderCircle aria-hidden="true" className="spin" size={14} /> : <Check aria-hidden="true" size={14} />}
                  <span>{visibleProgressLabel(working ? liveStatus || "正在修改文章" : "已完成修改")}</span>
                </div>
                {liveNote && <p>{liveNote}</p>}
                {liveProgress !== null && (
                  <span className="article-assistant__progress" aria-label={`进度 ${liveProgress}%`}>
                    <i style={{ width: `${Math.max(3, liveProgress)}%` }} />
                  </span>
                )}
              </section>
            )}
          </div>

          <div className="article-assistant__composer">
            <div className="article-assistant__composer-box">
              <label>
                <span className="visually-hidden">对文章的修改要求</span>
                <textarea
                  disabled={working || undoing || workflowActive}
                  onChange={(event) => setInstruction(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submit();
                    }
                  }}
                  placeholder={activeSelections.length ? "说明如何修改这些片段" : "说说你想怎么改"}
                  value={instruction}
                />
              </label>
              <div className="article-assistant__composer-tools">
                <span>{scopeLabel}</span>
                <div>
                  <button
                    aria-label="撤销上次 AI 修改"
                    className="article-assistant__undo"
                    disabled={!canUndo || working || undoing}
                    onClick={() => void undo()}
                    title="撤销上次 AI 修改"
                    type="button"
                  >
                    {undoing ? <LoaderCircle className="spin" size={15} /> : <RotateCcw size={15} />}
                  </button>
                  <button
                    aria-label={workflowActive || working ? "停止生成" : "应用 AI 修改"}
                    className="article-assistant__send"
                    disabled={workflowActive || working ? cancellingWorkflow : !instruction.trim() || undoing}
                    onClick={() => {
                      if (workflowActive || working) stopCurrentRequest();
                      else void submit();
                    }}
                    title={workflowActive || working ? "停止生成" : "发送修改要求"}
                    type="button"
                  >
                    {workflowActive || working
                      ? (cancellingWorkflow ? <LoaderCircle className="spin" size={16} /> : <Square size={13} fill="currentColor" />)
                      : <SendHorizontal size={16} />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
