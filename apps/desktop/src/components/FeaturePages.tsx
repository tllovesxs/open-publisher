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
} from "lucide-react";
import { MarkdownPreview } from "./MarkdownPreview";
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
}: {
  articles: Article[];
  selectedId: string;
  onOpen: (id: string) => void;
}) {
  return (
    <section className="feature-page">
      <PageHead
        eyebrow="LIBRARY / 文章库"
        title="稿件不是文件，是一条修订历史"
        description="Markdown 正本保留在本地；平台版本从指定修订生成。"
        action={<button className="button button--jade" type="button"><Plus size={16} />新建文章</button>}
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
}: {
  stages: WorkflowStage[];
  disabledStages: Set<string>;
  onToggleStage: (id: string) => void;
  onRun: () => void;
  running: boolean;
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
                    {index === 3 && "并发生成三个平台变体"}
                    {index === 4 && "敏感词、事实与承诺检查"}
                    {index === 5 && "作者确认最终修订"}
                    {index === 6 && "写入 Outbox 并可重试"}
                  </p>
                  {stage.optional && <span className="optional-tag">可跳过</span>}
                </article>
                {index < stages.length - 1 && <span className="workflow-arrow"><ArrowRight size={16} /></span>}
              </div>
            );
          })}
        </div>
      </div>
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
  onGenerate,
}: {
  generatedCount: number;
  onGenerate: () => void;
}) {
  const total = 4 + generatedCount;
  return (
    <section className="feature-page">
      <PageHead
        eyebrow="ASSETS / 素材库"
        title="配图也要知道自己从哪里来"
        description="每项素材保存提示词、模型、比例、授权与关联稿件。"
        action={<button className="button button--jade" onClick={onGenerate} type="button"><ImagePlus size={16} />生成配图</button>}
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
                <strong>{index === total - 1 && generatedCount ? "新生成的视觉草案" : ["本地优先", "Agent 协作", "证据先行", "一稿多发"][index % 4]}</strong>
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

export function PublishPage({
  platforms,
  tasks,
  onQueue,
}: {
  platforms: PlatformDefinition[];
  tasks: TaskRecord[];
  onQueue: () => void;
}) {
  return (
    <section className="feature-page publish-page">
      <PageHead
        eyebrow="OUTBOX / 发布"
        title="确认之后，才把文章交给平台"
        description="当前为演练模式：操作只写入本地任务队列，不会触达真实平台。"
      />
      <div className="publish-layout">
        <div className="publish-sheet">
          <div className="publish-sheet__top">
            <div><span className="eyebrow">READY REVISION</span><h2>本地优先，才是创作者工具的底气</h2></div>
            <span className="revision-code">REV·0084</span>
          </div>
          <div className="publish-platforms">
            {platforms.map((platform) => (
              <label className="publish-target" key={platform.id}>
                <input defaultChecked={platform.id !== "toutiao"} type="checkbox" />
                <span className="custom-check"><Check size={12} /></span>
                <span className="platform-monogram">{platform.shortName.slice(0, 1)}</span>
                <span><strong>{platform.name}</strong><small>{platform.limit}</small></span>
                <i className={`connection-dot connection-dot--${platform.status}`} />
              </label>
            ))}
          </div>
          <div className="publish-options">
            <label><span>发布时间</span><button type="button"><Clock3 size={14} />今天 20:30</button></label>
            <label><span>失败策略</span><button type="button"><RefreshCw size={14} />自动重试 3 次</button></label>
          </div>
        </div>
        <aside className="publish-decision">
          <div className="decision-checks">
            <span><CheckCircle2 size={15} />修订已保存</span>
            <span><CheckCircle2 size={15} />风险无阻断项</span>
            <span><CheckCircle2 size={15} />封面比例已适配</span>
          </div>
          <button className="publish-seal" onClick={onQueue} type="button" aria-label="盖章并加入发布队列">
            <span>发布</span>
            <small>入队</small>
          </button>
          <p>盖章后生成不可变快照与幂等键。<br />仍可在任务开始前撤销。</p>
        </aside>
      </div>
      <div className="outbox-glance">
        <span>队列中 <strong>{tasks.filter((task) => task.status === "queued").length}</strong></span>
        <span>已完成 <strong>{tasks.filter((task) => task.status === "done").length}</strong></span>
        <span>需要处理 <strong>{tasks.filter((task) => task.status === "blocked").length}</strong></span>
      </div>
    </section>
  );
}

export function ConnectionsPage({ onCheck }: { onCheck: (name: string) => void }) {
  const connections = [
    { name: "OpenAI Compatible", kind: "模型路由", state: "已连接", icon: Sparkles, detail: "密钥保存在系统钥匙串 · sk-•••• 3H9P" },
    { name: "微信公众号", kind: "官方 API", state: "已连接", icon: Link2, detail: "服务号 · OpenPublisherLab" },
    { name: "CSDN 发布扩展", kind: "浏览器扩展", state: "已连接", icon: Blocks, detail: "本机扩展 · 最近握手 2 分钟前" },
    { name: "今日头条", kind: "浏览器扩展", state: "待修复", icon: AlertCircle, detail: "登录状态已过期，需要在浏览器重新登录" },
  ];
  return (
    <section className="feature-page">
      <PageHead
        eyebrow="CONNECTIONS / 连接"
        title="凭证止步于 Rust 安全边界"
        description="前端只看见连接状态和掩码；明文密钥、Cookie 与 Python 地址永不进入 WebView。"
        action={<button className="button button--jade" type="button"><Plus size={16} />添加连接</button>}
      />
      <div className="security-banner">
        <KeyRound size={20} />
        <div><strong>系统钥匙串已启用</strong><p>敏感凭证由桌面宿主读取，只向受信命令提供一次性授权。</p></div>
        <span>BOUNDARY / RUST</span>
      </div>
      <div className="connection-grid">
        {connections.map(({ name, kind, state, icon: Icon, detail }) => (
          <article className="connection-card" key={name}>
            <div className="connection-card__head">
              <span className="connection-icon"><Icon size={19} /></span>
              <span className={`connection-state${state === "待修复" ? " connection-state--warn" : ""}`}>
                <i />{state}
              </span>
            </div>
            <small>{kind}</small>
            <h2>{name}</h2>
            <p>{detail}</p>
            <div>
              <button className="button button--quiet" onClick={() => onCheck(name)} type="button"><RefreshCw size={14} />检查连接</button>
              <button aria-label={`${name}设置`} type="button"><MoreHorizontal size={16} /></button>
            </div>
          </article>
        ))}
      </div>
    </section>
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
    { id: "social-card", name: "社交卡片生成", owner: "op7418 / 归藏", description: "根据文章语义生成封面、知识卡片与平台比例变体。", icon: Paintbrush, tone: "cinnabar" },
    { id: "risk-words", name: "平台违禁词巡检", owner: "Open Publisher", description: "按平台规则检查敏感、绝对化和高风险承诺。", icon: ShieldCheck, tone: "jade" },
    { id: "humanize", name: "自然语言润色", owner: "Open Publisher", description: "减少重复句式与模板腔，保留作者事实和表达边界。", icon: Sparkles, tone: "ink" },
    { id: "evidence", name: "证据卡整理", owner: "Open Publisher", description: "将来源转成可引用、可核验的结构化证据卡。", icon: FileCheck2, tone: "porcelain" },
  ];
  return (
    <section className="feature-page">
      <PageHead
        eyebrow="SKILLS / 能力包"
        title="Skill 是有版本的工具，不是一段神秘提示词"
        description="每次运行记录 Skill 版本、输入、产物与授权；高风险能力默认需要确认。"
        action={<button className="button button--quiet" type="button"><UploadCloud size={15} />从本地安装</button>}
      />
      <div className="skill-grid">
        {skills.map(({ id, name, owner, description, icon: Icon, tone }) => (
          <article className="skill-card" key={id}>
            <div className={`skill-glyph skill-glyph--${tone}`}><Icon size={22} /></div>
            <div className="skill-card__head">
              <div><small>{owner}</small><h2>{name}</h2></div>
              <label className="node-toggle">
                <input checked={enabled.has(id)} onChange={() => onToggle(id)} type="checkbox" />
                <i />
              </label>
            </div>
            <p>{description}</p>
            <footer><span>v1.0.0</span><span><LockKeyhole size={12} />沙箱运行</span><button type="button">查看说明</button></footer>
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
