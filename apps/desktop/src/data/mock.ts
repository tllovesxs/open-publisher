import type {
  Article,
  EvidenceItem,
  PlatformDefinition,
  RiskItem,
  TaskRecord,
  WorkflowStage,
} from "../types";

export const articles: Article[] = [
  {
    id: "art-local-first",
    title: "本地优先，才是创作者工具的底气",
    deck: "从密钥边界、稿件版本到多平台发布，解释为什么写作工作台应该先属于作者。",
    markdown: `# 本地优先，才是创作者工具的底气

创作者真正需要的，不是又一个只能联网才能打开的输入框，而是一张**随时可写、可以追溯、能够安全发布**的工作台。

## 为什么先把稿件留在本地

- 原始稿、引用和发布凭证不离开设备
- 每次 AI 改写都形成新修订，不覆盖作者原文
- 网络中断时仍可编辑，恢复后再同步任务

> AI 可以提出建议，但不能悄悄改掉作者的定稿。

## 发布不是“复制粘贴”

同一个观点，到了公众号需要叙事和留白；到了 CSDN 需要结构、代码与检索词；到了头条，则要在开头更快地交代读者收益。

我们的目标不是把同一份 HTML 塞进所有后台，而是保存一份 Markdown 正本，再生成可审核的平台变体。

## 一条可信的流水线

1. 研究 Agent 整理证据
2. 写作 Agent 形成初稿
3. 平台 Agent 生成差异化版本
4. 风险 Agent 检查事实、敏感词与承诺
5. 作者盖下最后一枚“发布印章”

这样，自动化有速度，作者仍然拥有最终决定权。`,
    status: "review",
    updatedAt: "刚刚",
    wordCount: 782,
    channels: ["wechat", "csdn", "toutiao"],
    collection: "产品手记",
  },
  {
    id: "art-agent-team",
    title: "一个写作团队，住进一条工作流",
    deck: "多 Agent 不该互相聊天取乐，而要围绕结构化稿件与证据协作。",
    markdown: `# 一个写作团队，住进一条工作流

多 Agent 的价值不在于“人多”，而在于职责清楚。

## 每个角色只交付一种结果

研究员交付来源清单，主笔交付 Markdown 修订，审校员交付风险报告，平台编辑交付适配建议。所有结果都有结构、有版本，也都可以被人拒绝。

## 并发应该发生在哪里

资料检索、标题备选和平台预览可以并发；最终定稿、合规确认与发布必须经过有序关卡。`,
    status: "draft",
    updatedAt: "12 分钟前",
    wordCount: 436,
    channels: ["wechat", "csdn"],
    collection: "Agent 架构",
  },
  {
    id: "art-social-card",
    title: "让封面先讲清楚文章",
    deck: "社交卡片不是装饰，而是文章在信息流里的第一段摘要。",
    markdown: `# 让封面先讲清楚文章

一张好封面应该先完成信息分层：主题、读者收益、品牌归属。

## 可复用的封面生成协议

将标题、摘要、平台比例、视觉语气和禁用元素交给生图 Skill，返回图片、提示词、模型与授权信息。作者确认后，图片才进入稿件资产库。`,
    status: "ready",
    updatedAt: "昨天",
    wordCount: 319,
    channels: ["wechat", "toutiao"],
    collection: "视觉系统",
  },
];

export const workflowStages: WorkflowStage[] = [
  { id: "research", label: "证据采集", agent: "研究员", state: "pending", optional: true },
  { id: "outline", label: "结构规划", agent: "策划", state: "pending", optional: true },
  { id: "draft", label: "正文写作", agent: "主笔", state: "pending" },
  {
    id: "natural-style",
    label: "自然表达",
    agent: "润色员",
    state: "pending",
    optional: true,
  },
  { id: "review", label: "内容审阅", agent: "审校员", state: "pending", optional: true },
  { id: "risk", label: "风险巡检", agent: "审校员", state: "pending" },
  {
    id: "visual",
    label: "视觉规划",
    agent: "视觉编辑",
    state: "pending",
    optional: true,
  },
];

export const evidenceItems: EvidenceItem[] = [
  {
    id: "ev-1",
    title: "本地优先软件的七项原则",
    source: "Ink & Switch · 2019",
    usedAt: "第 2 段",
    confidence: "高",
  },
  {
    id: "ev-2",
    title: "微信公众平台内容规范",
    source: "平台官方说明",
    usedAt: "风险巡检",
    confidence: "高",
  },
  {
    id: "ev-3",
    title: "多 Agent 协作模式笔记",
    source: "项目研究库",
    usedAt: "流程章节",
    confidence: "中",
  },
];

export const riskItems: RiskItem[] = [
  {
    id: "risk-1",
    severity: "medium",
    title: "绝对化表达",
    detail: "“真正需要”可能过强，建议改为“更需要”。",
    location: "第 1 段",
  },
  {
    id: "risk-2",
    severity: "low",
    title: "数据缺少出处",
    detail: "当前没有量化数据，不影响发布；如补充数字需同步来源。",
    location: "全文",
  },
];

export const platforms: PlatformDefinition[] = [
  {
    id: "wechat",
    name: "微信公众号",
    shortName: "公众号",
    limit: "长文 · 图文混排",
    status: "not_connected",
  },
  {
    id: "csdn",
    name: "CSDN",
    shortName: "CSDN",
    limit: "技术长文 · Markdown",
    status: "not_connected",
  },
  {
    id: "toutiao",
    name: "今日头条",
    shortName: "头条",
    limit: "信息流 · 强开场",
    status: "not_connected",
  },
];

export const initialTasks: TaskRecord[] = [
  {
    id: "task-38",
    title: "本地优先，才是创作者工具的底气",
    platform: "wechat",
    status: "queued",
    scheduledFor: "今天 20:30",
  },
  {
    id: "task-37",
    title: "让封面先讲清楚文章",
    platform: "toutiao",
    status: "blocked",
    scheduledFor: "等待连接",
  },
  {
    id: "task-31",
    title: "一个写作团队，住进一条工作流",
    platform: "csdn",
    status: "done",
    scheduledFor: "昨天 18:10",
  },
];
