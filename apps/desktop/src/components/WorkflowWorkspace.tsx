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
  Sparkles,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  VisualCompositionPlanSummary,
  WorkflowActivityEvent,
  WorkflowArtifactSummary,
  WorkflowNodeId,
  WorkflowSourceSummary,
} from "../lib/desktopBridge";

export type WorkspaceRunStatus = "running" | "completed" | "failed";

export interface WorkflowWorkspaceSnapshot {
  runId: string | null;
  status: WorkspaceRunStatus;
  events: WorkflowActivityEvent[];
  artifacts: WorkflowArtifactSummary[];
  visualPlan: VisualCompositionPlanSummary | null;
  error?: string | null;
  updatedAt: number;
}

interface WorkflowWorkspaceProps {
  snapshot: WorkflowWorkspaceSnapshot | null;
  progress?: { title: string; detail: string; value: number | null } | null;
  retryable?: boolean;
  onRetry?: () => void;
}

type WorkspaceTab = "activity" | "sources" | "artifacts";

const nodeLabel: Record<WorkflowNodeId, string> = {
  research: "资料整理",
  outline: "大纲规划",
  draft: "正文撰写",
  "natural-style": "自然表达",
  review: "内容审阅",
  risk: "风险检查",
  visual: "配图规划",
};

const artifactLabel: Record<string, string> = {
  "workflow.research": "研究卡片",
  "workflow.web-sources": "联网来源",
  "workflow.outline": "文章大纲",
  "workflow.raw-draft": "原始正文",
  "workflow.canonical-draft": "最终正文",
  "workflow.natural-style-patch": "自然表达修改",
  "workflow.review-report": "审阅报告",
  "workflow.risk-report": "发布前检查",
  "workflow.visual-plan": "配图计划",
};

function eventLabel(event: WorkflowActivityEvent) {
  const node = event.nodeId ? nodeLabel[event.nodeId] : "工作流";
  switch (event.eventType) {
    case "run.node_started":
      return `${node}正在执行`;
    case "run.node_completed":
      return `${node}已完成`;
    case "run.node_failed":
      return `${node}未完成`;
    case "run.node_skipped":
      return `${node}已跳过`;
    case "run.node_tool_called":
      return "正在检索公开来源";
    case "run.queued":
      return "等待本地运行时启动";
    case "run.started":
      return "工作流已开始";
    case "run.completed":
      return "工作流已完成";
    case "run.failed":
      return "工作流已失败";
    default:
      return "工作流状态已更新";
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
    event.sources?.forEach((source) => sources.set(source.url, source));
  });
  return Array.from(sources.values());
}

