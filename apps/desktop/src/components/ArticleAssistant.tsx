import {
  AlertCircle,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  Image,
  ImagePlus,
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
  type ModelProfileSummary,
  type RewriteArticleSummary,
  type RewriteConversationMessage,
} from "../lib/desktopBridge";
import type { WorkflowWorkspaceSnapshot } from "./WorkflowWorkspace";
import type { PromptImageInput } from "./CreatePage";
import {
  MAX_PROMPT_IMAGE_ATTACHMENTS,
  type PromptImageIntent,
} from "../lib/imageAttachments";
import { mediaAssetIdFromReference } from "../lib/mediaReferences";
import type { MediaAsset } from "../types";

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
  visualMatchScore?: number;
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

interface VisualRefreshSuggestion {
  matchScore: number;
  markdown: string;
  revisionId: string;
}

interface ArticleAssistantProps {
  articleId: string;
  /** The same saved model profiles used by the creation composer. */
  modelProfiles?: readonly ModelProfileSummary[];
  activeModelProfileId?: string | null;
  switchingModel?: boolean;
  onActivateModelProfile?: (profileId: string) => void;
  selections: MarkdownSelection[];
  canUndo: boolean;
  onClearSelections: () => void;
  onRemoveSelection: (selection: MarkdownSelection) => void;
  onRewrite: (
    instruction: string,
    selections: MarkdownSelection[],
    conversation: RewriteConversationMessage[],
    requestId: string,
    attachments?: PromptImageInput[],
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
    attachments?: PromptImageInput[],
  ) => Promise<{ summary: string }>;
  /** Adds pasted/dropped files to the shared local media library. */
  onImportPromptImages?: (files: File[]) => Promise<MediaAsset[]>;
  /** Existing assets can be dragged into the assistant without copying image bytes. */
  mediaAssets?: readonly MediaAsset[];
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
        text: candidate.text.slice(0, 100_000),
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

function requestsWholeArticleScope(instruction: string) {
  if (/(?:不要|不需要|无需|别)(?:再)?[^，。；;\n]{0,8}(?:整篇文章|整篇正文|全文|通篇)/u.test(instruction)) {
    return false;
  }
  return /(?:整篇文章|整篇正文|全文|通篇|全部正文|所有正文|从头(?:到尾)?(?:重写|改写|修改))/u.test(instruction);
}

function requestsImageReplacement(instruction: string) {
  const actionable = withoutNegatedVisualClauses(instruction);
  return (
    /(?:同步|修改|更新|调整|替换|重做|重画|重新生成|删除|移除|更换).{0,12}(?:配图|插图|图片|图像|封面|(?:[一二三四五六1-6])?(?:张|幅)?图)/u.test(actionable) ||
    /(?:配图|插图|图片|图像|封面|(?:[一二三四五六1-6])?(?:张|幅)?图).{0,12}(?:同步|修改|更新|调整|替换|重做|重画|重新生成|删除|移除|更换)/u.test(actionable)
  );
}

function defaultInstructionForAttachments(attachments: readonly PromptImageInput[]) {
  if (attachments.some((attachment) => attachment.intent === "insert")) {
    return "请将附加图片按文章结构插入最合适的正文位置。";
  }
  if (attachments.some((attachment) => attachment.intent === "analyze")) {
    return "请识别附加图片的内容，并结合当前文章给出合适的修改建议。";
  }
  if (attachments.some((attachment) => attachment.intent === "material")) {
    return "请将附加图片作为本次文章修改的素材参考。";
  }
  return "请根据附加图片和当前文章判断最合适的处理方式。";
}

function imageFilesFromClipboard(clipboard: DataTransfer) {
  const directFiles = Array.from(clipboard.files).filter((file) => file.type.startsWith("image/"));
  if (directFiles.length > 0) return directFiles;
  return Array.from(clipboard.items ?? []).flatMap((item) => {
    if (item.kind !== "file" || !item.type.startsWith("image/")) return [];
    const file = item.getAsFile();
    return file ? [file] : [];
  });
}

export function ArticleAssistant({
  articleId,
  modelProfiles = [],
  activeModelProfileId = null,
  switchingModel = false,
  onActivateModelProfile,
  selections,
  canUndo,
  onClearSelections,
  onRemoveSelection,
  onRewrite,
  onRewriteRunStarted,
  onComposeVisual,
  onImportPromptImages,
  mediaAssets = [],
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
  const [attachments, setAttachments] = useState<PromptImageInput[]>([]);
  const [attachmentImporting, setAttachmentImporting] = useState(false);
  const [attachmentDropActive, setAttachmentDropActive] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [visualRefreshSuggestion, setVisualRefreshSuggestion] =
    useState<VisualRefreshSuggestion | null>(null);
  const activeRequestRef = useRef<string | null>(null);
  const activeRewriteRunIdRef = useRef<string | null>(null);
  const cancellationRequestedRef = useRef(false);
  const rewriteRunStartedCallbackRef = useRef(onRewriteRunStarted);
  const cancelWorkflowCallbackRef = useRef(onCancelWorkflow);
  const streamedMarkupRef = useRef("");
  const streamedNoteRef = useRef("");
  const typewriterQueueRef = useRef("");
  const typewriterFrameRef = useRef<number | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

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
    setAttachments([]);
    setAttachmentError(null);
    setAttachmentDropActive(false);
    setVisualRefreshSuggestion(null);
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
  const activeModelProfile = modelProfiles.find((profile) => profile.id === activeModelProfileId)
    ?? modelProfiles.find((profile) => profile.active)
    ?? null;
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

  const addAttachmentAssets = (assets: readonly MediaAsset[]) => {
    const currentIds = new Set(attachments.map((attachment) => attachment.assetId));
    const incoming = assets.filter((asset) => !currentIds.has(asset.id));
    if (attachments.length + incoming.length > MAX_PROMPT_IMAGE_ATTACHMENTS) {
      setAttachmentError(`一次最多附加 ${MAX_PROMPT_IMAGE_ATTACHMENTS} 张图片，已保留最先添加的图片。`);
    }
    setAttachments((current) => {
      const known = new Set(current.map((attachment) => attachment.assetId));
      return [
        ...current,
        ...assets
          .filter((asset) => !known.has(asset.id))
          .slice(0, Math.max(0, MAX_PROMPT_IMAGE_ATTACHMENTS - current.length))
          .map((asset) => ({ assetId: asset.id, intent: "auto" as const, asset })),
      ].slice(0, MAX_PROMPT_IMAGE_ATTACHMENTS);
    });
  };

  const importAttachments = async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) {
      setAttachmentError("只能粘贴、拖入或选择图片文件。");
      return;
    }
    if (!onImportPromptImages) {
      setAttachmentError("图片导入服务尚未连接。");
      return;
    }
    setAttachmentImporting(true);
    setAttachmentError(null);
    try {
      const assets = await onImportPromptImages(images);
      addAttachmentAssets(assets);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "导入图片失败，请重试。");
    } finally {
      setAttachmentImporting(false);
    }
  };

  const updateAttachmentIntent = (assetId: string, intent: PromptImageIntent) => {
    setAttachments((current) => current.map((attachment) => (
      attachment.assetId === assetId ? { ...attachment, intent } : attachment
    )));
  };

  const submit = async (nextInstruction = instruction) => {
    const userInstruction = nextInstruction.trim();
    const normalized = userInstruction || (attachments.length > 0 ? defaultInstructionForAttachments(attachments) : "");
    if (!normalized || working || undoing || attachmentImporting || workflowActive || cancellingWorkflow) return;
    // A material/analyze attachment is input to the text model, not an
    // instruction to insert a picture. Only an explicit user visual command
    // or the dedicated "insert" attachment intent starts the visual Agent.
    const visualRequested = attachments.some((attachment) => attachment.intent === "insert") ||
      Boolean(userInstruction) && hasExplicitVisualRequest(normalized);
    const visualOnly = visualRequested && !hasTextRewriteRequest(normalized);
    const wholeArticleRequested = requestsWholeArticleScope(normalized);
    const effectiveSelections = wholeArticleRequested ? [] : activeSelections;
    const effectiveScopeLabel = effectiveSelections.length
      ? `${effectiveSelections.length} 个选中文本片段`
      : "整篇文章";
    const requestId = `rewrite-${crypto.randomUUID?.() ?? Date.now()}`;
    activeRequestRef.current = requestId;
    activeRewriteRunIdRef.current = null;
    cancellationRequestedRef.current = false;
    streamedMarkupRef.current = "";
    streamedNoteRef.current = "";
    typewriterQueueRef.current = "";
    setLiveNote("");
    setLiveProgress(null);
    setVisualRefreshSuggestion(null);
    setLiveStatus(visualOnly
      ? "视觉 Agent 正在读取文章结构"
      : wholeArticleRequested ? "AI 正在读取整篇文章" : "AI 正在读取文章与已选片段");
    setWorking(true);
    addMessage("user", `${effectiveScopeLabel}：${normalized}${attachments.length ? `\n已附 ${attachments.length} 张图片` : ""}`);
    try {
      if (visualOnly) {
        const conversation = messages.slice(-12).map(({ role, text }) => ({ role, text }));
        const targetSelections = effectiveSelections.length > 0 ? effectiveSelections : undefined;
        const onVisualActivity = (activity: AssistantActivity) => {
          setLiveStatus(activity.detail || activity.title);
          setLiveProgress(activity.value);
        };
        const result = requestsImageReplacement(normalized)
          ? attachments.length > 0
            ? await onComposeVisual(
                normalized,
                conversation,
                onVisualActivity,
                undefined,
                undefined,
                true,
                undefined,
                attachments,
              )
            : await onComposeVisual(
                normalized,
                conversation,
                onVisualActivity,
                undefined,
                undefined,
                true,
              )
          : attachments.length > 0
            ? await onComposeVisual(
                normalized,
                conversation,
                onVisualActivity,
                undefined,
                undefined,
                false,
                targetSelections,
                attachments,
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
        setAttachments([]);
        // Selection ranges are anchored to the revision that was just replaced.
        // Keeping them would make a subsequent operation target stale text.
        targetSelections?.forEach((selection) => onRemoveSelection(selection));
        return;
      }
      const result = attachments.length > 0
        ? await onRewrite(
            normalized,
            effectiveSelections,
            messages.slice(-12).map(({ role, text }) => ({ role, text })),
            requestId,
            attachments,
          )
        : await onRewrite(
            normalized,
            effectiveSelections,
            messages.slice(-12).map(({ role, text }) => ({ role, text })),
            requestId,
          );
      const candidate: RewriteCandidate = {
        replacements: result.replacements,
        selections: effectiveSelections,
        model: result.model,
        summary: result.summary,
        source: result.source,
      };
      const applied = await onApplyCandidate(candidate);
      addMessage(
        "assistant",
        `${result.summary}\n\n已同步修改正文，可使用“撤销上次 AI 修改”恢复。`,
      );
      if (visualRequested) {
        try {
          const visualConversation = messages.slice(-12).map(({ role, text }) => ({ role, text }));
          const onVisualActivity = (activity: AssistantActivity) => {
            setLiveStatus(activity.detail || activity.title);
            setLiveProgress(activity.value);
          };
          const visualResult = attachments.length > 0
            ? await onComposeVisual(
                normalized,
                visualConversation,
                onVisualActivity,
                applied.markdown,
                applied.revisionId,
                true,
                undefined,
                attachments,
              )
            : await onComposeVisual(
                normalized,
                visualConversation,
                onVisualActivity,
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
      } else if (
        result.visualRefreshRecommended &&
        typeof result.visualMatchScore === "number"
      ) {
        const matchScore = Math.max(0, Math.min(100, Math.round(result.visualMatchScore)));
        setVisualRefreshSuggestion({
          matchScore,
          markdown: applied.markdown,
          revisionId: applied.revisionId,
        });
        addMessage(
          "assistant",
          `正文改动较大，现有配图与新正文的估算匹配度为 ${matchScore}%。是否根据新内容重新配图？`,
        );
      }
      setInstruction("");
      setAttachments([]);
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

  const acceptVisualRefresh = async () => {
    const suggestion = visualRefreshSuggestion;
    if (!suggestion || working || undoing || workflowActive || cancellingWorkflow) return;
    setVisualRefreshSuggestion(null);
    setWorking(true);
    setLiveStatus("视觉 Agent 正在根据新正文重新规划配图");
    setLiveProgress(null);
    addMessage("user", "重新配图");
    try {
      const visualConversation: RewriteConversationMessage[] = [
        ...messages.slice(-11).map(({ role, text }) => ({ role, text })),
        { role: "user", text: "确认根据新正文重新配图" },
      ];
      const visualResult = await onComposeVisual(
        "正文已经大幅修改，请根据新内容重新规划并更新现有正文配图。",
        visualConversation,
        (activity) => {
          setLiveStatus(activity.detail || activity.title);
          setLiveProgress(activity.value);
        },
        suggestion.markdown,
        suggestion.revisionId,
        true,
      );
      addMessage("assistant", visualResult.summary);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setVisualRefreshSuggestion(suggestion);
      addMessage("assistant", `重新配图失败：${detail.slice(0, 180)}。可以重试或保留现有配图。`);
    } finally {
      setWorking(false);
      setLiveStatus(null);
      setLiveProgress(null);
    }
  };

  const keepCurrentVisuals = () => {
    if (!visualRefreshSuggestion || working) return;
    const matchScore = visualRefreshSuggestion.matchScore;
    setVisualRefreshSuggestion(null);
    addMessage("user", "保留现有配图");
    addMessage("assistant", `已保留现有配图。本次估算匹配度为 ${matchScore}%，之后仍可随时让我重新配图。`);
  };

  const undo = async () => {
    if (!canUndo || undoing || working) return;
    setUndoing(true);
    try {
      await onUndoLastRewrite();
      setVisualRefreshSuggestion(null);
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
            {visualRefreshSuggestion && (
              <section className="article-assistant__visual-suggestion" aria-label="配图匹配度确认">
                <div>
                  <Image aria-hidden="true" size={15} />
                  <strong>配图匹配度 {visualRefreshSuggestion.matchScore}%</strong>
                </div>
                <p>正文变化较大，是否让视觉 Agent 根据新内容重新规划配图？</p>
                <div className="article-assistant__visual-suggestion-actions">
                  <button disabled={working} onClick={keepCurrentVisuals} type="button">保留原图</button>
                  <button disabled={working} onClick={() => void acceptVisualRefresh()} type="button">重新配图</button>
                </div>
              </section>
            )}
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
              {attachments.length > 0 && (
                <div aria-label="已附加提示图片" className="prompt-image-attachments prompt-image-attachments--assistant">
                  {attachments.map((attachment) => (
                    <div className="prompt-image-attachment" key={attachment.assetId}>
                      <img alt="" src={attachment.asset.src} />
                      <strong title={attachment.asset.name}>{attachment.asset.name}</strong>
                      <select
                        aria-label={`${attachment.asset.name}的处理方式`}
                        disabled={working || undoing || workflowActive}
                        onChange={(event) => updateAttachmentIntent(attachment.assetId, event.target.value as PromptImageIntent)}
                        value={attachment.intent}
                      >
                        <option value="auto">AI 自动判断</option>
                        <option value="material">作为素材</option>
                        <option value="insert">插入正文</option>
                        <option value="analyze">识别图片</option>
                      </select>
                      <button
                        aria-label={`移除图片 ${attachment.asset.name}`}
                        disabled={working || undoing || workflowActive}
                        onClick={() => setAttachments((current) => current.filter((item) => item.assetId !== attachment.assetId))}
                        title="移除图片"
                        type="button"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <label>
                <span className="visually-hidden">对文章的修改要求</span>
                <textarea
                  disabled={working || undoing || workflowActive}
                  className={attachmentDropActive ? "is-drop-target" : undefined}
                  onChange={(event) => setInstruction(event.target.value)}
                  onDragEnter={(event) => {
                    if (
                      event.dataTransfer.types.includes("Files") ||
                      event.dataTransfer.types.includes("application/x-open-publisher-markdown-image")
                    ) {
                      event.preventDefault();
                      setAttachmentDropActive(true);
                    }
                  }}
                  onDragLeave={(event) => {
                    if (event.currentTarget === event.target) setAttachmentDropActive(false);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    setAttachmentDropActive(false);
                    const markdownImage = event.dataTransfer.getData("application/x-open-publisher-markdown-image");
                    const reference = markdownImage.match(/\]\((asset:\/\/[^)\s]+)\)/)?.[1];
                    const assetId = reference ? mediaAssetIdFromReference(reference) : null;
                    const asset = assetId ? mediaAssets.find((candidate) => candidate.id === assetId) : null;
                    if (asset) {
                      setAttachmentError(null);
                      addAttachmentAssets([asset]);
                      return;
                    }
                    void importAttachments(Array.from(event.dataTransfer.files));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submit();
                    }
                  }}
                  onPaste={(event) => {
                    const images = imageFilesFromClipboard(event.clipboardData);
                    if (images.length === 0) return;
                    event.preventDefault();
                    void importAttachments(images);
                  }}
                  placeholder={activeSelections.length ? "说明如何修改这些片段" : "说说你想怎么改"}
                  value={instruction}
                />
              </label>
              <div className="article-assistant__composer-tools">
                <div className="article-assistant__composer-context">
                  <span>{scopeLabel}</span>
                  {modelProfiles.length > 0 && onActivateModelProfile && (
                    <label className="article-assistant__model-select">
                      <span className="visually-hidden">AI 修改模型</span>
                      <select
                        aria-label="AI 修改模型"
                        disabled={working || undoing || workflowActive || switchingModel}
                        onChange={(event) => onActivateModelProfile(event.target.value)}
                        title="切换 AI 修改模型"
                        value={activeModelProfile?.id ?? ""}
                      >
                        {modelProfiles.map((profile) => (
                          <option disabled={!profile.secretConfigured} key={profile.id} value={profile.id}>
                            {profile.name} · {profile.textModel}{profile.secretConfigured ? "" : "（缺少密钥）"}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <div>
                  <button
                    aria-label="添加提示图片"
                    className="article-assistant__attachment"
                    disabled={attachmentImporting || working || undoing || workflowActive}
                    onClick={() => attachmentInputRef.current?.click()}
                    title="粘贴、拖入或选择图片"
                    type="button"
                  >
                    <ImagePlus size={15} />
                  </button>
                  <input
                    accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                    aria-label="选择 AI 提示图片"
                    className="visually-hidden"
                    disabled={attachmentImporting || working || undoing || workflowActive}
                    multiple
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      event.currentTarget.value = "";
                      void importAttachments(files);
                    }}
                    ref={attachmentInputRef}
                    type="file"
                  />
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
                    disabled={workflowActive || working
                      ? cancellingWorkflow
                      : attachmentImporting || (!instruction.trim() && attachments.length === 0) || undoing}
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
              {attachmentImporting && <p className="prompt-image-importing" role="status">正在导入图片</p>}
              {attachmentError && <p className="prompt-image-error" role="alert">{attachmentError}</p>}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
