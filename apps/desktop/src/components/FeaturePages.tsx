import {
  AlertCircle,
  ArrowRight,
  Blocks,
  Bot,
  Check,
  CheckCircle2,
  Clock3,
  Cloud,
  Database,
  Eye,
  FileCheck2,
  FileText,
  ImagePlus,
  KeyRound,
  Link2,
  LockKeyhole,
  MoreHorizontal,
  Paintbrush,
  Play,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  UserCheck,
  Workflow,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MarkdownPreview } from "./MarkdownPreview";
import type {
  ConnectionProfilePublic,
  ConnectionProvider,
  CreateConnectionProfileRequest,
  PublishPlanSummary,
  PublishReceiptSummary,
  RunWorkflowSummary,
} from "../lib/desktopBridge";
import type {
  Article,
  PlatformDefinition,
  PlatformId,
  TaskRecord,
  WorkflowStage,
} from "../types";

interface PageHeadProps {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}

function PageHead({ eyebrow, title, description, action }: PageHeadProps) {
  return (
    <header className="page-head">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}

export function ArticlesPage({
  articles,
  selectedId,
  onOpen,
  onCreate,
}: {
  articles: Article[];
  selectedId: string;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <section className="feature-page">
      <PageHead
        eyebrow="LIBRARY / 文章库"
        title="稿件不是文件，是一条修订历史"
        description="Markdown 正本保留在本地；平台版本从指定修订生成。"
        action={<button className="button button--jade" onClick={onCreate} type="button"><Plus size={16} />新建文章</button>}
      />
      <div className="library-filter">
        <div className="segmented">
          <button className="is-active" type="button">全部 <span>{articles.length}</span></button>
          <button type="button">草稿</button>
          <button type="button">待审核</button>
          <button type="button">可发布</button>
        </div>
        <button className="button button--quiet" type="button">按更新时间</button>
      </div>
      <div className="article-library">
        {articles.map((article) => (
          <article className={`article-row${selectedId === article.id ? " is-selected" : ""}`} key={article.id}>
            <div className="article-row__glyph"><FileText size={19} /></div>
            <div className="article-row__copy">
              <div>
                <span className={`status-tag status-tag--${article.status}`}>
                  {article.status === "draft" ? "草稿" : article.status === "review" ? "待审核" : "可发布"}
                </span>
                <small>{article.collection}</small>
              </div>
              <h2>{article.title}</h2>
              <p>{article.deck}</p>
            </div>
            <div className="article-row__meta">
              <strong>{article.wordCount}</strong><small>字</small>
              <span>{article.updatedAt}</span>
              <button className="button button--quiet" onClick={() => onOpen(article.id)} type="button">
                打开稿件 <ArrowRight size={14} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function WorkflowPage({
  stages,
  disabledStages,
  onToggleStage,
  onRun,
  running,
  lastRun,
}: {
  stages: WorkflowStage[];
  disabledStages: Set<string>;
  onToggleStage: (id: string) => void;
  onRun: () => void;
  running: boolean;
  lastRun: RunWorkflowSummary | null;
}) {
  const icons = [Cloud, Sparkles, Bot, Paintbrush, ShieldCheck, UserCheck, Send];
  return (
    <section className="feature-page">
      <PageHead
        eyebrow="ORCHESTRATION / 工作流"
        title="让每个 Agent 只负责一件事"
        description="可以跳过非关键节点；发布关卡始终由确定性服务执行。"
        action={
          <button className="button button--jade" disabled={running} onClick={onRun} type="button">
            {running ? <span className="spinner" /> : <Play size={15} />}
            {running ? "正在运行" : "从头运行"}
          </button>
        }
      />
      <div className="workflow-board">
        <div className="workflow-board__legend">
          <span><i className="dot dot--jade" />必经节点</span>
          <span><i className="dot dot--amber" />可选节点</span>
          <span>拖拽编排将在下一迭代开放</span>
        </div>
        <div className="workflow-lane">
          {stages.map((stage, index) => {
            const Icon = icons[index];
            const disabled = disabledStages.has(stage.id);
            return (
              <div className="workflow-node-wrap" key={stage.id}>
                <article className={`workflow-node${disabled ? " is-disabled" : ""}${stage.optional ? " is-optional" : ""}`}>
                  <div className="workflow-node__head">
                    <span><Icon size={17} /></span>
                    <label className="node-toggle">
                      <input
                        aria-label={`${stage.label}${stage.optional ? "可选节点" : "必经节点"}`}
                        checked={!disabled}
                        disabled={!stage.optional}
                        onChange={() => onToggleStage(stage.id)}
                        type="checkbox"
                      />
                      <i />
                    </label>
                  </div>
                  <small>{stage.agent}</small>
                  <strong>{stage.label}</strong>
                  <p>
                    {index === 0 && "整理来源与事实卡"}
                    {index === 1 && "确定受众、观点与顺序"}
                    {index === 2 && "生成结构化 Markdown 修订"}
                    {index === 3 && "保留事实与结构，减少模板化表达"}
                    {index === 4 && "检查结构、事实与可读性"}
                    {index === 5 && "敏感词、事实与承诺检查"}
                    {index === 6 && "生成封面与正文配图规划"}
                  </p>
                  {stage.optional && <span className="optional-tag">可跳过</span>}
                </article>
                {index < stages.length - 1 && <span className="workflow-arrow"><ArrowRight size={16} /></span>}
              </div>
            );
          })}
        </div>
      </div>
      {lastRun && (
        <section className="workflow-run-result" aria-label="最近一次工作流结果">
          <header>
            <div>
              <span className="eyebrow">PERSISTED RUN</span>
              <h2>修订 {lastRun.outputRevisionNumber} 已写入本地数据库</h2>
            </div>
            <span className="status-tag status-tag--ready">
              <CheckCircle2 size={13} />{lastRun.status}
            </span>
          </header>
          <div className="workflow-run-meta">
            <span><strong>{lastRun.workflowName}</strong><small>v{lastRun.workflowVersion}</small></span>
            <span><strong>{lastRun.artifacts.length}</strong><small>Artifact</small></span>
            <span><strong>{lastRun.runId.slice(0, 8)}</strong><small>Run ID</small></span>
          </div>
          <div className="workflow-artifact-list">
            {lastRun.artifacts.map((artifact) => (
              <span key={`${artifact.kind}-${artifact.id}`}>
                <Database size={13} />
                {artifact.kind.replace("workflow.", "")}
                <code>{artifact.id.slice(0, 8)}</code>
              </span>
            ))}
          </div>
        </section>
      )}
      <div className="workflow-notes">
        <article>
          <Database size={18} />
          <div><strong>不可变快照</strong><p>运行开始后固定稿件、配置与 Skill 版本，编辑器修改进入下一次运行。</p></div>
        </article>
        <article>
          <FileCheck2 size={18} />
          <div><strong>结构化交付</strong><p>Agent 只能返回修订建议、证据或风险，不可静默改写正本。</p></div>
        </article>
        <article>
          <LockKeyhole size={18} />
          <div><strong>确定性发布</strong><p>外部写入必须进入 Outbox，携带幂等键并保留每次尝试。</p></div>
        </article>
      </div>
    </section>
  );
}

const artStyles = ["porcelain", "jade", "ink", "cinnabar"];

export function AssetsPage({
  generatedCount,
  generating,
  onGenerate,
}: {
  generatedCount: number;
  generating: boolean;
  onGenerate: () => Promise<void>;
}) {
  const total = 4 + generatedCount;
  return (
    <section className="feature-page">
      <PageHead
        eyebrow="ASSETS / 素材库"
        title="配图也要知道自己从哪里来"
        description="每项素材保存提示词、模型、比例、授权与关联稿件。"
        action={
          <button
            className="button button--jade"
            disabled={generating}
            onClick={() => void onGenerate()}
            type="button"
          >
            {generating ? <span className="spinner" /> : <ImagePlus size={16} />}
            {generating ? "正在生成" : "生成配图"}
          </button>
        }
      />
      <div className="asset-tools">
        <div className="segmented"><button className="is-active" type="button">全部 {total}</button><button type="button">封面</button><button type="button">正文配图</button></div>
        <button className="button button--quiet" type="button"><UploadCloud size={15} />导入本地素材</button>
      </div>
      <div className="asset-grid">
        {Array.from({ length: total }, (_, index) => (
          <article className="asset-card" key={index}>
            <div className={`asset-art asset-art--${artStyles[index % artStyles.length]}`}>
              <span className="asset-art__index">{String(index + 1).padStart(2, "0")}</span>
              <div className="asset-art__copy">
                <small>{index % 2 ? "ARTICLE VISUAL" : "SOCIAL COVER"}</small>
                <strong>{index === total - 1 && generatedCount ? "已存入本地 Artifact" : ["本地优先", "Agent 协作", "证据先行", "一稿多发"][index % 4]}</strong>
              </div>
              <span className="asset-art__seal">稿</span>
            </div>
            <div className="asset-card__meta">
              <div><strong>{index % 2 ? "正文配图" : "横版封面"}</strong><small>{index % 2 ? "3:2 · 1600×1067" : "2.35:1 · 900×383"}</small></div>
              <button aria-label="素材更多操作" type="button"><MoreHorizontal size={16} /></button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

type PublishPageAction = "prepare" | "approve" | "enqueue" | "process" | "refresh" | null;

const publishJobLabels: Record<PublishPlanSummary["jobs"][number]["state"], string> = {
  pending: "等待执行",
  in_progress: "正在执行",
  succeeded: "演练完成",
  failed_retryable: "可重试",
  failed_terminal: "已阻断",
  unknown: "结果未知",
  reconciling: "正在核验",
  cancelled: "已取消",
};

const shortCode = (value: string) =>
  value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;

export function PublishPage({
  platforms,
  articleTitle,
  revisionId,
  selectedTargets,
  plan,
  receipts,
  idempotencyVerified,
  action,
  error,
  stale,
  onToggleTarget,
  onPrepare,
  onApprove,
  onEnqueue,
  onProcess,
  onRefresh,
  onReset,
}: {
  platforms: PlatformDefinition[];
  articleTitle: string;
  revisionId: string | null;
  selectedTargets: Set<PlatformId>;
  plan: PublishPlanSummary | null;
  receipts: PublishReceiptSummary[];
  idempotencyVerified: boolean;
  action: PublishPageAction;
  error: string | null;
  stale: boolean;
  onToggleTarget: (platform: PlatformId) => void;
  onPrepare: () => void;
  onApprove: () => void;
  onEnqueue: () => void;
  onProcess: () => void;
  onRefresh: () => void;
  onReset: () => void;
}) {
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);
  useEffect(() => setApprovalConfirmed(false), [plan?.planId]);

  const busy = action !== null;
  const approved = plan?.approvalStatus === "approved";
  const jobsReady = Boolean(plan?.jobs.length);
  const completed = plan?.status === "completed";
  const processable = Boolean(
    plan?.jobs.some(
      (job) => job.state === "pending" || job.state === "failed_retryable",
    ),
  );
  const persistenceLabel =
    plan?.persistence === "local_database" ? "SQLite 本地数据库" : "浏览器内存演示";
  const steps = [
    { label: "发布计划", done: Boolean(plan) },
    { label: "人工批准", done: approved },
    { label: "幂等入队", done: idempotencyVerified },
    { label: "演练回执", done: completed && receipts.length > 0 },
  ];
  const currentStep = Math.max(
    0,
    steps.findIndex((step) => !step.done),
  );

  const primaryAction = (() => {
    if (stale) {
      return (
        <button className="button button--jade publish-primary" disabled={busy} onClick={onReset} type="button">
          <RefreshCw size={16} />基于当前修订新建计划
        </button>
      );
    }
    if (!plan) {
      return (
        <button
          className="button button--jade publish-primary"
          disabled={busy || selectedTargets.size === 0}
          onClick={onPrepare}
          type="button"
        >
          {action === "prepare" ? <span className="spinner" /> : <FileCheck2 size={16} />}
          {action === "prepare" ? "正在生成计划" : "生成发布计划"}
        </button>
      );
    }
    if (!approved) {
      return (
        <button
          className="button button--jade publish-primary"
          disabled={busy || !approvalConfirmed}
          onClick={onApprove}
          type="button"
        >
          {action === "approve" ? <span className="spinner" /> : <UserCheck size={16} />}
          {action === "approve" ? "正在记录批准" : "批准本次演练"}
        </button>
      );
    }
    if (!jobsReady || !idempotencyVerified) {
      return (
        <button className="button button--jade publish-primary" disabled={busy} onClick={onEnqueue} type="button">
          {action === "enqueue" ? <span className="spinner" /> : <Database size={16} />}
          {action === "enqueue" ? "正在连续入队两次" : "验证幂等并入队"}
        </button>
      );
    }
    if (!completed) {
      return (
        <button
          className="button button--jade publish-primary"
          disabled={busy || !processable}
          onClick={onProcess}
          type="button"
        >
          {action === "process" ? <span className="spinner" /> : <Play size={16} />}
          {action === "process" ? "正在执行本地演练" : "执行本地 dry-run"}
        </button>
      );
    }
    return (
      <div className="publish-complete" role="status">
        <CheckCircle2 size={18} />
        <span><strong>演练闭环已完成</strong><small>真实平台始终未被访问</small></span>
      </div>
    );
  })();

  return (
    <section className="feature-page publish-page">
      <PageHead
        eyebrow="OUTBOX / 发布"
        title="逐步确认，再交给确定性发布服务"
        description="计划、批准、入队和回执均来自本地运行时；当前只执行 dry-run，不会触达真实平台。"
        action={
          plan ? (
            <div className="publish-page-actions">
              <button
                aria-label="刷新本地发布计划"
                className="button button--quiet"
                disabled={busy}
                onClick={onRefresh}
                type="button"
              >
                {action === "refresh" ? <span className="spinner" /> : <RefreshCw size={15} />}
                刷新
              </button>
              {!stale && (
                <button className="button button--quiet" disabled={busy} onClick={onReset} type="button">
                  新建计划
                </button>
              )}
            </div>
          ) : undefined
        }
      />
      <ol className="publish-progress" aria-label="发布演练进度">
        {steps.map((step, index) => (
          <li
            className={`${step.done ? "is-done" : ""}${index === currentStep && !step.done ? " is-current" : ""}`}
            key={step.label}
          >
            <span>{step.done ? <Check size={13} /> : index + 1}</span>
            <strong>{step.label}</strong>
          </li>
        ))}
      </ol>
      {error && (
        <div className="publish-alert publish-alert--error" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}
      {stale && (
        <div className="publish-alert" role="status">
          <RefreshCw size={16} />
          <span>稿件已有新修订。旧计划仍可查看，但不能继续执行；请基于当前修订创建新计划。</span>
        </div>
      )}
      <div className="publish-layout">
        <div className="publish-sheet">
          <div className="publish-sheet__top">
            <div><span className="eyebrow">CURRENT REVISION</span><h2>{articleTitle}</h2></div>
            <span className="revision-code" title={revisionId ?? "尚未保存"}>
              {revisionId ? shortCode(revisionId) : "保存时创建"}
            </span>
          </div>
          <div className="publish-platforms">
            {platforms.map((platform) => (
              <label className="publish-target" key={platform.id}>
                <input
                  checked={selectedTargets.has(platform.id)}
                  disabled={Boolean(plan) || busy}
                  onChange={() => onToggleTarget(platform.id)}
                  type="checkbox"
                />
                <span className="custom-check"><Check size={12} /></span>
                <span className="platform-monogram">{platform.shortName.slice(0, 1)}</span>
                <span><strong>{platform.name}</strong><small>dry-run · {platform.limit}</small></span>
              </label>
            ))}
          </div>
          {plan && (
            <div className="publish-variants" aria-label="平台变体">
              <div className="publish-subhead">
                <span>待批准的平台变体</span>
                <small>{plan.variants.length} 项 · 内容哈希已绑定</small>
              </div>
              {plan.variants.map((variant) => (
                <article key={variant.id}>
                  <span className="platform-monogram">{platforms.find((item) => item.id === variant.platform)?.shortName.slice(0, 1)}</span>
                  <div><strong>{variant.title}</strong><small>{variant.accountRef}</small></div>
                  <code title={variant.contentHash}>{shortCode(variant.contentHash)}</code>
                </article>
              ))}
            </div>
          )}
        </div>
        <aside className="publish-decision">
          <div className="decision-checks">
            <span><CheckCircle2 size={15} />{revisionId ? "修订已保存" : "操作时自动保存修订"}</span>
            <span><ShieldCheck size={15} />仅允许本地 dry-run</span>
            <span><Database size={15} />{plan ? persistenceLabel : "等待创建持久化计划"}</span>
          </div>
          {plan && !approved && !stale && (
            <label className="publish-approval">
              <input
                checked={approvalConfirmed}
                disabled={busy}
                onChange={(event) => setApprovalConfirmed(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>我已检查目标与变体</strong>
                <small>批准只适用于当前内容哈希和本次 dry-run。</small>
              </span>
            </label>
          )}
          {primaryAction}
          <p>Agent 不能执行此步骤；批准记录使用桌面用户身份，并与当前修订及平台变体绑定。</p>
        </aside>
      </div>
      {idempotencyVerified && plan && (
        <div className="idempotency-proof" role="status">
          <ShieldCheck size={17} />
          <span><strong>幂等验证通过</strong>连续两次入队返回同一组 {plan.jobs.length} 个 durable job。</span>
          <code>{plan.jobs.map((job) => shortCode(job.id)).join(" · ")}</code>
        </div>
      )}
      <div className="publish-audit-grid">
        <section className="outbox-panel" aria-label="本地 Outbox">
          <div className="publish-subhead">
            <span>SQLite Outbox</span>
            <small>{plan?.jobs.length ?? 0} 个任务</small>
          </div>
          {!plan?.jobs.length ? (
            <div className="publish-empty"><Database size={20} /><span>批准计划并验证幂等后，任务会出现在这里。</span></div>
          ) : (
            <div className="outbox-list">
              {plan.jobs.map((job) => (
                <article key={job.id}>
                  <span className={`job-state job-state--${job.state}`}><i />{publishJobLabels[job.state]}</span>
                  <div>
                    <strong>{platforms.find((item) => item.id === job.platform)?.name}</strong>
                    <small>{shortCode(job.id)} · {job.operation}</small>
                  </div>
                  <code title={job.idempotencyKey}>key {shortCode(job.idempotencyKey)}</code>
                </article>
              ))}
            </div>
          )}
        </section>
        <section className="receipt-panel" aria-label="发布演练回执">
          <div className="publish-subhead">
            <span>Receipt</span>
            <small>{receipts.length} 个持久化回执</small>
          </div>
          {receipts.length === 0 ? (
            <div className="publish-empty"><FileCheck2 size={20} /><span>执行本地 dry-run 后，可在这里核对远端模拟 ID 与内容哈希。</span></div>
          ) : (
            <div className="receipt-list">
              {receipts.map((receipt) => (
                <article key={receipt.id}>
                  <CheckCircle2 size={17} />
                  <div><strong>{receipt.status}</strong><small>{receipt.remoteId}</small></div>
                  <code title={receipt.contentHash}>{shortCode(receipt.contentHash)}</code>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

interface ConnectionsPageProps {
  profiles: ConnectionProfilePublic[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onCreate: (request: CreateConnectionProfileRequest) => Promise<void>;
}

interface ConnectionFormState {
  name: string;
  provider: ConnectionProvider;
  baseUrl: string;
  secretEnvVar: string;
  defaultTextModel: string;
  defaultImageModel: string;
  timeoutSeconds: string;
}

type ConnectionFormField = keyof ConnectionFormState;
type ConnectionFormErrors = Partial<Record<ConnectionFormField, string>>;

const connectionFieldIds: Record<ConnectionFormField, string> = {
  name: "connection-name",
  provider: "connection-provider",
  baseUrl: "connection-base-url",
  secretEnvVar: "connection-secret-env",
  defaultTextModel: "connection-text-model",
  defaultImageModel: "connection-image-model",
  timeoutSeconds: "connection-timeout",
};

function initialConnectionForm(): ConnectionFormState {
  return {
    name: "",
    provider: "openai-compatible",
    baseUrl: "",
    secretEnvVar: "OPENAI_API_KEY",
    defaultTextModel: "",
    defaultImageModel: "",
    timeoutSeconds: "30",
  };
}

function validateConnectionForm(form: ConnectionFormState): ConnectionFormErrors {
  const errors: ConnectionFormErrors = {};
  if (!form.name.trim()) errors.name = "请输入连接名称。";
  else if (form.name.trim().length > 200) errors.name = "连接名称不能超过 200 个字符。";

  if (form.provider !== "mock") {
    const variable = form.secretEnvVar.trim();
    if (!variable) errors.secretEnvVar = "请输入启动前设置的环境变量名。";
    else if (
      variable.length > 128 ||
      !variable.includes("_") ||
      !/^[A-Z_][A-Z0-9_]*$/.test(variable)
    ) {
      errors.secretEnvVar = "请填写大写环境变量名，例如 OPENAI_API_KEY；不要粘贴 API Key。";
    }
  }

  if (form.baseUrl.trim() && form.provider !== "mock") {
    try {
      const parsed = new URL(form.baseUrl.trim());
      const loopback =
        parsed.hostname === "localhost" ||
        parsed.hostname === "::1" ||
        /^127(?:\.\d{1,3}){3}$/.test(parsed.hostname);
      if (
        (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash
      ) {
        errors.baseUrl = "请使用 HTTPS；本机 loopback 可用 HTTP，且不能包含凭证或查询参数。";
      }
    } catch {
      errors.baseUrl = "请输入完整的 HTTPS 或本机 loopback URL。";
    }
  }

  if (form.defaultTextModel.trim().length > 200) {
    errors.defaultTextModel = "模型名称不能超过 200 个字符。";
  }
  if (form.defaultImageModel.trim().length > 200) {
    errors.defaultImageModel = "模型名称不能超过 200 个字符。";
  }
  const timeout = Number(form.timeoutSeconds);
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300) {
    errors.timeoutSeconds = "超时时间应为 1–300 秒的整数。";
  }
  return errors;
}

function providerName(provider: string) {
  if (provider === "openai-compatible") return "OpenAI Compatible";
  if (provider === "mock") return "Mock（确定性）";
  return provider;
}

export function ConnectionsPage({
  profiles,
  loading,
  error,
  onRetry,
  onCreate,
}: ConnectionsPageProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<ConnectionFormState>(initialConnectionForm);
  const [touched, setTouched] = useState<Set<ConnectionFormField>>(new Set());
  const [errors, setErrors] = useState<ConnectionFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const restoreFocus = () => {
    window.setTimeout(() => previousFocusRef.current?.focus(), 0);
  };

  const dismissDialog = (force = false) => {
    if (submitting && !force) return;
    setDialogOpen(false);
    setSubmitError(null);
    restoreFocus();
  };

  const openDialog = (trigger?: HTMLElement) => {
    previousFocusRef.current =
      trigger ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setForm(initialConnectionForm());
    setTouched(new Set());
    setErrors({});
    setSubmitError(null);
    setDialogOpen(true);
  };

  useEffect(() => {
    if (!dialogOpen) return;
    nameInputRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        event.preventDefault();
        setDialogOpen(false);
        setSubmitError(null);
        restoreFocus();
        return;
      }
      if (event.key === "Tab") {
        const dialog = nameInputRef.current?.closest<HTMLElement>('[role="dialog"]');
        const focusable = Array.from(
          dialog?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dialogOpen, submitting]);

  const updateField = (field: ConnectionFormField, value: string) => {
    const next = { ...form, [field]: value };
    if (field === "provider" && value === "mock") {
      next.baseUrl = "";
      next.secretEnvVar = "";
    }
    if (field === "provider" && value === "openai-compatible" && !next.secretEnvVar) {
      next.secretEnvVar = "OPENAI_API_KEY";
    }
    setForm(next);
    if (touched.has(field)) setErrors(validateConnectionForm(next));
  };

  const touchField = (field: ConnectionFormField) => {
    setTouched((current) => new Set(current).add(field));
    setErrors(validateConnectionForm(form));
  };

  const fieldError = (field: ConnectionFormField) =>
    touched.has(field) ? errors[field] : undefined;

  const submitConnection = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateConnectionForm(form);
    setErrors(nextErrors);
    setTouched(new Set(Object.keys(connectionFieldIds) as ConnectionFormField[]));
    const firstInvalid = (Object.keys(connectionFieldIds) as ConnectionFormField[]).find(
      (field) => nextErrors[field],
    );
    if (firstInvalid) {
      document.getElementById(connectionFieldIds[firstInvalid])?.focus();
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      await onCreate({
        name: form.name.trim(),
        provider: form.provider,
        baseUrl:
          form.provider === "mock" || !form.baseUrl.trim() ? null : form.baseUrl.trim(),
        secretEnvVar:
          form.provider === "mock" ? null : form.secretEnvVar.trim(),
        defaultTextModel: form.defaultTextModel.trim() || null,
        defaultImageModel: form.defaultImageModel.trim() || null,
        timeoutSeconds: Number(form.timeoutSeconds),
      });
      dismissDialog(true);
    } catch (creationError) {
      const detail =
        creationError instanceof Error ? creationError.message : String(creationError);
      setSubmitError(detail.slice(0, 200));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <section className="feature-page">
        <PageHead
          eyebrow="CONNECTIONS / 连接"
          title="只保存模型配置与凭证引用"
          description="WebView 不接收 API Key；Rust 只把公开配置和 env:// 引用交给本地运行时。"
          action={
            <button
              className="button button--jade"
              onClick={(event) => openDialog(event.currentTarget)}
              type="button"
            >
              <Plus size={16} />添加连接
            </button>
          }
        />
        <div className="security-banner">
          <KeyRound size={20} />
          <div>
            <strong>请在启动桌面应用前设置环境变量</strong>
            <p>P0 只保存环境变量名、模型名和超时等公开配置，不保存或校验明文密钥；当前 deterministic demo 仍使用内置 Mock。</p>
          </div>
          <span>REFERENCE ONLY</span>
        </div>

        {loading && profiles.length === 0 && (
          <div className="connection-feedback" role="status">
            <span className="spinner" />正在读取本地连接配置…
          </div>
        )}
        {error && (
          <div className="connection-feedback connection-feedback--error" role="alert">
            <div><strong>连接配置读取失败</strong><span>{error}</span></div>
            <button className="button button--quiet" onClick={onRetry} type="button">
              <RefreshCw size={14} />重试
            </button>
          </div>
        )}
        {!loading && !error && profiles.length === 0 && (
          <div className="connection-empty">
            <Link2 size={21} />
            <div>
              <strong>尚未添加模型连接</strong>
              <p>先设置环境变量，再保存它的名称与模型配置。也可添加无需密钥的 Mock 连接。</p>
            </div>
            <button
              className="button button--quiet"
              onClick={(event) => openDialog(event.currentTarget)}
              type="button"
            >
              添加第一条连接
            </button>
          </div>
        )}

        <div className="connection-grid">
          {profiles.map((profile) => {
            const Icon = profile.provider === "mock" ? Bot : Sparkles;
            return (
              <article className="connection-card" key={profile.id}>
                <div className="connection-card__head">
                  <span className="connection-icon"><Icon size={19} /></span>
                  <span className="connection-state"><i />已保存引用</span>
                </div>
                <small>{providerName(profile.provider)}</small>
                <h2>{profile.name}</h2>
                <p>
                  {profile.baseUrl ?? "未设置 Base URL"}
                  <br />
                  {profile.secretScheme === "mock"
                    ? "Mock 引用 · 不使用真实密钥"
                    : `${profile.secretScheme.toUpperCase()} 引用 · 变量名不会回传`}
                </p>
                <div className="connection-card__meta">
                  <span>
                    文本：{profile.defaultTextModel ?? "未指定"} · 生图：
                    {profile.defaultImageModel ?? "未指定"}
                  </span>
                  <span>{profile.timeoutSeconds}s</span>
                </div>
              </article>
            );
          })}

          <article className="connection-card connection-card--extension">
            <div className="connection-card__head">
              <span className="connection-icon"><Blocks size={19} /></span>
              <span className="connection-state connection-state--pending"><i />待配对</span>
            </div>
            <small>浏览器扩展基础</small>
            <h2>CSDN / 今日头条发布扩展</h2>
            <p>源码包含 MV3 基础；需在 Chrome 开发者模式加载。v0.1 尚未接入桌面配对入口。</p>
            <div className="connection-card__meta">
              <span>需在 Chrome 加载</span>
              <span>无已连接声明</span>
            </div>
          </article>
        </div>
      </section>

      {dialogOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) dismissDialog();
          }}
          role="presentation"
        >
          <section
            aria-describedby="connection-dialog-description"
            aria-labelledby="connection-dialog-title"
            aria-modal="true"
            className="connection-dialog"
            role="dialog"
          >
            <header>
              <div>
                <span className="eyebrow">MODEL CONNECTION</span>
                <h2 id="connection-dialog-title">添加模型连接</h2>
                <p id="connection-dialog-description">
                  这里只填写公开配置和环境变量名，不能粘贴 API Key。
                </p>
              </div>
              <button
                aria-label="关闭添加连接对话框"
                className="icon-button"
                disabled={submitting}
                onClick={() => dismissDialog()}
                type="button"
              >
                <X size={17} />
              </button>
            </header>
            <form aria-busy={submitting} noValidate onSubmit={submitConnection}>
              <div className="connection-form-grid">
                <label className="form-field" htmlFor={connectionFieldIds.name}>
                  <span>连接名称 <b aria-hidden="true">*</b></span>
                  <input
                    aria-describedby={fieldError("name") ? "connection-name-error" : undefined}
                    aria-invalid={Boolean(fieldError("name"))}
                    id={connectionFieldIds.name}
                    maxLength={200}
                    onBlur={() => touchField("name")}
                    onChange={(event) => updateField("name", event.target.value)}
                    ref={nameInputRef}
                    required
                    value={form.name}
                  />
                  {fieldError("name") && <small id="connection-name-error" role="alert">{fieldError("name")}</small>}
                </label>

                <label className="form-field" htmlFor={connectionFieldIds.provider}>
                  <span>提供商 <b aria-hidden="true">*</b></span>
                  <select
                    id={connectionFieldIds.provider}
                    onBlur={() => touchField("provider")}
                    onChange={(event) => updateField("provider", event.target.value)}
                    required
                    value={form.provider}
                  >
                    <option value="openai-compatible">OpenAI Compatible</option>
                    <option value="mock">Mock（无需密钥）</option>
                  </select>
                </label>

                <label className="form-field form-field--wide" htmlFor={connectionFieldIds.baseUrl}>
                  <span>Base URL</span>
                  <input
                    aria-describedby={fieldError("baseUrl") ? "connection-base-url-error" : "connection-base-url-help"}
                    aria-invalid={Boolean(fieldError("baseUrl"))}
                    disabled={form.provider === "mock"}
                    id={connectionFieldIds.baseUrl}
                    inputMode="url"
                    onBlur={() => touchField("baseUrl")}
                    onChange={(event) => updateField("baseUrl", event.target.value)}
                    placeholder="https://api.example.com/v1"
                    value={form.baseUrl}
                  />
                  <small className="form-help" id="connection-base-url-help">仅 HTTPS；127.0.0.1、localhost 等 loopback 可使用 HTTP。</small>
                  {fieldError("baseUrl") && <small id="connection-base-url-error" role="alert">{fieldError("baseUrl")}</small>}
                </label>

                <label className="form-field form-field--wide" htmlFor={connectionFieldIds.secretEnvVar}>
                  <span>密钥环境变量名 {form.provider !== "mock" && <b aria-hidden="true">*</b>}</span>
                  <input
                    aria-describedby={fieldError("secretEnvVar") ? "connection-env-error" : "connection-env-help"}
                    aria-invalid={Boolean(fieldError("secretEnvVar"))}
                    autoComplete="off"
                    disabled={form.provider === "mock"}
                    id={connectionFieldIds.secretEnvVar}
                    onBlur={() => touchField("secretEnvVar")}
                    onChange={(event) => updateField("secretEnvVar", event.target.value)}
                    required={form.provider !== "mock"}
                    spellCheck={false}
                    value={form.secretEnvVar}
                  />
                  <small className="form-help" id="connection-env-help">启动应用前设置该环境变量。这里不能填写 sk-… 等真实密钥。</small>
                  {fieldError("secretEnvVar") && <small id="connection-env-error" role="alert">{fieldError("secretEnvVar")}</small>}
                </label>

                <label className="form-field" htmlFor={connectionFieldIds.defaultTextModel}>
                  <span>默认文本模型</span>
                  <input
                    id={connectionFieldIds.defaultTextModel}
                    maxLength={200}
                    onBlur={() => touchField("defaultTextModel")}
                    onChange={(event) => updateField("defaultTextModel", event.target.value)}
                    placeholder="例如 gpt-4.1-mini"
                    value={form.defaultTextModel}
                  />
                </label>

                <label className="form-field" htmlFor={connectionFieldIds.defaultImageModel}>
                  <span>默认生图模型</span>
                  <input
                    id={connectionFieldIds.defaultImageModel}
                    maxLength={200}
                    onBlur={() => touchField("defaultImageModel")}
                    onChange={(event) => updateField("defaultImageModel", event.target.value)}
                    placeholder="可留空"
                    value={form.defaultImageModel}
                  />
                </label>

                <label className="form-field" htmlFor={connectionFieldIds.timeoutSeconds}>
                  <span>请求超时（秒）</span>
                  <input
                    aria-describedby={fieldError("timeoutSeconds") ? "connection-timeout-error" : undefined}
                    aria-invalid={Boolean(fieldError("timeoutSeconds"))}
                    id={connectionFieldIds.timeoutSeconds}
                    inputMode="numeric"
                    max={300}
                    min={1}
                    onBlur={() => touchField("timeoutSeconds")}
                    onChange={(event) => updateField("timeoutSeconds", event.target.value)}
                    required
                    type="number"
                    value={form.timeoutSeconds}
                  />
                  {fieldError("timeoutSeconds") && <small id="connection-timeout-error" role="alert">{fieldError("timeoutSeconds")}</small>}
                </label>
              </div>

              <div className="connection-form-note">
                <LockKeyhole size={15} />
                <span>保存后不会测试真实模型；当前 deterministic demo 仍使用内置 Mock。</span>
              </div>
              {submitError && <p className="connection-form-error" role="alert">{submitError}</p>}
              <footer>
                <button className="button button--quiet" disabled={submitting} onClick={() => dismissDialog()} type="button">取消</button>
                <button className="button button--jade" disabled={submitting} type="submit">
                  {submitting ? <span className="spinner" /> : <Plus size={15} />}
                  {submitting ? "正在保存" : "保存连接引用"}
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

export function SkillsPage({
  enabled,
  onToggle,
}: {
  enabled: Set<string>;
  onToggle: (id: string) => void;
}) {
  const skills = [
    {
      id: "social-card",
      name: "归藏社交卡片",
      owner: "op7418 / guizang-social-card-skill",
      description: "可选外部 AGPL Skill。v0.1 未内置、未安装，也不会随应用自动下载或启用。",
      icon: Paintbrush,
      tone: "cinnabar",
      version: "v0.1 未安装",
      unavailable: true,
    },
    {
      id: "risk-words",
      name: "平台违禁词巡检",
      owner: "Open Publisher",
      description: "按平台规则检查敏感、绝对化和高风险承诺，输出结构化风险报告。",
      icon: ShieldCheck,
      tone: "jade",
      version: "v0.1 内置声明",
      unavailable: false,
    },
    {
      id: "humanize",
      name: "自然语言润色",
      owner: "Open Publisher",
      description: "减少重复句式与模板腔，保留作者事实和表达边界。",
      icon: Sparkles,
      tone: "ink",
      version: "v0.1 内置声明",
      unavailable: false,
    },
    {
      id: "evidence",
      name: "证据卡整理",
      owner: "Open Publisher",
      description: "将来源转成可引用、可核验的结构化证据卡。",
      icon: FileCheck2,
      tone: "porcelain",
      version: "v0.1 内置声明",
      unavailable: false,
    },
  ];
  return (
    <section className="feature-page">
      <PageHead
        eyebrow="SKILLS / 能力包"
        title="Skill 是有版本的工具，不是一段神秘提示词"
        description="v0.1 展示声明式能力元数据；这些 Skill 不拥有平台写权限。"
      />
      <div className="skill-grid">
        {skills.map(({ id, name, owner, description, icon: Icon, tone, version, unavailable }) => (
          <article className="skill-card" key={id}>
            <div className={`skill-glyph skill-glyph--${tone}`}><Icon size={22} /></div>
            <div className="skill-card__head">
              <div><small>{owner}</small><h2>{name}</h2></div>
              <label className="node-toggle">
                <input
                  aria-label={`${unavailable ? "不可启用" : enabled.has(id) ? "停用" : "启用"}${name}`}
                  checked={!unavailable && enabled.has(id)}
                  disabled={unavailable}
                  onChange={() => onToggle(id)}
                  type="checkbox"
                />
                <i />
              </label>
            </div>
            <p>{description}</p>
            <footer>
              <span>{version}</span>
              <span><LockKeyhole size={12} />声明式 · 无平台写权限</span>
              {unavailable && <span>外部 AGPL</span>}
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}

const taskLabels: Record<TaskRecord["status"], string> = {
  queued: "排队中",
  running: "执行中",
  done: "已完成",
  blocked: "需处理",
};

export function TasksPage({
  tasks,
  platforms,
}: {
  tasks: TaskRecord[];
  platforms: PlatformDefinition[];
}) {
  return (
    <section className="feature-page">
      <PageHead
        eyebrow="TASKS / 任务"
        title="每一次外部写入，都留下可重放的记录"
        description="队列保存幂等键、尝试次数、平台回执与对账状态。"
      />
      <div className="task-summary">
        <article><small>正在执行</small><strong>{tasks.filter((item) => item.status === "running").length}</strong><span><Play size={14} />Worker 在线</span></article>
        <article><small>等待执行</small><strong>{tasks.filter((item) => item.status === "queued").length}</strong><span><Clock3 size={14} />按计划排队</span></article>
        <article><small>需要处理</small><strong>{tasks.filter((item) => item.status === "blocked").length}</strong><span><AlertCircle size={14} />连接或内容问题</span></article>
      </div>
      <div className="task-table-wrap">
        <table className="task-table">
          <thead><tr><th>任务</th><th>平台</th><th>计划</th><th>状态</th><th>尝试</th><th /></tr></thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td><code>{task.id.toUpperCase()}</code><strong>{task.title}</strong></td>
                <td>{platforms.find((item) => item.id === task.platform)?.name}</td>
                <td>{task.scheduledFor}</td>
                <td><span className={`task-state task-state--${task.status}`}><i />{taskLabels[task.status]}</span></td>
                <td>{task.status === "blocked" ? "2 / 3" : task.status === "done" ? "1 / 3" : "0 / 3"}</td>
                <td><button aria-label={`${task.id}更多操作`} type="button"><MoreHorizontal size={16} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function PlatformPreviewCard({
  article,
  platform,
}: {
  article: Article;
  platform: PlatformId;
}) {
  const intro =
    platform === "toutiao"
      ? `如果写作工具突然断网，你还能找到自己的稿件吗？${article.deck}`
      : platform === "csdn"
        ? `> 本文从架构边界、版本模型和发布流水线三个方面，拆解本地优先写作工具。`
        : article.deck;
  return (
    <div className={`platform-preview platform-preview--${platform}`}>
      <div className="platform-preview__browser"><i /><i /><i /><span>平台预览 · 不会实际发布</span></div>
      <div className="platform-preview__page">
        <span className="preview-channel">{platform === "wechat" ? "Open Publisher 实验室" : platform === "csdn" ? "OpenPublisherLab" : "创作者工具观察"}</span>
        <h1>{article.title}</h1>
        <p className="preview-deck">{intro}</p>
        <MarkdownPreview compact markdown={article.markdown.split("\n").slice(4, 13).join("\n")} />
      </div>
    </div>
  );
}
