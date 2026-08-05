# `awesome-llm-apps` 模板导览与 Open Publisher 适配评估

> 调研对象：[Shubhamsaboo/awesome-llm-apps](https://github.com/Shubhamsaboo/awesome-llm-apps)，检查版本：`9f1f80a`（2026-07-30）。
>
> 这个仓库是相互独立的示例集合，并不是一套可以整体嵌入的 SDK。本文把每个可独立理解的模板说明为：它接收什么输入、核心过程和产出是什么，以及它对 Open Publisher 的实际价值。框架课程按一套教程说明，不把每个教学文件重复当成产品。

## 先给结论

Open Publisher 不应该引入这个仓库所使用的 Agno、Google ADK、OpenAI Agents SDK、CrewAI、CopilotKit、Firecrawl、Exa 等运行时。我们已经有 Tauri/Rust、TypeScript/Pi Agent Core、Tavily、Markdown/媒体/工作流事件模型，继续保持这一条主线。

最值得吸收的是四类模式：

1. `ai_journalist_agent` 的“有来源的研究 -> 写作 -> 有限编辑”流程。
2. `devpulse_ai` 的“数据收集和去重用确定性代码，模型只做判断”的边界。
3. `ai-deep-research-agent` 的工具调用可视化和可回看的研究工作区。
4. `agentic_typed_rag_pydanticai` 的证据不足时不编造、引用绑定到具体来源的规则。

下面标记含义：`直接借鉴` 是可以落进当前架构的模式；`后续可选` 代表产品成熟后再做；`不建议引入` 指用途不相关、依赖过重或风险不合适。

## Agent Skills

| 模板 | 它做什么 | 亮点与适配判断 |
| --- | --- | --- |
| Project Graveyard | 扫描本地项目和 Git 历史，识别长期停滞的项目，解释项目为什么停止，并建议继续、归档或收尾。 | 输出的是“决策和下一步”而不是泛泛总结。与发文无直接关系，但它的诊断报告格式可参考。`不建议引入`。 |
| Scope Creep Detector | 对照任务说明和 Git diff，判断当前改动是否超出目标，并给出保留、拆分或说明理由的建议。 | 对开源项目维护很实用，可用于我们自己的 PR/提交检查。`后续可选`，不属于产品功能。 |
| Commit Archaeologist | 追溯某文件或代码块的引入提交、后续修改和共改文件，从 Git 线索还原当初设计意图。 | 是代码维护 Skill，不是业务 Agent。`不建议引入`。 |
| Advisor Orchestrator Worker | 用“顾问给方向、编排者拆任务、工作者执行”的三级角色完成复杂编码任务。 | 展示了模型角色分工，但多一层模型不等于更可靠；Open Publisher 的调度应由产品 Harness 负责。`只借鉴职责边界`。 |
| Self-Improving Agent Skills | 对一个 Skill 执行任务、评测结果、修改 Skill、重新评测，形成迭代闭环。 | 未来可用于验证用户自定义写作 Skill 是否真的改善文章质量。当前缺少稳定评测集，不能自动改生产提示词。`后续可选`。 |
| Thinking Out Loud | 把 Agent 的计划、当前工具调用和阶段性结论显式呈现给用户。 | 很适合映射到我们已有的 workflow event：用户应看到“正在检索/写作/配图/插入”，而不是黑盒等待。`直接借鉴`。 |
| Skill Evals | 定义样例输入、期望行为和安全检查，用自动化方式评估一个 Skill。 | 是用户可添加 Skill 的必要保障方向。先实现静态校验、权限声明和手工试运行，再谈自动优化。`后续可选`。 |

## Starter AI Agents

| 模板 | 它做什么 | 亮点与适配判断 |
| --- | --- | --- |
| AI Blog to Podcast | 输入博客 URL，抓取正文，提炼脚本并生成可收听的播客。 | 证明一篇文章可以二次分发为音频。未来可作为“文章发布后的内容复用”，不是首版写作链路。`后续可选`。 |
| AI Breakup Recovery | 多个对话角色根据用户描述提供情绪支持和行动建议。 | 是对话人格与安全边界示例，领域不相关。`不建议引入`。 |
| AI Data Analysis | 用户上传 CSV/Excel 后用自然语言提问，Agent 调用数据分析工具返回结论。 | 对产品数据、运营数据写成文章很有价值。可把“数据文件 -> 事实表 -> Writer”作为未来输入类型。`后续可选`。 |
| AI Data Visualization | 读取数据后根据用户问题生成图表。 | 可用于技术文章中的统计图，而不是把截图交给模型描述。需要确定数据源与图表导出格式后再做。`后续可选`。 |
| AI Life Insurance Advisor | 通过问答收集条件，给出保险覆盖建议。 | 重点是表单输入转结构化约束；写作项目可复用“先收集约束、后生成”的交互思想。`仅参考交互`。 |
| AI Medical Imaging | 用多模态模型分析 X 光或医学影像并生成诊断性描述。 | 医疗风险高且和发文无关，仅展示图像输入能力。`不建议引入`。 |
| AI Meme Generator (Browser) | 让浏览器自动访问在线工具并制作梗图，而非直接调用图像 API。 | 浏览器自动化对站点变化、登录态和风控敏感；不适合作为文章配图基础。`不建议引入`。 |
| AI Music Generator | 从文字提示词生成 MP3。 | 可以延伸为视频号/播客配乐，但不解决文章核心问题。`后续可选`。 |
| AI Reasoning Agent | 同时提供在线模型和本地模型的推理问答实现。 | 适合参考模型供应商适配和本地回退，不应把“深度思考模型”默认用于写作。`参考模型适配`。 |
| AI Startup Trend Analysis | 从网页或公开数据提炼创业公司与行业趋势。 | 很适合发展成“行业趋势 -> 候选选题”的输入 Agent；产出应是可编辑选题卡而不是直接发文。`后续可选`。 |
| AI Travel Agent | 根据目的地、预算、天数生成行程。 | 展示约束收集和结构化计划，对文章项目只可借鉴输入 schema。`不建议引入`。 |
| Gemini Multimodal Agent | 联合图片、视频理解与网页搜索回答问题。 | 与“用户给素材图，让模型决定插入位置”直接相关。当前 Visual Agent 已覆盖基础能力，可参考其多模态上下文组织。`直接借鉴模式`。 |
| Mixture of Agents | 多个模型分别回答同一问题，再由聚合模型选择或综合答案。 | 能提高某些问答质量，但会成倍增加成本、延迟并让事实责任不清。文章默认流程不采用。`不建议默认使用`。 |
| OpenAI Research Agent | 先判断问题，再让研究角色收集资料，最后由编辑整合为带来源的答案。 | “研究结果是 Writer 的受控输入”很适合我们；保留 Tavily 与 Pi Harness，不引入 OpenAI SDK。`直接借鉴结构`。 |
| Web Scraping AI Agent | 用户描述要抽取的内容，Agent 访问网页并按目标抽取字段。 | 可作为 Tavily 搜索结果打不开或用户指定 URL 时的受控补充。必须限制域名、超时和下载大小。`后续可选`。 |
| xAI Finance Agent | 结合实时市场数据回答股票和金融问题。 | 是外部实时数据工具封装示例，领域无关。`不建议引入`。 |

## 高级单 Agent

| 模板 | 它做什么 | 亮点与适配判断 |
| --- | --- | --- |
| AI Agent Governance | 给 Agent 的工具调用加策略、沙箱和权限约束。 | 对用户安装 Skill 或将来接 MCP 很重要：Skill 应声明网络、文件和账号权限。`后续可选`。 |
| AI Consultant | 调研市场信息后给出战略和商业建议。 | “研究 -> 观点 -> 建议”可以用于产品文章选题，但不是正文写作引擎。`后续可选`。 |
| AI Customer Support | 使用知识与工具处理客服问题。 | 可借鉴结构化工单和人工升级机制，业务本身无关。`不建议引入`。 |
| AI Deep Research | 用搜索和网页抓取对主题做深度资料研究，再输出报告。 | 问题拆解、资料收集、证据汇总值得借鉴；其 Firecrawl/OpenAI 依赖不应进入当前项目。`直接借鉴模式`。 |
| AI Email GTM Reachout | 根据公司和目标联系人生成个性化外联邮件。 | 可参考“目标受众 -> 语气/卖点”的约束转换，不应用于批量营销。`仅参考提示词结构`。 |
| AI Fraud Investigation | 交叉公共记录和多种资料，找出相互矛盾的风险信号。 | 可参考“主张必须有来源支持、冲突要显式标记”的事实检查规则。`直接借鉴核验思想`。 |
| AI Health & Fitness | 根据目标、饮食和身体条件生成训练计划。 | 是表单约束到计划输出的案例，领域无关。`不建议引入`。 |
| AI Investment Agent | 调用 Yahoo Finance 等数据源比较股票并生成报告。 | 适合作为实时数据工具与报告模板范例，不能用于一般文章流程。`不建议引入`。 |
| AI Journalist | 搜索角色找资料，写手生成文章，编辑修订并输出成稿。 | 与 Open Publisher 最接近。我们应把检索设为可选、编辑限制为一次有差异的审阅，避免无止境多 Agent 循环。`重点参考`。 |
| AI Meeting Agent | 在会前搜集参会方、行业和议题DevPulse AI，输出会议情报包。 | 适合参考“先做 Brief 再写作”的资料包形式。`仅参考产物结构`。 |
| AI Movie Production | 用一句故事概念生成剧本初稿、角色和选角想法。 | 是创意扩写案例，适合学习创意约束，不适合技术文章。`不建议引入`。 |
| AI Personal Finance | 根据用户收入、支出和目标给出财务分析。 | 结构化输入与解释型输出可借鉴，领域无关。`不建议引入`。 |
| AI Recipe & Meal Planning | 根据食材、偏好和限制设计菜单与做法。 | 可参考模板化 Markdown 输出、不可违反的约束。`仅参考提示词设计`。 |
| AI Startup Insight with FIRE-1 | 通过 Firecrawl 的研究能力分析创业公司或市场机会。 | 产品方向与选题雷达有交集，但依赖特定外部服务。`后续可选，改用 Tavily`。 |
| AI System Architect R1 | 使用推理模型和评审模型审查软件架构。 | 可用作我们团队内部架构评审，不是面向用户的写作功能。`不建议纳入产品`。 |
| Earnings Call Analyst | 解析财报电话会视频或文字，按时间轴提炼经营要点。 | 未来可把长视频/发布会转文章选题与引用素材。`后续可选`。 |
| Research Planner & Executor | 维护有状态的研究会话，分阶段执行研究，并可自动生成信息图。 | 很适合深度专题模式，但首版无需复杂持久研究会话。`后续可选`。 |
| Windows Use Autonomous Agent | 让 Agent 直接观察和操作 Windows 应用。 | 桌面自动化难以稳定、权限过大；不应拿它做发布或写作。`不建议引入`。 |

## 高级多 Agent 与 Agent Team

| 模板 | 它做什么 | 亮点与适配判断 |
| --- | --- | --- |
| AQI Analysis Agent | 多角色分析空气质量、天气与健康影响并给出建议。 | 是多源数据合并范例，业务不相关。`不建议引入`。 |
| AI Domain Deep Research | 自动拆分研究问题，多源取证后写出领域报告。 | 可转为“深度文章研究模式”；必须给每个来源保留 URL、摘录和检索时间。`后续可选`。 |
| AI Email GTM Outreach | 多角色制定目标客户、调研和外联内容。 | 多角色链路较长，适合营销业务，不适合文章核心。`不建议引入`。 |
| AI Financial Coach | 预算、债务、储蓄各角色协作给个人财务方案。 | 展示“多个角色围绕同一结构化状态”的做法，领域无关。`仅参考状态设计`。 |
| AI Home Renovation | 输入房间图片与偏好，提出装修方案并生成改造图。 | 图片理解 -> 生成 -> 方案展示的闭环可参考，但比文章配图复杂得多。`不建议直接复用`。 |
| AI Mental Wellbeing | 多个支持角色共同生成心理支持计划。 | 高风险领域，不应作为产品功能。`不建议引入`。 |
| AI Negotiation Battle Simulator | 买方、卖方和编排者模拟谈判回合。 | 是回合制多 Agent 示例，写文章不需要对抗式生成。`不建议引入`。 |
| AI News and Podcast Agents (Beifong) | 管理信源、搜索、抓取、脚本、配图、音频、任务队列和播客发布。 | 与内容生产相邻，但它是一整个信息产品，依赖数据库、队列和多服务；可参考任务状态、来源管理和失败重试。`只借鉴工程模式`。 |
| AI Self-Evolving Agent | 根据结果自动修改自身工作流与策略。 | 没有稳定评测时自动改工作流会劣化且难审计。`不建议引入`。 |
| AI Speech Trainer | 听用户演讲并由多个角色给反馈。 | 可参考“分项评分再综合”的审稿模式。`仅参考评审结构`。 |
| DevPulse AI | 先确定性地采集 GitHub、HN、arXiv 等信号并去重，再由相关性、风险、综合角色形成日报。 | 这是最佳架构参考：检索、去重、缓存、排序不是 Agent；模型只做需要判断的工作。`重点参考`。 |
| Multi-Agent Researcher | Hacker News 搜索、网页搜索、文章阅读三个角色合作，再生成报告/博客/社媒文案。 | 可借鉴“来源资料包”作为明确 artifact；我们用 Tavily 和现有资料模型实现。`重点参考`。 |
| Multi-Agent Trust Layer | 给 Agent 间消息、身份和工具调用加信任层。 | 对大量服务化 Agent 有价值，当前单机桌面端过重。`不建议引入`。 |
| Product Launch Intelligence | 分析竞品定位、舆情和公开指标，形成产品发布情报。 | 未来非常适合“产品发布文章”的资料包和角度建议。`后续可选`。 |
| Trust-Gated Research Team | 研究、分析、写作之间设置信任门槛，并用哈希链保留审计记录。 | 不需要主观信任分，但可保留输入、模型、来源、生成版本的不可变运行快照。`直接借鉴审计方式`。 |
| AG2 Adaptive Research Team | 按问题路由不同研究角色，失败时切换回退路径。 | 值得参考路由与回退，不需要引入 AG2。`后续可选`。 |
| AI Competitor Intelligence Team | 爬竞品官网，分别抽取定位、功能和差异点，最终对比。 | 可做竞争产品文章或发布前竞品研究；需重视站点许可与抓取规则。`后续可选`。 |
| AI Finance Agent Team | 多个金融分析角色协作输出市场意见。 | 只是极简 Agent Team 演示。`不建议引入`。 |
| AI Game Design Team | 世界观、玩法、美术等角色共同产出游戏概念。 | 可参考角色分工，但写文章没必要拆到如此细。`不建议引入`。 |
| AI Legal Team | 合同、法律研究和策略角色协作。 | 高风险垂直领域，不适用。`不建议引入`。 |
| AI Real Estate Team | 房源检索、市场分析、推荐协作。 | 是外部工具编排案例，业务不相关。`不建议引入`。 |
| AI Recruitment Team | 简历筛选、匹配和面试安排。 | 可参考多步骤业务状态机，不适用于内容生产。`不建议引入`。 |
| AI Sales Intelligence Team | 研究客户和竞争对手，生成销售战卡。 | 其“证据 -> 可编辑战卡”可参考成“证据 -> 文章 Brief”。`仅参考产物结构`。 |
| AI SEO Audit Team | 抓取网站、分析 SERP 和内容模式，输出 SEO 优化建议。 | 适合以后为 CSDN、搜索型文章提供标题、关键词、问答和差异化角度；不需要先引入 Firecrawl。`后续可选`。 |
| AI Services Agency | 用 CrewAI 扮演数字代理公司，收集需求并规划软件项目。 | 有用的是软件项目分解流程，不是写作项目架构。`不建议引入`。 |
| AI Teaching Team | 多个教师角色生成学习路径和课程内容。 | 可转化为系列教程的章节大纲，但正文无需团队全开。`后续可选`。 |
| AI Travel Planner Team | 目的地、机酒、预算、餐饮、行程角色共同产出旅行计划。 | 是完整服务编排示例，工程量大且领域无关。`不建议引入`。 |
| AI VC Due Diligence Team | 多维研究初创公司，产出投资尽调材料。 | 可参考“每一条结论对应证据”的报告模型。`仅参考证据结构`。 |
| Multimodal Coding Team | 识别题目截图、编写代码并在沙箱验证。 | 可参考“先抽取图像信息、再执行工具验证”的闭环；与文章无直接关系。`不建议引入`。 |
| Multimodal Design Team | 多位设计角色审查设计素材并给出改进。 | 可作为未来封面图/文章视觉检查的参考。`后续可选`。 |
| Multimodal UI/UX Feedback Team | 分析页面截图并生成改进版本。 | 对 Open Publisher 自身界面设计有参考价值，但不是终端用户功能。`仅用于内部设计`。 |

## 持续运行、语音、生成式 UI、MCP 与游戏

| 模板 | 它做什么 | 亮点与适配判断 |
| --- | --- | --- |
| Always-on Hacker News Briefing | 定时抓取 Hacker News，排序、总结后投递 Slack 或邮件。 | 可发展为“技术趋势选题雷达”；应先支持本地/手动执行和 dry-run，再做后台定时。`后续可选`。 |
| Release Radar | 监听依赖发布，识别破坏性、安全和重大更新，再生成摘要。 | 很适合 Wandao/Open Publisher 自身的更新日志选题，但不进入普通文章工作流。`后续可选`。 |
| AI Audio Tour | 基于位置、兴趣和步行节奏生成语音导览。 | 语音输出示例，领域无关。`不建议引入`。 |
| Customer Support Voice | 以语音形式回答基于自有文档的问题。 | 可参考语音 RAG，和文章产品无直接关系。`不建议引入`。 |
| Insurance Claim Live Team | 使用实时语音模型完成保险报案和初步理赔流程。 | 实时会话和结构化表单结合很完整，但领域与风险均不适合。`不建议引入`。 |
| Voice RAG (OpenAI SDK) | 对 PDF 提问并将答案合成为语音。 | 可做无障碍阅读扩展，不解决首要问题。`后续可选`。 |
| Generative UI Starter | 用户和 Agent 共同操作一个聊天驱动的看板。 | 可参考“生成结果不是纯文本，而是可编辑结构化卡片”。`参考交互`。 |
| Generative UI Financial Coach | 将预算、债务、储蓄计划渲染为可交互卡片。 | 可参考文章 Brief、来源、检查项的卡片化展示。`参考交互`。 |
| AI Dashboard Canvas | 用户用聊天描述指标，系统动态拼装图表面板。 | 偏通用仪表盘，不应把可视化生成器引入编辑器。`不建议引入`。 |
| AI MCP App Builder | 用自然语言生成一个 MCP 应用，并在沙箱中运行。 | 动态执行用户生成代码安全风险很高，不适合桌面端。`不建议引入`。 |
| MCP Apps Generative UI Showcase | 展示 MCP 工具返回交互 UI，如航班搜索表单。 | 可参考“工具结果可视化”，不能直接带入其 Next.js/CopilotKit 栈。`参考交互`。 |
| AI Shadcn Component Generator | 由聊天生成可用的 shadcn UI 组件。 | 对我们前端组件没有直接价值，且技术栈不一致。`不建议引入`。 |
| AI Deep Research Generative UI | 每次检索、抓取和分析都会展示为实时工具卡和侧边工作区。 | 最适合借鉴到当前文章页：用户能看到来源、Agent 状态、失败原因和重试。`重点参考`。 |
| Browser MCP Agent | 经 MCP 用自然语言驱动真实浏览器。 | 对受用户授权的网站操作有价值，但发布平台需专用、可审计的 connector，不能让模型任意浏览。`后续可选`。 |
| GitHub MCP Agent | 通过 MCP 浏览和分析 GitHub 仓库。 | 可用于“根据仓库更新写技术文章”这个专用工具。`后续可选`。 |
| Notion MCP Agent | 通过 MCP 查询 Notion 页面。 | 可把 Notion 文档作为文章资料源，前提是用户显式授权。`后续可选`。 |
| Travel Planner MCP Team | 通过 Airbnb、地图等 MCP 数据生成旅行计划。 | 说明 MCP 适合接数据和动作工具，业务不相关。`不建议引入`。 |
| Multi-MCP Intelligent Assistant | 同时连接多个 MCP 服务器并按任务调用。 | 可参考多工具配置和生命周期管理。`后续可选`。 |
| Multi-MCP Agent Router | 根据意图把任务分给只加载必要 MCP 工具的专属 Agent。 | 是用户自定义 Skill/MCP 的正确安全方向：最小权限、白名单和手工授权。`后续可选`。 |
| AI 3D PyGame Visualizer | 推理模型写 PyGame，浏览器 Agent 运行和验证画面。 | 用于学习代码执行与验证闭环，不适用于发文。`不建议引入`。 |
| AI Chess Agent | 两个 Agent 对弈，系统校验棋步合法性。 | “模型生成动作必须由确定性规则校验”很重要，可类比 Markdown/发布参数校验。`参考校验原则`。 |
| AI Tic-Tac-Toe Agent | 两个不同模型轮流下棋。 | 纯多 Agent 演示，对写作没有直接用途。`不建议引入`。 |

## RAG、记忆、聊天与优化应用

| 模板 | 它做什么 | 亮点与适配判断 |
| --- | --- | --- |
| Agentic RAG with EmbeddingGemma | 在本地用 EmbeddingGemma 和 Llama 做 Agentic RAG。 | 适合未来无 API Key 的本地知识库方案。`后续可选`。 |
| Agentic RAG with GPT-5 | 使用 GPT-5 的工具调用和检索能力进行 RAG。 | 供应商特定示例，不应锁定我们的模型层。`仅参考工具接口`。 |
| Agentic RAG Math Agent | 检索数学资料、给答案并依反馈修正。 | 展示受限的反馈循环，文章审稿可借鉴“一次限定修订”。`参考循环边界`。 |
| Agentic RAG with Reasoning | 显式展示检索与推理步骤。 | 可借鉴阶段可视化，但不要向终端用户暴露原始模型思维链。`参考事件展示`。 |
| Typed Agentic RAG (PydanticAI) | 以结构化 schema 约束答案、引用和拒答，证据不足时不编造。 | 最适合未来品牌资料库与事实型文章：来源、引文、置信状态应是数据字段。`重点参考`。 |
| AI Blog Search (LangGraph) | 对博客内容做 LangGraph 检索、改写问题和回答。 | 作为历史检索/改写案例有参考价值；运行时保持 Pi Harness，不为此引入 LangGraph。`后续可选`。 |
| Autonomous RAG | 对 PDF 问答，内部判断是检索内部资料还是联网补充。 | 可参考路由策略；使用时必须提示用户哪些内容来自网络。`后续可选`。 |
| ContextualAI RAG Agent | 调用托管 RAG 服务快速搭建有依据的问答。 | 供应商专用，不适合当前本地优先桌面端。`不建议引入`。 |
| Corrective RAG | 给检索结果评分，质量不足就改写查询并联网回退。 | 当我们真的有本地知识库后很有用；仅有 Tavily 搜索时不应先造向量库。`后续可选`。 |
| DeepSeek Local RAG | 用本地 DeepSeek 模型对私有文档做推理检索。 | 可为离线写作用户提供方案，但模型体积会显著扩大安装包。`后续可选`。 |
| Gemini Agentic RAG | 使用 Gemini 思考模型进行查询改写和联网回退。 | 是特定供应商实现，保留模式不保留依赖。`仅参考模式`。 |
| Hybrid Search RAG | 关键词检索与向量检索结合，再交给模型回答。 | 未来资料多时优于纯向量检索；当前模板库规模不需要。`后续可选`。 |
| Knowledge Graph RAG with Citations | 将资料组织为知识图谱，支持多跳检索与可核验引用。 | 适用于复杂研究，不适合首版文章工具。`不建议近期引入`。 |
| Llama 3.1 Local RAG | 本地解析网页并离线问答。 | 适合隐私场景的资料输入，需评估本地模型下载成本。`后续可选`。 |
| Local Hybrid Search RAG | 完全本地的关键词加向量混合检索。 | 可作为长期本地品牌知识库底座候选。`后续可选`。 |
| Local RAG Agent | Llama 3.2 + Qdrant 构建无需 API Key 的本地文档问答。 | Qdrant 会增加进程和安装包复杂度，暂不引入。`不建议近期引入`。 |
| Multimodal Agentic RAG | 针对文本、PDF、图片、音频、视频统一检索并带引用。 | 对“上传图片、文档、视频作为写作素材”很有前景，但首版只应先支持图片和 Markdown。`后续可选`。 |
| Qwen Local RAG | 使用本地 Qwen 推理模型访问私有资料。 | 和国内模型生态相符，但同样有安装体积和硬件门槛。`后续可选`。 |
| RAG Agent with Cohere | Cohere 模型结合检索和 Web 回退。 | 供应商案例，架构价值有限。`不建议引入`。 |
| Basic RAG Chain | 用最小链路对专业资料检索问答。 | 是理解 RAG 基础的教学样例，不足以支撑产品级引用。`仅作学习参考`。 |
| RAG with Database Routing | 对问题判断后路由到正确的数据库。 | 当用户拥有模板、历史文章、品牌资料多个库时很有价值。`后续可选`。 |
| RAG Failure Diagnostics Clinic | 诊断召回、排序、上下文、回答等哪个环节导致错误。 | 很适合未来的 RAG 调试台和评测，不是用户首要功能。`后续可选`。 |
| RAG-as-a-Service | 用极少代码封装出可调用的 RAG 服务。 | 服务化思路与桌面端本地 sidecar 不同。`不建议直接引入`。 |
| Vision RAG | 对图像和 PDF 页面做语义检索并回答问题。 | 可强化图片素材理解和图文引用。`后续可选`。 |
| AI ArXiv Agent with Memory | 搜论文时记住用户长期研究兴趣。 | 可类比记住用户关注领域和选题偏好，但记忆必须可查看、编辑、关闭。`后续可选`。 |
| AI Travel Agent with Memory | 在多次对话中保存用户偏好。 | 展示会话持久化，业务无关。`仅参考存储方式`。 |
| Llama3 Stateful Chat | 让本地聊天在会话之间保留状态。 | 可参考本地会话/草稿恢复。`参考持久化`。 |
| Personalized Memory App | 长期保存用户事实并在后续对话中调用。 | 对品牌口吻、禁用词、受众偏好有价值；必须让用户可删除。`后续可选`。 |
| Local ChatGPT with Memory | 本地聊天加每用户记忆。 | 适合本地隐私思路，不是文章工作流。`不建议直接引入`。 |
| Multi-LLM Shared Memory | 让多个模型读取同一份会话记忆。 | 对多个 Agent 共享文章状态有启发，但我们已有 Pi 会话和 Markdown 持久状态，应避免另一套记忆。`仅参考状态一致性`。 |
| Chat with GitHub | 对仓库内容做 RAG 问答。 | 可作为“从 Git 更新自动组织文章资料”的资料源。`后续可选`。 |
| Chat with Gmail | 对邮箱提问和检索。 | 涉及敏感邮件权限，不建议首期接入。`不建议近期引入`。 |
| Chat with PDF | 对 PDF 做问答。 | 非常常见的资料导入方式，未来文章参考资料可支持。`后续可选`。 |
| Chat with Research Papers | 对 arXiv 论文做检索和问答。 | 适合技术深度文章的研究输入。`后续可选`。 |
| Chat with Substack | 对订阅通讯的历史内容问答。 | 可以是外部内容研究工具，版权和抓取许可需先处理。`后续可选`。 |
| Chat with YouTube Videos | 提取视频字幕后问答。 | 很适合把发布会、教程视频转为文章素材。`后续可选`。 |
| Streaming AI Chatbot | 从模型流式响应到 UI 的最小聊天实现。 | 可参考传输与取消语义；当前文章页的打字机效果应建在真实 token/event 流上。`直接借鉴模式`。 |
| ThinkPath Chatbot | 强调思考路径和对话引导的聊天应用。 | 可参考解释性 UI，不应暴露模型原始推理。`仅参考交互`。 |
| Chat with Tarots | 塔罗主题 NLP 聊天应用。 | 娱乐项目，与写作无关。`不建议引入`。 |
| LLM Router App | 根据任务把请求路由到合适模型。 | 我们已有模型配置需求，可借鉴“按任务选模型”，但规则必须透明、可覆盖。`后续可选`。 |
| Local ChatGPT Clone | 本地聊天界面实验。 | 可参考本地模型调用，不需要再造聊天产品。`不建议引入`。 |
| GPT-OSS Critique Improvement Loop | 生成多份候选、综合、批评、改写，反复提升文本。 | 可做“高质量模式”：最多一次审稿和一次重写；默认启用会慢且贵。`后续可选`。 |
| Multimodal Video Moment Finder | 在视频中找与主题匹配的片段和时刻。 | 可为文章挑选配套视频片段，属于内容扩展。`后续可选`。 |
| Resume Job Matcher | 比较简历与岗位描述的匹配程度。 | 可参考两个文档的结构化对比，不属于内容发布。`不建议引入`。 |
| Toonify Token Optimization | 将数据转为 TOON 等紧凑格式以减少 token。 | 当资料包和多篇文章很多时可降低成本；先测质量再启用。`后续可选`。 |
| Headroom Context Optimization | 自动压缩上下文以显著降低 token 消耗。 | 可用于历史文章和来源摘要压缩，但不能压掉引用原文。`后续可选`。 |
| Gemma 3 Fine-tuning | 用 4-bit LoRA 微调 Gemma。 | 微调适合大量稳定风格数据后的专用模型，当前不值得增加训练维护成本。`不建议近期引入`。 |
| Llama 3.2 Fine-tuning | 用简化脚本在 Colab 等环境微调 Llama。 | 同上，只能作为长期研究。`不建议近期引入`。 |

## 两套框架课程

| 教程 | 覆盖内容 | 对当前项目的判断 |
| --- | --- | --- |
| Google ADK Crash Course | 基础 Agent、模型无关调用、结构化输出、内置/函数/第三方/MCP 工具、会话和持久记忆、生命周期回调、插件、串行/循环/并行多 Agent，以及 YAML 研究团队。 | 这些概念由 Pi Agent Core 和产品 Harness 覆盖；不应为了教程再引入 ADK。最值得看的是结构化输出、工具权限和并行的条件。 |
| OpenAI Agents SDK Crash Course | Agent 基础、函数调用、结构化输出、上下文、guardrail、session、handoff、追踪、语音，以及并行执行和 Agent-as-tool。 | 能帮助理解 Agent 设计，但会绑定 OpenAI SDK。我们应在 Pi Harness 中实现同等的事件追踪、取消、超时、重试和结构化状态。 |

## 对 Open Publisher 的落地顺序

不恢复已经移除的“批量生文”界面。先把单篇的可信生产流程做扎实，再基于同一套 artifact 和任务模型讨论批量。

```text
用户 Brief
  -> 可选研究包：Tavily 搜索、缓存、URL 去重、来源摘录
  -> Research Analyst：仅对资料做取证、选角度、列出不确定项
  -> Writer：依据模板、资料包、用户素材流式生成 Markdown
  -> 并行执行：Quality Reviewer + Visual Agent
  -> 确定性工具：Markdown 图片插入、文件存储、版本保存
  -> 用户审阅后，再进入平台发布 Connector
```

这里的原则是：搜索、缓存、去重、模板展开、Markdown 修改、图片下载、平台发布都是工具；只有“理解资料、写作、审稿、视觉位置规划”才是模型任务。这样既能保留多 Agent 的可配置能力，也不会再出现为了分 Agent 而分 Agent 的冗余和卡顿。

## 许可证提示

仓库根目录为 Apache-2.0，允许修改、商用与再发布，但需要保留许可证、版权声明和 NOTICE（如有）。不过每个示例可能依赖外部项目，例如 CopilotKit、Firecrawl、Agno 等；复制具体代码前必须逐个确认依赖的许可证，不能把“仓库根协议”误认为所有嵌入依赖都自动是 Apache-2.0。
