import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Send,
} from "lucide-react";
import { useEffect, useState } from "react";
import type {
  PublishPlanSummary,
  PublishReceiptSummary,
} from "../lib/desktopBridge";
import type { Article, PlatformDefinition, PlatformId } from "../types";

export type PublishAction =
  | "prepare"
  | "approve"
  | "enqueue"
  | "process"
  | "refresh"
  | null;

interface PublishingPageProps {
  action: PublishAction;
  articles: Article[];
  selectedArticle: Article | null;
  selectedTargets: Set<PlatformId>;
  platforms: PlatformDefinition[];
  plan: PublishPlanSummary | null;
  receipts: PublishReceiptSummary[];
  stale: boolean;
  error: string | null;
  onSelectArticle: (articleId: string) => void;
  onToggleTarget: (platform: PlatformId) => void;
  onPrepare: () => void;
  onApprove: () => void;
  onEnqueue: () => void;
  onProcess: () => void;
  onRefresh: () => void;
  onReset: () => void;
  onOpenSettings: () => void;
}

const jobStateLabel: Record<PublishPlanSummary["jobs"][number]["state"], string> = {
  pending: "等待执行",
  in_progress: "执行中",
  succeeded: "已完成",
  failed_retryable: "可以重试",
  failed_terminal: "执行失败",
  unknown: "结果待确认",
  reconciling: "正在确认",
  cancelled: "已取消",
};

