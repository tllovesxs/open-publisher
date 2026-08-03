import type { MarkdownTemplate, StudioAgent, StudioSkill } from "../types";

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
      "先通读全文，只在图片确实能帮助理解时规划位置，避免把比喻按字面画出来。按信息结构选择图形类型：数据或技术概念用信息图，过程用流程图，选项用对比图，模型用框架图，时间演进用时间线，叙事才用场景图。每项必须放在文章实际存在的小节标题之后，替代文本描述图片真正表达的内容。优先使用作者提供的素材且不重复；缺少素材时才写生图提示词。生成提示词应突出该小节的核心概念与关系，全文保持一致的风格和配色，并且不包含可读文字、品牌标识、人物肖像、水印或未经证实的数据。只输出配图计划，不改写文章或直接生成图片。",
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

export const defaultTemplates: MarkdownTemplate[] = [
  {
    id: "tech-explainer",
    name: "技术解读",
    description: "适合版本更新、架构说明和技术复盘。",
    category: "技术文章",
    markdown: `# {{title}}

{{lead}}

## 先说结论

{{key_takeaway}}

## 为什么值得关注

{{context}}

## 实现与取舍

{{details}}

## 结语

{{closing}}`,
    styleProfile: {
      tone: "专业、清晰、克制",
      audience: "希望快速理解技术变化的开发者",
      perspective: "作者解释者视角",
      sentenceStyle: "长短句交替，先结论后解释",
      pacing: "每节一个重点，段落之间有明确递进",
      density: "中等信息密度，避免连续堆砌术语",
    },
    structureProfile: {
      openingPattern: "开头先给出背景和一句可执行的结论",
      sectionPattern: "结论 -> 背景 -> 实现细节 -> 取舍",
      conclusionPattern: "用一段话总结影响，并给出下一步建议",
      headingDepth: "一级标题用于题目，二级标题用于主要章节",
      paragraphPattern: "每段 2-5 句，复杂内容拆成列表",
    },
    layoutProfile: {
      useLists: true,
      useTables: false,
      useBlockquotes: false,
      useCodeBlocks: true,
      imagePlacement: "放在解释核心概念的小节正文之后",
      emphasisRules: "只强调关键名词或结论，不连续加粗",
    },
    fixedBlocks: [],
    variables: ["title", "lead", "key_takeaway", "context", "details", "closing"],
    usageInstructions: "保留技术事实和限制条件，不要把模板占位符原样输出。",
    isBuiltIn: true,
  },
  {
    id: "tutorial",
    name: "实战教程",
    description: "适合可复现的步骤型文章。",
    category: "教程",
    markdown: `# {{title}}

{{lead}}

## 适合谁

{{audience}}

## 准备工作

{{prerequisites}}

## 操作步骤

1. {{step_one}}
2. {{step_two}}
3. {{step_three}}

## 常见问题

{{faq}}`,
    styleProfile: {
      tone: "耐心、直接、可操作",
      audience: "需要跟着步骤完成任务的实践者",
      perspective: "带读者完成任务的教练视角",
      sentenceStyle: "短句为主，每一步只表达一个动作",
      pacing: "准备 -> 操作 -> 验证 -> 排错",
      density: "步骤密度高，但每步留出验证提示",
    },
    structureProfile: {
      openingPattern: "先说明读者将完成什么，以及适用范围",
      sectionPattern: "前置条件后按编号步骤展开，每步包含动作和结果",
      conclusionPattern: "用常见问题收束，并提示可继续探索的方向",
      headingDepth: "二级标题作为步骤章节，三级标题只用于排错",
      paragraphPattern: "步骤短段落配合编号列表，避免大段叙述",
    },
    layoutProfile: {
      useLists: true,
      useTables: true,
      useBlockquotes: true,
      useCodeBlocks: true,
      imagePlacement: "放在需要观察界面或输出结果的步骤之后",
      emphasisRules: "命令、按钮和关键参数使用代码或加粗",
    },
    fixedBlocks: [],
    variables: ["title", "lead", "audience", "prerequisites", "step_one", "step_two", "step_three", "faq"],
    usageInstructions: "每一步都要可复现，并说明如何确认执行成功。",
    isBuiltIn: true,
  },
  {
    id: "opinion",
    name: "观点文章",
    description: "适合表达判断，也保留论据与反例。",
    category: "观点文章",
    markdown: `# {{title}}

{{opening_view}}

## 我的判断

{{argument}}

## 支持这个判断的事实

{{evidence}}

## 需要承认的限制

{{limitations}}

## 结论

{{closing}}`,
    styleProfile: {
      tone: "坦率、有立场、允许保留意见",
      audience: "希望了解判断依据的读者",
      perspective: "第一人称判断，兼顾反例",
      sentenceStyle: "关键判断用短句，论据用完整解释",
      pacing: "先亮明判断，再逐层补充证据与限制",
      density: "中等密度，观点与事实明确分开",
    },
    structureProfile: {
      openingPattern: "开头直接给出核心判断，不先铺陈空泛背景",
      sectionPattern: "判断 -> 事实依据 -> 反例或限制",
      conclusionPattern: "重申判断边界，避免把观点写成绝对结论",
      headingDepth: "二级标题承载观点分支",
      paragraphPattern: "一个段落只推进一个论点",
    },
    layoutProfile: {
      useLists: true,
      useTables: false,
      useBlockquotes: true,
      useCodeBlocks: false,
      imagePlacement: "仅在图像能支撑论点时插入",
      emphasisRules: "只强调判断句和关键概念",
    },
    fixedBlocks: [],
    variables: ["title", "opening_view", "argument", "evidence", "limitations", "closing"],
    usageInstructions: "明确区分事实、推断和个人判断，主动承认限制。",
    isBuiltIn: true,
  },
  {
    id: "product-update",
    name: "产品更新",
    description: "适合版本发布、功能更新和变更说明。",
    category: "产品更新",
    markdown: `# {{title}}

{{summary}}

## 这次更新解决了什么

{{problem}}

## 主要变化

- {{change_one}}
- {{change_two}}
- {{change_three}}

## 使用建议

{{guidance}}

## 已知限制

{{limits}}`,
    styleProfile: {
      tone: "简洁、透明、面向用户",
      audience: "关心版本变化和实际影响的产品使用者",
      perspective: "产品团队说明视角",
      sentenceStyle: "先说影响，再给细节和操作建议",
      pacing: "问题 -> 变化 -> 使用 -> 限制",
      density: "高信息密度，但每条变化独立成段",
    },
    structureProfile: {
      openingPattern: "开头用一段话说明本次更新对谁有帮助",
      sectionPattern: "先描述解决的问题，再列出具体变化",
      conclusionPattern: "给出升级或使用建议，并说明已知限制",
      headingDepth: "二级标题对应更新主题",
      paragraphPattern: "变化使用列表，影响和建议使用短段落",
    },
    layoutProfile: {
      useLists: true,
      useTables: false,
      useBlockquotes: false,
      useCodeBlocks: true,
      imagePlacement: "放在展示新功能或界面变化的小节之后",
      emphasisRules: "版本号、功能名和用户收益可适度加粗",
    },
    fixedBlocks: [],
    variables: ["title", "summary", "problem", "change_one", "change_two", "change_three", "guidance", "limits"],
    usageInstructions: "只写已经确认的变化，不夸大收益，不省略已知限制。",
    isBuiltIn: true,
  },
];
