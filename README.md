# Open Publisher

Open Publisher 是一个本地优先的智能写作与多平台发布工作台。它使用 Tauri v2
提供桌面体验，使用 Python 与 LangGraph 编排有边界的多 Agent 工作流，并通过
可靠的发布队列将 Markdown 主稿转换为微信公众号、CSDN、今日头条等平台稿。

当前版本：`0.1.0-alpha`

## 第一版目标

- Markdown 主稿、不可变修订和平台派生稿。
- 研究、规划、写作、审核、视觉规划的基础工作流。
- 文本模型、生图模型和 OpenAI-compatible 连接配置。
- 微信公众号基础 API Adapter、浏览器发布扩展和手工发布包。
- SQLite Durable Outbox、幂等键、远端状态核验和发布回执。
- 与万能导通过 `ContentPackage v1` 交换素材。
- 本地优先，不要求用户部署独立模型网关或公共网络服务。

## 仓库结构

```text
apps/desktop/                   React + Tauri v2
services/agent-runtime/         Python FastAPI + LangGraph
extensions/browser-publisher/   Manifest V3 extension
packages/contracts/             Versioned JSON Schema contracts
packages/platform-sdk/          Platform adapter contracts
packages/skill-sdk/             Skill package contracts
skills/official/                First-party skills
docs/adr/                       Architecture decisions
```

## 开发环境

- Node.js 22+
- pnpm 11+
- Rust 1.77.2+
- Python 3.12 或 3.13

普通发行包会携带自包含 Python Sidecar，最终用户不需要安装上述开发环境。

## 状态

第一版正在按 [`docs/adr/0001-architecture-baseline.md`](docs/adr/0001-architecture-baseline.md)
实现。当前阶段只承诺基础测试；真实平台账号和正式发布验证将在闭环完成后进行。

