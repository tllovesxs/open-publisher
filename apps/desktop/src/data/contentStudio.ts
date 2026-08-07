import type { MarkdownTemplate, StudioAgent, StudioSkill } from "../types";
import { bundledProductPromotionTemplate } from "./productPromotionTemplate";

export const availableSkills: StudioSkill[] = [
  {
    id: "research-brief",
    name: "资料梳理",
    description: "提取来源、事实和待验证信息。",
    instructions: "区分事实、观点和待验证内容。保留可追溯来源，并把无法确认的信息显式标记出来。",
    source: "Open Publisher 预置",
    isBuiltIn: true,
  },
  {
    id: "md-structure",
    name: "Markdown 结构",
    description: "按模板组织标题、段落、列表与引用。",
    instructions: "遵守所选 Markdown 模板的层级，保持标题、段落、列表和引用的语义清晰。",
    source: "Open Publisher 预置",
    isBuiltIn: true,
  },
  {
    id: "natural-chinese",
    name: "自然表达",
    description: "清理套话，保持中文叙述自然直接。",
    instructions: "删除空泛套话和重复结论，使用具体、克制的中文表达，不改变原有事实和立场。",
    source: "Open Publisher 预置",
    isBuiltIn: true,
  },
  {
    id: "risk-review",
    name: "事实与风险审校",
    description: "标记无来源结论、敏感词和过度承诺。",
    instructions: "标记无来源数字、绝对化承诺、敏感表述和易引起误解的结论；只给出可执行的修改建议。",
    source: "Open Publisher 预置",
    isBuiltIn: true,
  },
  {
    id: "baoyu-article-illustrator",
    name: "文章正文配图",
    description: "按文章结构规划位置、图形类型、素材与生成提示词。",
    instructions:
      "先通读全文，只在图片确实能帮助理解时规划位置，避免把比喻按字面画出来。每张图只解决一个视觉问题，优先使用一个主体和不超过三个视觉元素，留出明显留白；不要把整段正文、标题、表格、界面截图或大量标签塞进图片。按信息结构选择图形类型：数据或技术概念用简洁信息图，过程用简洁流程图，选项用简洁对比图，模型用简洁框架图，时间演进用简洁时间线，叙事才用场景图。每项必须放在文章实际存在的小节标题之后，替代文本描述图片真正表达的内容。优先使用作者提供的素材且不重复；缺少素材时才写生图提示词。生成提示词只保留一个核心视觉概念，默认不使用可读文字，最多允许三个极短标签，并且不包含品牌标识、人物肖像、水印或未经证实的数据。只输出配图计划，不改写文章或直接生成图片。",
    source: "JimLiu/baoyu-skills · baoyu-article-illustrator (MIT)",
    isBuiltIn: true,
  },
];

export const defaultAgents: StudioAgent[] = [
  {
    id: "research",
    name: "资料整理 Agent",
    role: "研究员",
    description: "把参考资料整理成可核验的写作依据。",
    prompt:
      "先区分事实、观点和待核验内容。只保留与主题直接相关的来源，并标记无法确认的信息。",
    skillIds: ["research-brief"],
    enabled: true,
    runtimeNodeId: "research",
  },
  {
    id: "outline",
    name: "大纲规划 Agent",
    role: "编辑",
    description: "先确定读者收益，再规划文章结构。",
    prompt:
      "根据主题、模板和读者对象，输出清晰的大纲。每个小节只承担一个信息任务。",
    skillIds: ["md-structure"],
    enabled: true,
    runtimeNodeId: "outline",
  },
  {
    id: "writer",
    name: "写作 Agent",
    role: "主笔",
    description: "依据已确认的结构完成 Markdown 初稿。",
    prompt:
      "直接回答读者关心的问题。涉及具名项目时先核验官方资料或作者素材；没有可验证依据就停止并提示补充资料。使用短段落、具体名词和可验证的表述，不编造能力、案例或数据。",
    skillIds: ["md-structure", "natural-chinese"],
    enabled: true,
    runtimeNodeId: "draft",
  },
  {
    id: "natural-style",
    name: "自然表达 Agent",
    role: "润色编辑",
    description: "把机械表述改成自然、克制的中文。",
    prompt:
      "删除空泛转折和重复结论。保留原有事实与立场，不为追求口语化牺牲准确性。",
    skillIds: ["natural-chinese"],
    enabled: true,
    runtimeNodeId: "natural-style",
  },
  {
    id: "review",
    name: "内容审阅 Agent",
    role: "审校",
    description: "检查结构完整性、读者理解成本和遗漏。",
    prompt:
      "检查标题、开头、论据、结论是否一致。只给出可执行的修改，不重写作者明确表达的观点。",
    skillIds: ["md-structure", "risk-review"],
    enabled: true,
    runtimeNodeId: "review",
  },
  {
    id: "risk",
    name: "风险审核 Agent",
    role: "合规审校",
    description: "在成稿前提示事实、承诺和敏感表达风险。",
    prompt:
      "标记未提供来源的数字、绝对化承诺和可能引起误解的表达。不要替作者作价值判断。",
    skillIds: ["risk-review"],
    enabled: true,
    runtimeNodeId: "risk",
  },
  {
    id: "visual",
    name: "正文配图 Agent",
    role: "视觉编辑",
    description: "按文章结构安排素材和生成图片，并写回合适的位置。",
    prompt:
      "先为每张图确定信息目的和正文位置，再选择作者素材或生成图片。图片应补充正文，不重复文章已经说清的内容。",
    skillIds: ["baoyu-article-illustrator"],
    enabled: true,
    runtimeNodeId: "visual",
  },
];

export const defaultTemplates: MarkdownTemplate[] = [bundledProductPromotionTemplate];
