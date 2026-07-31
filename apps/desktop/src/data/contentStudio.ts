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
    id: "image-planning",
    name: "配图编排",
    description: "判断图片位置、说明文字和封面比例。",
    instructions: "仅在图片能帮助理解时插入，为每张图片编写准确替代文本，并避免与正文重复表达。",
    source: "Open Publisher 预置",
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
      "直接回答读者关心的问题。使用短段落、具体名词和可验证的表述，不编造案例或数据。",
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
    name: "配图规划 Agent",
    role: "视觉编辑",
    description: "将已选素材或生成图片放到合适的位置。",
    prompt:
      "只在图片能帮助理解时插入。为每张图片写准确的替代文本，并避免图片与正文重复表达。",
    skillIds: ["image-planning"],
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
    isBuiltIn: true,
  },
];
