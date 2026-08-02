# Baoyu Article Illustrator 主 Skill 中文翻译

> 来源：[JimLiu/baoyu-skills](https://github.com/JimLiu/baoyu-skills) 的
> `skills/baoyu-article-illustrator/SKILL.md`。
> 固定版本：`6b7a2e417500561a5ecdd0b168332f4142584617`，上游版本：`1.117.4`。
> 上游采用 MIT 许可证；版权与完整许可证见仓库根目录的 `LICENSE` 及
> [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md)。
>
> 本文是该**主文件**的完整中文翻译。它所引用的 `references/` 下的流程细则、
> 风格库、调色板和提示词模板是独立文件，未混入或改写到本文。

```yaml
name: baoyu-article-illustrator
description: 分析文章结构，识别需要视觉辅助的位置，并以“类型 x 风格 x 调色板”三维方法生成配图。
             当用户要求“为文章配图”“添加图片”或“生成文章配图”时使用。
version: 1.117.4
metadata:
  openclaw:
    homepage: https://github.com/JimLiu/baoyu-skills#baoyu-article-illustrator
```

# 文章配图师

分析文章，识别插图位置，并通过“类型 x 风格 x 调色板”保持所有图片的一致性。

## 用户输入工具

当本 Skill 需要向用户提问时，按以下优先级选择工具：

1. 优先使用当前 Agent 运行时提供的内建用户输入工具，例如 `AskUserQuestion`、
   `request_user_input`、`clarify`、`ask_user` 或等效工具。
2. 若没有该类工具，则输出带编号的纯文本问题，请用户逐项回复所选编号或答案。
3. 若工具支持一次提多个问题，应把所有适用问题合并在一次调用中；若仅支持单题，
   则按优先级逐题询问。

下文的 `AskUserQuestion` 仅为示例；在其他运行时中应替换为本地等效工具。

## 图片生成工具

当本 Skill 需要渲染图片时，以下列顺序决定使用哪个后端：

1. **当前请求指定的后端**：若用户在当前消息中指定了后端，使用它。
2. **已保存偏好**：若 `EXTEND.md` 中的 `preferred_image_backend` 指向当前可用后端，使用它。
3. **自动选择**：当偏好为 `auto`、未设置，或固定后端当前不可用时，按以下顺序选择：

   - **Codex (`imagegen`)**：先检查可用 Skill 或工具列表。若存在名为 `imagegen` 的 Skill，
     说明运行在 Codex 内，必须用 `Skill` 工具调用 `imagegen`。传入已经保存的 Prompt 文件内容，
     并按 Codex `imagegen` 自身参数传入输出路径和宽高比。除非用户明确固定其他
     `preferred_image_backend`，Codex `imagegen` 作为官方位图后端，优先级高于
     `baoyu-image-gen` 等非原生 Skill。
   - **通过 `codex exec` 使用 Codex (`codex-imagegen`)**：若运行时没有原生 `imagegen`，
     但系统路径中存在已经登录的 `codex` CLI，优先通过
     `baoyu-image-gen --provider codex-cli` 调用；若没有 `baoyu-image-gen`，则直接调用
     内置包装器。调用契约、参数、运行时发现过程在
     `references/codex-imagegen.md`，仅当选择本分支时读取该文件。
   - **Cursor (`GenerateImage`)**：若运行时提供原生 `GenerateImage`，说明运行在 Cursor 中，
     它的优先级与 Codex `imagegen` 相同。有两个硬限制：它没有宽高比参数，因此必须在
     传给 `description` 的 Prompt 中明确写出目标比例或尺寸；它也不能指定输出目录，
     因而需要在生成后将文件复制或移动到本 Skill 期望的输出路径，例如
     `outputs/.../NN-xxx.png`。参考图路径传入 `reference_image_paths`。
   - **其他运行时原生工具**：若运行时提供其他原生图片工具，例如 Hermes 的
     `image_generate`，以同样规则使用。
   - 否则，如果只安装了一个非原生后端，例如 `baoyu-image-gen`，使用该后端。
   - 否则，如果存在多个非原生后端而没有原生工具，只向用户询问一次；可与其他初始问题合并。
4. **没有可用后端**：明确告知用户，并询问如何继续。

**严禁**用 SVG、HTML、canvas 或其他代码式渲染代替位图生成。Codex `imagegen` 的定义是：
当输出应为位图资源而非仓库内代码或矢量时使用。若按第 3 步无法找到位图后端，必须回到
第 4 步询问用户；不得悄悄输出 SVG、内联 `<svg>` 或 HTML/CSS 绘图。即使某一节内容看起来
像“图表”，也不能违反此规则，因为调用本 Skill 的上游已决定需要的是位图。

**严禁**通过在已生成位图上涂抹文字来修复图片。不得用 ImageMagick、Pillow、Canvas、SVG、
HTML/CSS、OCR 脚本或其他程序化叠加方式，覆盖、重写、擦除、描边或替换插图内的标签、
说明文字或任何文本。文字错误或不清晰时，应使用修正后的 Prompt 重新生成、以更少或没有
图中文字重新绘制，或询问用户保留哪个不完美候选。

`preferred_image_backend: ask` 会强制在每次运行时执行第 3 步的后端询问，无论当前有哪些
后端可用。用户可按文末“修改偏好”章节修改固定后端。

**Prompt 文件要求（硬性要求）**：调用任何后端前，必须将每张图片完整、最终的 Prompt 写入
`prompts/` 下的独立文件，文件名为 `NN-{type}-[slug].md`。后端接收这个 Prompt 文件或其内容。
该文件是可复现记录，也使得无需重新生成 Prompt 即可切换后端。

`imagegen`、`GenerateImage`、`image_generate`、`baoyu-image-gen` 等名称均为具体示例；在不同
运行时中，应依照相同选择规则使用本地等效工具。

## 批量生成策略

本次运行的每一个 Prompt 文件保存并验证后，默认以批量方式生成图片。

优先级如下：

1. 若选中的后端支持原生批量或多任务接口，优先使用。每项任务都必须保留各自的 Prompt 文件、
   输出路径、宽高比和直接参考图。
2. 若后端不支持原生批量、但运行时支持并行工具调用，一次最多分发
   `generation_batch_size` 张。默认值为 `4`。当前用户明确提出的 `--batch-size 4` 或
   “并行 4 张一起生成”等指令，覆盖 `EXTEND.md` 中的设置。
3. 若既没有批量接口也不能并行调用，则顺序生成。

规则：

- 第一批启动前，该批所有 Prompt 文件必须已落盘。
- 失败项目重试一次，不能重新生成已成功项目。
- 不得仅为了并行渲染图片而创建子 Agent；子 Agent 只可用于独立的 Prompt 迭代或创意探索。

## 确认策略

默认行为：**生成前必须确认**。

- 显式调用 Skill、提供文件路径、匹配到信号或预设、以及 `EXTEND.md` 默认值，都只属于推荐输入，
  不构成跳过确认的授权。
- 用户未完成第 3 步前，不得开始第 4 步或之后的操作。
- 只有用户在当前请求中明确说“直接生成”“不用确认”“跳过确认”“按默认出图”或同义表达，
  才可跳过确认。
- 若明确跳过确认，下一条面向用户的进度信息必须说明假定的类型、密度、风格、调色板、语言与后端。

## 参考图片

用户可通过 `--ref <files...>`、提供文件路径或在对话中粘贴图片来给出参考图。参考图可为某张
插图提供风格、调色板、构图或主体参考。

完整的检测、保存和处理规则在 `references/workflow.md`：第 1.0 步将图片保存为
`references/NN-ref-{slug}.{ext}`；第 5.3 步按每张插图的 `direct`、`style`、`palette` 用法处理。
若选择的后端支持批量输入，每个 Prompt 文件 frontmatter 中标记为 `direct` 的参考图，必须进入
该任务的批量请求参数，例如 `baoyu-image-gen` 的 `ref` 参数。

## 三个维度

| 维度 | 控制什么 | 示例 |
|---|---|---|
| **类型（Type）** | 信息结构 | 信息图、场景、流程图、对比图、框架图、时间线 |
| **风格（Style）** | 渲染方式 | Notion、暖色、极简、蓝图、水彩、优雅 |
| **调色板（Palette）** | 可选的色彩方案 | 马卡龙、暖色、霓虹；会覆盖风格默认色彩 |

三者可自由组合，例如：

```text
--type infographic --style vector-illustration --palette macaron
```

也可使用预设：`--preset edu-visual` 会一次指定类型、风格与调色板。详见
`references/style-presets.md`。

## 类型

| 类型 | 最适用场景 |
|---|---|
| `infographic`（信息图） | 数据、指标、技术内容 |
| `scene`（场景图） | 叙事、情绪表达 |
| `flowchart`（流程图） | 流程、工作流 |
| `comparison`（对比图） | 并列比较、选项比较 |
| `framework`（框架图） | 模型、架构 |
| `timeline`（时间线） | 历史、演进 |

## 风格

核心风格、完整风格图库和“类型 x 风格”兼容矩阵见 `references/styles.md`。

## 工作流

```text
- [ ] 第 1 步：预检查（EXTEND.md、参考图、配置）
- [ ] 第 2 步：分析内容
- [ ] 第 3 步：确认设置（AskUserQuestion）
- [ ] 第 4 步：生成大纲
- [ ] 第 5 步：生成图片
- [ ] 第 6 步：完成收尾
```

### 第 1 步：预检查

**1.5 读取偏好（EXTEND.md，阻塞性步骤）**

按下列优先级查找 `EXTEND.md`，找到的第一个文件生效：

| 优先级 | 路径 | 作用域 |
|---|---|---|
| 1 | `.baoyu-skills/baoyu-article-illustrator/EXTEND.md` | 当前项目 |
| 2 | `${XDG_CONFIG_HOME:-$HOME/.config}/baoyu-skills/baoyu-article-illustrator/EXTEND.md` | XDG 配置 |
| 3 | `$HOME/.baoyu-skills/baoyu-article-illustrator/EXTEND.md` | 用户主目录 |

| 结果 | 操作 |
|---|---|
| 找到 | 读取、解析并展示摘要 |
| 未找到 | 必须执行 `references/config/first-time-setup.md` 的首次设置 |

完整操作见 `references/workflow.md` 的“第 1 步：预检查”。

### 第 2 步：分析

| 分析项 | 输出 |
|---|---|
| 内容类型 | 技术 / 教程 / 方法论 / 叙事 |
| 目的 | 信息传递 / 可视化 / 想象表达 |
| 核心论点 | 2-5 个主要观点 |
| 位置 | 插图在哪些位置能增加价值 |

**关键规则**：遇到比喻时，应可视化其底层概念，而不是按字面画出比喻对象。

完整操作见 `references/workflow.md` 的“第 2 步：设置与分析”。

### 第 3 步：确认设置

**硬性关卡**：按照“确认策略”，除非当前请求明确要求“直接生成”或同义表达，用户必须在这里确认，
之后才可执行第 4 步及后续步骤。

**一次 `AskUserQuestion` 最多问 4 题。第 1、2 题必问；未选择预设时第 3 题必问。**

| 问题 | 选项 |
|---|---|
| **Q1：预设或类型** | 推荐预设、备选预设，或手动选择：信息图、场景、流程图、对比图、框架图、时间线、混合 |
| **Q2：密度** | minimal（1-2 张）、balanced（3-5 张）、per-section（每节一张，推荐）、rich（6 张以上） |
| **Q3：风格** | 推荐风格、minimal-flat、sci-fi、hand-drawn、editorial、scene、poster、其他；选择预设时跳过 |
| Q4：调色板 | 风格默认色、马卡龙、暖色、霓虹；预设已包含调色板或设置了 `preferred_palette` 时跳过 |
| Q5：语言 | 当文章语言与 `EXTEND.md` 设置的语言不一致时询问 |

完整操作见 `references/workflow.md` 的“第 3 步：确认设置”。

### 第 4 步：生成大纲

保存 `outline.md`，frontmatter 中写明类型、密度、风格、调色板、图片数；每张图使用如下条目：

```yaml
## 插图 1
**位置**：[章节或段落]
**目的**：[为什么要放在这里]
**视觉内容**：[画什么]
**文件名**：01-infographic-concept-name.png
```

完整模板见 `references/workflow.md` 的“第 4 步：生成大纲”。

### 第 5 步：生成图片

**阻塞性规则**：任何图片生成前，所有 Prompt 文件都必须已经保存。无论后端为何，这都是硬性要求，
因为 Prompt 文件是可复现记录。

1. 每张插图按 `references/prompt-construction.md` 创建 Prompt 文件。
2. 将文件保存为 `prompts/NN-{type}-{slug}.md`，并使用 YAML frontmatter。
3. Prompt 必须使用对应类型的结构化模板，含 `ZONES / LABELS / COLORS / STYLE / ASPECT`。
4. `LABELS` 必须带有文章特有数据：实际数字、术语、指标或引语。
5. 禁止未保存 Prompt 文件就通过 `--prompt` 传入临时内联 Prompt。
6. 按本文开头“图片生成工具”规则选择后端；若后端不止一个，单次会话只询问用户一次。
   当选择 `codex-imagegen` 时，按 `references/codex-imagegen.md` 的调用契约执行，优先使用
   `baoyu-image-gen --provider codex-cli`。
7. 按“批量生成策略”执行：原生批量优先，其次运行时并行，最后才顺序生成。除非用户当前请求
   或 `EXTEND.md` 覆盖，默认批次大小为 4。
8. 按 Prompt frontmatter 对参考图的 `direct`、`style`、`palette` 用法进行处理。
9. 若 `EXTEND.md` 启用水印，应用水印。
10. 从已保存的 Prompt 文件生成；单项失败重试一次。

完整操作见 `references/workflow.md` 的“第 5 步：生成图片”。

### 第 6 步：完成收尾

在相应段落之后插入：

```markdown
![图片说明]({relative-path}/NN-{type}-{slug}.png)
```

路径根据输出目录相对于文章文件计算。完成时输出：

```text
文章配图完成！
文章：[路径] | 类型：[类型] | 密度：[级别] | 风格：[风格] | 调色板：[调色板或默认]
图片：已生成 X/N 张
```

## 输出目录

输出目录由首次设置写入 `EXTEND.md` 的 `default_output_dir` 决定：

| `default_output_dir` | 输出路径 | Markdown 插入路径 |
|---|---|---|
| `imgs-subdir`（默认） | `{article-dir}/imgs/` | `imgs/NN-{type}-{slug}.png` |
| `same-dir` | `{article-dir}/` | `NN-{type}-{slug}.png` |
| `illustrations-subdir` | `{article-dir}/illustrations/` | `illustrations/NN-{type}-{slug}.png` |
| `independent` | `illustrations/{topic-slug}/` | `illustrations/{topic-slug}/NN-{type}-{slug}.png`（相对当前工作目录） |

所有辅助文件都保存在输出目录：

```text
{output-dir}/
├── outline.md
├── prompts/
│   └── NN-{type}-{slug}.md
└── NN-{type}-{slug}.png
```

当输入是粘贴内容而不是文件路径时，始终使用 `illustrations/{topic-slug}/`，并同时保存
`source-{slug}.{ext}`。

`slug` 由 2-4 个单词构成，使用 kebab-case。文件冲突时追加 `-YYYYMMDD-HHMMSS`。

## 修改

| 操作 | 步骤 |
|---|---|
| 编辑 | 更新 Prompt -> 重新生成 -> 更新引用 |
| 新增 | 确定位置 -> 写 Prompt -> 生成 -> 更新大纲 -> 插入 |
| 删除 | 删除文件 -> 移除引用 -> 更新大纲 |

文字修正规则：

- 若任何生成文字，包括标签或说明文字，拼写错误、乱码、难以阅读或视觉效果差，不得用代码修补位图。
- 因文字修正而重新生成时，必须写入新的 Prompt 文件和新的输出路径，以保留错误候选供比较。
- 后处理只允许裁剪、缩放、压缩或不改变文字与主体构图的格式转换。

## 参考文件

| 文件 | 内容 |
|---|---|
| `references/workflow.md` | 详细操作步骤 |
| `references/usage.md` | 命令语法 |
| `references/styles.md` | 风格库与调色板库 |
| `references/style-presets.md` | 预设快捷方式：类型 + 风格 + 调色板 |
| `references/prompt-construction.md` | Prompt 模板 |
| `references/config/first-time-setup.md` | 首次设置 |

## 修改偏好

`EXTEND.md` 位于第 1.5 步列出的第一个匹配路径。可用三种方式修改：

- **直接编辑**：打开 `EXTEND.md` 修改字段；完整字段定义见
  `references/config/preferences-schema.md`。
- **交互式重新配置**：删除 `EXTEND.md`，或提出“重新配置 baoyu-article-illustrator 偏好”。
  下一次运行会重新触发首次设置。
- **常用单行设置**：
  - `preferred_image_backend: auto`：默认；优先运行时原生工具，否则使用唯一已安装后端，
    只有多个非原生后端时才询问。
  - `preferred_image_backend: codex-imagegen`：固定使用 Codex 内置后端。
  - `preferred_image_backend: baoyu-image-gen`：固定使用 baoyu-image-gen Skill。
  - `preferred_image_backend: ask`：每次都确认后端。
  - `generation_batch_size: 4`：运行时支持并发时，每批并行渲染的默认图片数。
  - `preferred_type: infographic`、`preferred_style: notion`、
    `preferred_palette: macaron`、`language: zh`。
  - `default_output_dir: imgs-subdir`：指定相对于文章的图片输出位置。
