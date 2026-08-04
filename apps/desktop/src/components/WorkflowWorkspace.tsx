import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Image,
  LoaderCircle,
  Search,
  ShieldCheck,
  Square,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  VisualCompositionPlanSummary,
  WorkflowActivityEvent,
  WorkflowActivityNodeId,
  WorkflowSourceSummary,
} from "../lib/desktopBridge";

export type WorkspaceRunStatus = "running" | "completed" | "failed";

export interface WorkflowWorkspaceSnapshot {
  runId: string | null;
  status: WorkspaceRunStatus;
  events: WorkflowActivityEvent[];
  artifacts: Array<{ id: string; kind: string }>;
  visualPlan: VisualCompositionPlanSummary | null;
  error?: string | null;
  updatedAt: number;
}

interface WorkflowWorkspaceProps {
  snapshot: WorkflowWorkspaceSnapshot | null;
  progress?: { title: string; detail: string; value: number | null } | null;
  retryable?: boolean;
  onRetry?: () => void;
  onCancel?: () => void;
  cancelling?: boolean;
  embedded?: boolean;
  failureDetail?: string;
  failureLogs?: Array<{
    id: string;
    timestamp: number;
    message: string;
    tone: "info" | "success" | "error";
  }>;
}

type WorkspaceTab = "activity" | "sources";

const nodeLabel: Record<WorkflowActivityNodeId, string> = {
  research: "资料整理",
  outline: "大纲规划",
  draft: "正文撰写",
  "natural-style": "自然表达",
  review: "内容审阅",
  "reference-safety": "资料核验",
  risk: "风险检查",
  visual: "配图规划",
};

function eventLabel(event: WorkflowActivityEvent) {
  const node = event.nodeId ? nodeLabel[event.nodeId] : "本次创作";
  switch (event.eventType) {
    case "run.node_started":
      return event.nodeId === "draft"
        ? "写作 Agent 正在撰写正文"
        : event.nodeId === "risk"
          ? "发布检查正在核对内容"
          : event.nodeId === "visual"
            ? "配图 Agent 正在规划图片"
            : `${node}正在处理`;
    case "run.node_completed":
      return event.nodeId === "draft" ? "正文初稿已完成" : `${node}已完成`;
    case "run.node_failed":
      return `${node}未完成`;
    case "run.node_skipped":
      return `${node}已跳过`;
    case "run.node_tool_called":
      return event.toolName === "github_repository"
        ? "正在读取 GitHub 项目资料"
        : "正在检索公开资料";
    case "run.node_precheck":
      return "正在检查配图设置和素材范围";
    case "run.node_outline_saved":
      return "配图大纲已保存，正在匹配素材";
    case "run.node_prompts_saved":
      return "生图提示词已保存，等待确认";
    case "run.queued":
      return "正在准备本次创作";
    case "run.started":
      return "AI 创作已开始";
    case "run.completed":
      return "文章处理已完成";
    case "run.failed":
      return "本次创作未完成";
    default:
      return "正在处理文章";
  }
}

function eventState(event: WorkflowActivityEvent): "running" | "complete" | "failed" | "muted" {
  if (event.eventType === "run.node_failed" || event.eventType === "run.failed") return "failed";
  if (
    event.eventType === "run.node_completed" ||
    event.eventType === "run.completed" ||
    event.eventType === "run.node_tool_called"
  ) {
    return "complete";
  }
  if (event.eventType === "run.node_skipped") return "muted";
  return "running";
}

function eventIcon(event: WorkflowActivityEvent) {
  if (event.eventType === "run.node_tool_called") return Search;
  if (event.eventType === "run.node_failed" || event.eventType === "run.failed") return XCircle;
  if (event.eventType === "run.node_completed" || event.eventType === "run.completed") return Check;
  if (event.nodeId === "draft") return FileText;
  if (event.nodeId === "visual") return Image;
  if (event.nodeId === "review" || event.nodeId === "risk") return ShieldCheck;
  if (event.nodeId === "research" || event.nodeId === "outline") return Sparkles;
  return LoaderCircle;
}