export function PublishingPage({
  action,
  articles,
  selectedArticle,
  selectedTargets,
  platforms,
  plan,
  receipts,
  stale,
  error,
  onSelectArticle,
  onToggleTarget,
  onPrepare,
  onApprove,
  onEnqueue,
  onProcess,
  onRefresh,
  onReset,
  onOpenSettings,
}: PublishingPageProps) {
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    setConfirmed(false);
  }, [plan?.planId, stale]);

  if (!selectedArticle) {
    return (
      <section className="page empty-page">
        <Send aria-hidden="true" size={28} />
        <h1>没有可发布的文章</h1>
      </section>
    );
  }

  const hasPendingJobs = Boolean(
    plan?.jobs.some(
      (job) => job.state === "pending" || job.state === "failed_retryable",
    ),
  );
  const completed = plan?.status === "completed";
  const primaryBusy = action !== null;

  return (
    <section className="page page--publish">
      <header className="page-heading page-heading--publish">
        <div>
          <span className="page-kicker">发布中心</span>
          <h1>生成可审核的平台稿</h1>
        </div>
        <label className="article-picker">
          <span>当前文章</span>
          <select
            disabled={Boolean(plan)}
            onChange={(event) => onSelectArticle(event.target.value)}
            value={selectedArticle.id}
          >
            {articles.map((article) => (
              <option key={article.id} value={article.id}>
                {article.title}
              </option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" size={15} />
        </label>
      </header>

      <div className="publish-layout">
        <div className="publish-main">
          <section className="publish-section">
            <header>
              <span className="step-number">1</span>
              <div>
                <h2>选择平台</h2>
                <p>每个平台会生成独立发布版本。</p>
              </div>
            </header>
            <div className="publish-platforms">
              {platforms.map((platform) => {
                const selected = selectedTargets.has(platform.id);
                return (
                  <label className={selected ? "is-selected" : ""} key={platform.id}>
                    <input
                      checked={selected}
                      disabled={Boolean(plan) || primaryBusy}
                      onChange={() => onToggleTarget(platform.id)}
                      type="checkbox"
                    />
                    <span className={`platform-logo platform-logo--${platform.id}`}>
                      {platform.shortName.slice(0, 1)}
                    </span>
                    <span>
                      <strong>{platform.name}</strong>
                      <small>
                        {platform.status === "connected" ? "账号已连接" : "本地演练"}
                      </small>
                    </span>
                    <Check className="publish-platform__check" size={16} />
                  </label>
                );
              })}
            </div>
          </section>

          <section className="publish-section">
            <header>
              <span className="step-number">2</span>
              <div>
                <h2>平台版本</h2>
                <p>标题和正文会绑定当前文章修订。</p>
              </div>
            </header>

            {!plan ? (
              <div className="publish-empty">
                <p>{selectedTargets.size} 个平台等待生成</p>
                <button
                  className="button button--primary"
                  disabled={primaryBusy || selectedTargets.size === 0}
                  onClick={onPrepare}
                  type="button"
                >
                  {action === "prepare" ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <RefreshCw size={16} />
                  )}
                  {action === "prepare" ? "正在生成" : "生成平台稿"}
                </button>
              </div>
            ) : (
              <div className="variant-list">
                {plan.variants.map((variant) => {
                  const platform = platforms.find(
                    (item) => item.id === variant.platform,
                  );
                  return (
                    <article className="variant-item" key={variant.id}>
                      <span
                        className={`platform-logo platform-logo--${variant.platform}`}
                      >
                        {platform?.shortName.slice(0, 1)}
                      </span>
                      <div>
                        <small>{platform?.name}</small>
                        <strong>{variant.title}</strong>
                      </div>
                      <span className="variant-state">
                        <CheckCircle2 size={15} />
                        已生成
                      </span>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {plan && (
            <section className="publish-section">
              <header>
                <span className="step-number">3</span>
              <div>
                <h2>确认并演练</h2>
                <p>当前版本不会登录或发布到外部平台，只记录本地演练结果。</p>
              </div>
              </header>

              {stale && (
                <div className="inline-alert inline-alert--warning">
                  <AlertCircle size={17} />
                  <span>文章已修改，请重新生成平台稿。</span>
                  <button className="text-button" onClick={onReset} type="button">
                    重新生成
                  </button>
                </div>
              )}

              {!stale && !completed && (
                <label className="approval-check">
                  <input
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    type="checkbox"
                  />
                  <span>我已检查文章、目标平台和标题</span>
                </label>
              )}

              <div className="publish-actions">
                <button
                  className="button button--quiet"
                  disabled={primaryBusy}
                  onClick={onReset}
                  type="button"
                >
                  <RotateCcw size={15} />
                  重新生成
                </button>
                {plan.approvalStatus === "pending" && (
                  <button
                    className="button button--primary"
                    disabled={!confirmed || stale || primaryBusy}
                    onClick={onApprove}
                    type="button"
                  >
                    {action === "approve" && (
                      <LoaderCircle className="spin" size={16} />
                    )}
                    确认平台稿
                  </button>
                )}
                {plan.approvalStatus === "approved" && plan.jobs.length === 0 && (
                  <button
                    className="button button--primary"
                    disabled={!confirmed || stale || primaryBusy}
                    onClick={onEnqueue}
                    type="button"
                  >
                    {action === "enqueue" && (
                      <LoaderCircle className="spin" size={16} />
                    )}
                    加入发布队列
                  </button>
                )}
                {hasPendingJobs && (
                  <button
                    className="button button--primary"
                    disabled={!confirmed || stale || primaryBusy}
                    onClick={onProcess}
                    type="button"
                  >
                    {action === "process" ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Send size={16} />
                    )}
                    {action === "process" ? "正在执行" : "执行发布演练"}
                  </button>
                )}
                {completed && (
                  <span className="completion-label">
                    <CheckCircle2 size={17} />
                    <span>演练完成</span>
                    <span>{receipts.length} 个平台回执</span>
                  </span>
                )}
              </div>
            </section>
          )}

          {error && (
            <div className="inline-alert inline-alert--error" role="alert">
              <AlertCircle size={17} />
              <span>{error}</span>
              <button className="text-button" onClick={onRefresh} type="button">
                重试
              </button>
            </div>
          )}
        </div>

        <aside className="publish-history" aria-label="本次发布状态">
          <div className="publish-history__head">
            <div>
              <span className="page-kicker">本次发布</span>
              <strong>{plan?.jobs.length ?? 0} 个任务</strong>
            </div>
            <button
              className="text-button"
              onClick={onOpenSettings}
              type="button"
            >
              管理账号
            </button>
          </div>
          {plan?.jobs.length ? (
            <div className="publish-job-list">
              {plan.jobs.map((job) => {
                const platform = platforms.find((item) => item.id === job.platform);
                const receipt = receipts.find((item) => item.jobId === job.id);
                return (
                  <article key={job.id}>
                    <span className={`job-state job-state--${job.state}`} />
                    <div>
                      <strong>{platform?.name}</strong>
                      <small>{jobStateLabel[job.state]}</small>
                    </div>
                    {receipt && <CheckCircle2 aria-label="已有回执" size={16} />}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="publish-history__empty">
              <p>生成并确认平台稿后，这里会显示执行状态。</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