function updatedAtLabel(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function sourceDomain(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

export function WorkflowWorkspace({ snapshot, progress = null, retryable = false, onRetry }: WorkflowWorkspaceProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<WorkspaceTab>("activity");

  useEffect(() => {
    if (snapshot?.status === "running" || snapshot?.status === "failed") setOpen(true);
  }, [snapshot?.runId, snapshot?.status]);

  const activityEvents = useMemo(
    () => (snapshot?.events ?? []).filter((event) => event.eventType !== "run.node_output_delta"),
    [snapshot?.events],
  );
  const sources = useMemo(() => uniqueSources(snapshot?.events ?? []), [snapshot?.events]);
  const streamedCharacters = useMemo(
    () => (snapshot?.events ?? []).reduce((total, event) => total + (event.draftDelta?.replace(/\s/g, "").length ?? 0), 0),
    [snapshot?.events],
  );

  if (!snapshot) return null;

  const statusLabel =
    snapshot.status === "running" ? "正在运行" : snapshot.status === "completed" ? "已完成" : "需要处理";

  return (
    <aside className={`workflow-workspace is-${snapshot.status}${open ? " is-open" : ""}`} aria-label="文章工作区">
      <button
        aria-label={open ? undefined : "展开文章工作区"}
        aria-expanded={open}
        className="workflow-workspace__toggle"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span className={`workflow-workspace__state is-${snapshot.status}`} aria-hidden="true">
          {snapshot.status === "running" ? <LoaderCircle className="spin" size={15} /> : snapshot.status === "failed" ? <AlertCircle size={15} /> : <Check size={15} />}
        </span>
        <span className="workflow-workspace__toggle-copy">
          <strong>Agent 工作流</strong>
          <small>{statusLabel} · {activityEvents.length} 项过程</small>
        </span>
        {open ? <ChevronDown aria-hidden="true" size={17} /> : <ChevronRight aria-hidden="true" size={17} />}
      </button>

      {open && (
        <div className="workflow-workspace__content">
          <div className="workflow-workspace__tabs" role="tablist" aria-label="工作区内容">
            <button aria-selected={tab === "activity"} onClick={() => setTab("activity")} role="tab" type="button">过程 <span>{activityEvents.length}</span></button>
            <button aria-selected={tab === "sources"} onClick={() => setTab("sources")} role="tab" type="button">来源 <span>{sources.length}</span></button>
            <button aria-selected={tab === "artifacts"} onClick={() => setTab("artifacts")} role="tab" type="button">产物 <span>{snapshot.artifacts.length}</span></button>
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
              {activityEvents.map((event) => {
                const Icon = eventIcon(event);
                const state = eventState(event);
                return (
                  <li className={`workflow-timeline__item is-${state}`} key={event.id}>
                    <span className="workflow-timeline__icon" aria-hidden="true"><Icon className={state === "running" ? "spin" : undefined} size={14} /></span>
                    <div>
                      <strong>{eventLabel(event)}</strong>
                      {event.eventType === "run.node_tool_called" && event.toolQuery && <small>检索：{event.toolQuery}</small>}
                      {event.eventType === "run.node_tool_called" && <small>已整理 {event.sources?.length ?? 0} 个来源</small>}
                    </div>
                    <time dateTime={event.createdAt}>{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(event.createdAt))}</time>
                  </li>
                );
              })}
              {streamedCharacters > 0 && (
                <li className={`workflow-timeline__item is-${snapshot.status === "running" ? "running" : "complete"}`}>
                  <span className="workflow-timeline__icon" aria-hidden="true"><FileText size={14} /></span>
                  <div><strong>正文正在流式写入</strong><small>已接收 {streamedCharacters.toLocaleString("zh-CN")} 字</small></div>
                </li>
              )}
              {activityEvents.length === 0 && <li className="workflow-workspace__empty">本次运行开始后，过程会显示在这里。</li>}
            </ol>
          )}

          {tab === "sources" && (
            <div className="workflow-sources">
              {sources.length === 0 ? <p className="workflow-workspace__empty">本次文章未使用联网来源。</p> : sources.map((source) => (
                <article className="workflow-source-card" key={source.url}>
                  <div><span>{sourceDomain(source.url)}</span>{source.publishedDate && <time>{source.publishedDate}</time>}</div>
                  <a href={source.url} rel="noreferrer" target="_blank">{source.title}</a>
                  <p>{source.excerpt}</p>
                </article>
              ))}
            </div>
          )}

          {tab === "artifacts" && (
            <div className="workflow-artifacts">
              {snapshot.artifacts.map((artifact) => <div className="workflow-artifact" key={artifact.id}><FileText aria-hidden="true" size={15} /><span>{artifactLabel[artifact.kind] ?? artifact.kind}</span></div>)}
              {snapshot.visualPlan && <div className="workflow-artifact"><Image aria-hidden="true" size={15} /><span>配图计划 · {snapshot.visualPlan.targetCount} 张</span></div>}
              {snapshot.artifacts.length === 0 && !snapshot.visualPlan && <p className="workflow-workspace__empty">运行完成后，研究、大纲和审阅产物会保存在这里。</p>}
            </div>
          )}

          {snapshot.status === "failed" && (
            <div className="workflow-workspace__failure" role="alert">
              <strong>本次运行未完成</strong>
              <p>{snapshot.error ?? "本地运行时未返回可展示的错误信息。"}</p>
              {retryable && onRetry && <button className="button button--quiet" onClick={onRetry} type="button">重试本次生成</button>}
            </div>
          )}
          <footer>更新于 {updatedAtLabel(snapshot.updatedAt)}</footer>
        </div>
      )}
    </aside>
  );
}
