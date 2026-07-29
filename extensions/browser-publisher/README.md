# Open Publisher 浏览器草稿助手（P0）

这是一个 Chrome Manifest V3 扩展，用于把 Open Publisher 生成的内容填入平台编辑器。P0 只负责“填充草稿”，不会读取或导出 Cookie，也不会点击保存、提交或最终发布按钮。

> 当前版本是 DOM 适配基础：选择器、协议校验和安全边界已有自动化测试，但尚未使用 CSDN、今日头条、微信公众号的真实账号完成端到端验证。平台页面改版后，扩展可能返回 `NEEDS_USER`，需要人工处理或更新适配器。

## 安装与加载

需要 Chrome 120 或更高版本。

1. 在仓库根目录安装依赖：

   ```powershell
   pnpm install
   ```

2. 在 Chrome 地址栏打开 `chrome://extensions/`。
3. 开启右上角的“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择本目录：

   ```text
   extensions/browser-publisher
   ```

6. 建议将“Open Publisher 安全草稿助手”固定到工具栏。修改扩展源码后，需要在扩展管理页点击“重新加载”。

P0 没有单独的打包或编译步骤，Chrome 直接加载本目录中的 `manifest.json` 和源码。

## 使用流程

1. 由桌面端或测试发送方生成一个 32–128 位的 base64url 配对 nonce。
2. 打开扩展弹窗，将 nonce 粘贴到“桌面端配对码”并点击配对。
3. 配对有效期为 **15 分钟**。扩展只保存 nonce 的 SHA-256 摘要；过期后必须重新配对。
4. 在当前标签页打开与任务平台一致的文章编辑页。
5. 桌面端提交 `FILL_DRAFT` 任务。任务必须包含 `expiresAt`，并且剩余有效期不能超过 **10 分钟**；过期任务或超长有效期任务会被拒绝。
6. 扩展只填入标题和正文。请在平台页面人工检查内容、格式、配图、标签及平台提示，再由用户亲自执行保存或最终发布。

扩展弹窗中的“模拟草稿标题/正文”可用于本地检查 DOM 填充流程；它同样不会触发发布。

## 支持范围与权限

P0 只允许以下三个精确 HTTPS 主机：

| 平台 | 允许的编辑器主机 |
| --- | --- |
| CSDN | `https://editor.csdn.net/*` |
| 今日头条 | `https://mp.toutiao.com/*` |
| 微信公众号 | `https://mp.weixin.qq.com/*` |

相似域名、HTTP 地址、子域名伪装和其他网站均不匹配。扩展仅申请 `activeTab`、`storage` 和上述三个主机权限，不申请 Cookie 权限。

任务协议只接受 `action: "FILL_DRAFT"`，并强制要求：

```json
{
  "safety": {
    "finalPublish": false,
    "requiresUserReview": true
  }
}
```

正文通过表单原生值或 `textContent` 写入，不把任务正文当作 HTML 注入。

## `NEEDS_USER` 与防重放

遇到无法安全自动处理的情况时，扩展返回 `NEEDS_USER`，而不是继续尝试或自动降级。常见原因包括：

- 未配对、配对已过期或 nonce 不匹配；
- 任务格式无效、任务已过期或有效期超过 10 分钟；
- 当前标签页不是任务指定平台的精确编辑器主机；
- 平台 DOM 版本或编辑器选择器不匹配；
- 编辑器拒绝输入或内容脚本不可用；
- 相同 `taskId` 已经消费。

扩展会记录尚未过期的已消费 `taskId`。同一个任务再次提交时返回 `NEEDS_USER` / `TASK_REPLAYED`，避免重复填充。重新发起操作应创建新的 `taskId`，不应复用旧任务。

## 本地检查

在仓库根目录运行：

```powershell
pnpm --filter @open-publisher/browser-publisher check
pnpm --filter @open-publisher/browser-publisher test
```

`check` 会校验 MV3 manifest、安全权限与扩展协议，并运行聚焦测试；`test` 只运行协议单元测试。两者都不会访问真实平台、真实账号或执行远程发布。