function uniqueSources(events: WorkflowActivityEvent[]) {
  const sources = new Map<string, WorkflowSourceSummary>();
  events.forEach((event) => {
    if (!Array.isArray(event.sources)) return;
    event.sources.forEach((source) => {
      if (!source || typeof source.url !== "string" || !source.url.trim()) return;
      sources.set(source.url, {
        sourceId: typeof source.sourceId === "string" ? source.sourceId : source.url,
        title: typeof source.title === "string" ? source.title : "未命名资料",
        url: source.url,
        excerpt: typeof source.excerpt === "string" ? source.excerpt : "",
        publishedDate: typeof source.publishedDate === "string" ? source.publishedDate : null,
      });
    });
  });
  return Array.from(sources.values());
}

function stageKey(event: WorkflowActivityEvent) {
  if (event.eventType === "run.node_tool_called") return "research";
  if (event.nodeId) return event.nodeId;
  if (event.eventType === "run.queued" || event.eventType === "run.started") return "prepare";
  return event.eventType;
}

/** Keep one clear card per user-visible stage instead of exposing raw runtime events. */
function compactActivity(events: WorkflowActivityEvent[]) {
  const stages = new Map<string, WorkflowActivityEvent>();
  for (const event of events) {
    if (!event || typeof event.id !== "string" || typeof event.eventType !== "string" || typeof event.createdAt !== "string") continue;
    if (event.eventType === "run.node_output_delta") continue;
    const key = stageKey(event);
    const current = stages.get(key);
    if (!current || event.createdAt >= current.createdAt) stages.set(key, event);
  }
  return Array.from(stages.values()).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function updatedAtLabel(value: number) {
  if (!Number.isFinite(value)) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function eventTimeLabel(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function logDateTime(value: number) {
  return Number.isFinite(value) ? new Date(value).toISOString() : undefined;
}

function sourceDomain(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

export function WorkflowWorkspace({
  snapshot,
  progress = null,
  retryable = false,
  onRetry,
  onCancel,
  cancelling = false,
  embedded = false,
  failureDetail,
  failureLogs = [],
}: WorkflowWorkspaceProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<WorkspaceTab>("activity");

  useEffect(() => {
    if (snapshot?.status === "running" || snapshot?.status === "failed") setOpen(true);
    if (snapshot?.status === "completed") setOpen(false);
  }, [snapshot?.runId, snapshot?.status]);

  const events = useMemo(
    () => Array.isArray(snapshot?.events) ? snapshot.events : [],
    [snapshot?.events],
  );
  const visibleActivityEvents = useMemo(() => compactActivity(events).slice(-6), [events]);
  const sources = useMemo(() => uniqueSources(events), [events]);
  const streamedCharacters = useMemo(
    () => events.reduce(
      (total, event) => total + (typeof event.draftDelta === "string" ? event.draftDelta.replace(/\s/g, "").length : 0),
      0,
    ),
    [events],
  );

  if (!snapshot) return null;

  const statusLabel =
    snapshot.status === "running" ? "正在创作" : snapshot.status === "completed" ? "创作完成" : "需要重试";
  const latest = progress ? null : visibleActivityEvents[visibleActivityEvents.length - 1];
  const latestLabel = progress?.title ?? (latest ? eventLabel(latest) : statusLabel);
  const latestDetail = progress?.detail ?? (
    latest?.eventType === "run.node_tool_called" && latest.toolQuery
      ? `${latest.toolName === "github_repository" ? "项目" : "查询"}：${latest.toolQuery}`
      : snapshot.status === "completed"
        ? `已完成本次文章处理 · ${updatedAtLabel(snapshot.updatedAt)}`
        : snapshot.status === "failed"
          ? "运行中断，可查看原因后重试"
          : "AI 正在处理文章内容"
  );

  if (embedded) {
    const StatusIcon = snapshot.status === "running" ? LoaderCircle : snapshot.status === "failed" ? AlertCircle : Check;

    return (
      <section
        className={`workflow-task is-${snapshot.status}${open ? " is-expanded" : ""}`}
        aria-label="当前 AI 任务"
      >
        <div className="workflow-task__summary">
          <span className={`workflow-task__state is-${snapshot.status}`} aria-hidden="true">
            <StatusIcon className={snapshot.status === "running" ? "spin" : undefined} size={15} />
          </span>
          <div className="workflow-task__copy">
            <span>当前任务</span>
            <strong>{latestLabel}</strong>
            <small title={latestDetail}>{latestDetail}</small>
          </div>
          <button
            aria-expanded={open}
            aria-label={open ? "收起任务详情" : "展开任务详情"}
            className="workflow-task__expand"
            onClick={() => setOpen((current) => !current)}
            title={open ? "收起任务详情" : "展开任务详情"}
            type="button"
          >
            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
        </div>

        {snapshot.status === "running" && progress && (
          <div className="workflow-task__progress" aria-label={progress.value === null ? "任务进行中" : `当前进度 ${progress.value}%`}>
            <span
              className={progress.value === null ? "is-indeterminate" : undefined}
              style={progress.value === null ? undefined : ({ "--progress": `${progress.value}%` } as CSSProperties)}
            />
          </div>
        )}

        {snapshot.status === "running" && onCancel && (
          <div className="workflow-task__actions">
            <button
              aria-label="停止生成"
              className="button button--quiet button--stop-workflow"
              disabled={cancelling}
              onClick={onCancel}
              type="button"
            >
              {cancelling ? <LoaderCircle className="spin" size={13} /> : <Square size={12} />}
              {cancelling ? "正在停止" : "停止"}
            </button>
          </div>
        )}

        {snapshot.status === "failed" && (
          <div className="workflow-task__failure" role="alert">
            <strong>文章生成失败</strong>
            <p>{failureDetail ?? snapshot.error ?? "本地运行时未返回可展示的错误信息。"}</p>
            {retryable && onRetry && <button className="button button--quiet" onClick={onRetry} type="button">重试本次生成</button>}
          </div>
        )}

        {open && (
          <div className="workflow-task__details">
            {visibleActivityEvents.length > 0 && (
              <ol aria-label="本次任务记录" className="workflow-task__events">
                {visibleActivityEvents.slice(-4).reverse().map((event) => {
                  const Icon = eventIcon(event);
                  const state = eventState(event);
                  return (
                    <li className={`is-${state}`} key={event.id}>
                      <Icon aria-hidden="true" className={state === "running" ? "spin" : undefined} size={13} />
                      <span>{eventLabel(event)}</span>
                      <time dateTime={event.createdAt}>{eventTimeLabel(event.createdAt)}</time>
                    </li>
                  );
                })}
              </ol>
            )}
            {streamedCharacters > 0 && !progress && (
              <p className="workflow-task__streamed"><FileText aria-hidden="true" size={13} /> 已流式写入 {streamedCharacters.toLocaleString("zh-CN")} 字</p>
            )}
            {sources.length > 0 && (
              <details className="workflow-task__sources">
                <summary>参考资料 {sources.length}</summary>
                <div>
                  {sources.map((source) => (
                    <a href={source.url} key={source.url} rel="noreferrer" target="_blank">{source.title || sourceDomain(source.url)}</a>
                  ))}
                </div>
              </details>
            )}
            {failureLogs.length > 0 && (
              <details className="workflow-task__logs">
                <summary>执行日志 {failureLogs.length}</summary>
                <ol>
                  {failureLogs.slice(-6).reverse().map((entry) => (
                    <li className={`is-${entry.tone}`} key={entry.id}>{entry.message}</li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        )}
      </section>
    );
  }

  return (
    <aside
      className={`workflow-workspace is-${snapshot.status}${open ? " is-open" : ""}${embedded ? " is-embedded" : ""}`}
      aria-label="AI 创作动态"
    >
      <button
        aria-label={open ? undefined : "展开 AI 创作动态"}
        aria-expanded={open}
        className="workflow-workspace__toggle"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className={`workflow-workspace__state is-${snapshot.status}`} aria-hidden="true">
          {snapshot.status === "running" ? <LoaderCircle className="spin" size={15} /> : snapshot.status === "failed" ? <AlertCircle size={15} /> : <Check size={15} />}
        </span>
        <span className="workflow-workspace__toggle-copy">
          <strong>AI 创作动态</strong>
          <small>{latest ? eventLabel(latest) : statusLabel}</small>
        </span>
        {open ? <ChevronDown aria-hidden="true" size={17} /> : <ChevronRight aria-hidden="true" size={17} />}
      </button>

      {open && (
        <div className="workflow-workspace__content">
          <div className="workflow-workspace__tabs" role="tablist" aria-label="创作动态内容">
            <button aria-selected={tab === "activity"} onClick={() => setTab("activity")} role="tab" type="button">创作进度 <span>{visibleActivityEvents.length}</span></button>
            {sources.length > 0 && <button aria-selected={tab === "sources"} onClick={() => setTab("sources")} role="tab" type="button">参考资料 <span>{sources.length}</span></button>}
          </div>

          {tab === "activity" && (
            <ol className="workflow-timeline" aria-label="本次运行过程">
              {progress && (
                <li className="workflow-timeline__item is-running">
                  <span className="workflow-timeline__icon" aria-hidden="true"><LoaderCircle className="spin" size={14} /></span>
                  <div>
                    <strong>{progress.title}</strong>
                    <small>{progress.detail}</small>
                    {progress.value !== null && <span className="workflow-timeline__progress" style={{ "--progress": `${progress.value}%` } as CSSProperties} />}
                  </div>
                </li>
              )}
              {visibleActivityEvents.map((event) => {
                const Icon = eventIcon(event);
                const state = eventState(event);
                return (
                  <li className={`workflow-timeline__item is-${state}`} key={event.id}>
                    <span className="workflow-timeline__icon" aria-hidden="true"><Icon className={state === "running" ? "spin" : undefined} size={14} /></span>
                    <div>
                      <strong>{eventLabel(event)}</strong>
                      {event.eventType === "run.node_tool_called" && event.toolQuery && <small>{event.toolName === "github_repository" ? "项目：" : "查询："}{event.toolQuery}</small>}
                      {event.eventType === "run.node_tool_called" && <small>已整理 {event.sources?.length ?? 0} 条可引用资料</small>}
                    </div>
                    <time dateTime={event.createdAt}>{eventTimeLabel(event.createdAt)}</time>
                  </li>
                );
              })}
              {streamedCharacters > 0 && (
                <li className={`workflow-timeline__item is-${snapshot.status === "running" ? "running" : "complete"}`}>
                  <span className="workflow-timeline__icon" aria-hidden="true"><FileText size={14} /></span>
                  <div><strong>正文正在流式写入</strong><small>已接收 {streamedCharacters.toLocaleString("zh-CN")} 字</small></div>
                </li>
              )}
              {visibleActivityEvents.length === 0 && <li className="workflow-workspace__empty">开始创作后，这里会显示当前 AI 正在完成的步骤。</li>}
            </ol>
          )}

          {tab === "sources" && (
            <div className="workflow-sources">
              {sources.map((source) => (
                <article className="workflow-source-card" key={source.url}>
                  <div><span>{sourceDomain(source.url)}</span>{source.publishedDate && <time>{source.publishedDate}</time>}</div>
                  <a href={source.url} rel="noreferrer" target="_blank">{source.title}</a>
                  <p>{source.excerpt}</p>
                </article>
              ))}
            </div>
          )}


          {snapshot.status === "failed" && (
            <div className="workflow-workspace__failure" role="alert">
              <strong>文章生成失败</strong>
              <p>{failureDetail ?? snapshot.error ?? "本地运行时未返回可展示的错误信息。"}</p>
              {retryable && onRetry && <button className="button button--quiet" onClick={onRetry} type="button">重试本次生成</button>}
              {failureLogs.length > 0 && (
                <details className="workflow-workspace__logs" open>
                  <summary>查看执行日志</summary>
                  <ol>
                    {failureLogs.slice(-8).map((entry) => (
                      <li className={`is-${entry.tone}`} key={entry.id}>
                        <time dateTime={logDateTime(entry.timestamp)}>
                          {Number.isFinite(entry.timestamp)
                            ? new Intl.DateTimeFormat("zh-CN", {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              }).format(entry.timestamp)
                            : "刚刚"}
                        </time>
                        <span>{entry.message}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </div>
          )}
          {snapshot.status === "running" && onCancel && (
            <div className="workflow-workspace__controls">
              <button
                className="button button--quiet button--stop-workflow"
                disabled={cancelling}
                onClick={onCancel}
                type="button"
              >
                {cancelling ? <LoaderCircle className="spin" size={14} /> : <Square size={13} />}
                {cancelling ? "正在停止" : "停止生成"}
              </button>
            </div>
          )}
          <footer>最后更新于 {updatedAtLabel(snapshot.updatedAt)}</footer>
        </div>
      )}
    </aside>
  );
}
