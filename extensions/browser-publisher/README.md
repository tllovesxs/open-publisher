# Open Publisher 浏览器草稿助手

这是一个 Chrome Manifest V3 扩展，用于把 Open Publisher 生成的内容填入平台编辑器。首版只负责“填充草稿”，不会读取或导出 Cookie，也不会点击保存、提交或最终发布按钮。

> 当前版本已具备 CSDN、微信公众号、知乎与小红书的独立 DOM 适配基础。选择器、协议校验和安全边界已有自动化测试；桌面端到扩展的本地配对投递桥仍在开发，且尚未使用真实账号完成端到端验证。平台页面改版后，扩展会返回 `NEEDS_USER`，需要人工处理或更新对应适配器。

## 安装与加载

需要 Chrome 120 或更高版本。Microsoft Edge（Chromium）可直接加载相同目录进行开发测试。

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

6. 建议将“Open Publisher 草稿助手”固定到工具栏。修改扩展源码后，需要在扩展管理页点击“重新加载”。

P0 没有单独的打包或编译步骤，Chrome 直接加载本目录中的 `manifest.json` 和源码。

## 使用流程

当前版本支持扩展弹窗内的本地冒烟流程：

1. 使用测试夹具生成一个 32–128 位的 base64url 配对 nonce。
2. 打开扩展弹窗，将 nonce 粘贴到“桌面端配对码”并点击配对。
3. 配对有效期为 **15 分钟**。扩展只保存 nonce 的 SHA-256 摘要；过期后必须重新配对。
4. 在当前标签页打开与任务平台一致的文章编辑页。
5. 在弹窗输入测试标题和正文并点击填充。弹窗会生成 `FILL_DRAFT` 任务；任务包含
   `expiresAt`，且剩余有效期不能超过 **10 分钟**。
6. 扩展只填入标题和正文。请在平台页面人工检查内容、格式、配图、标签及平台提示，再由用户亲自执行保存或最终发布。小红书图文笔记需要先按页面提示添加必需图片；扩展不会代替用户上传或选择图片。

Service Worker 只接受来自本扩展的消息；Manifest 没有 `externally_connectable` 或 Native
Messaging。桌面端尚不能直接提交任务，这需要后续增加经过威胁建模的本地认证桥。当前
弹窗流程同样不会触发保存或发布。

PowerShell 7 可用以下命令生成本地冒烟 nonce：

```powershell
[Convert]::ToBase64String(
  [Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
).TrimEnd("=").Replace("+", "-").Replace("/", "_")
```

## 支持范围与权限

扩展只允许以下四个精确 HTTPS 编辑器主机，并在运行时进一步校验编辑器路径：

| 平台 | 允许的编辑器主机 |
| --- | --- |
| CSDN | `https://editor.csdn.net/*` |
| 微信公众号 | `https://mp.weixin.qq.com/*` |
| 知乎专栏 | `https://zhuanlan.zhihu.com/*` |
| 小红书创作服务平台 | `https://creator.xiaohongshu.com/*` |

相似域名、HTTP 地址、子域名伪装和其他网站均不匹配。扩展仅申请 `activeTab`、`storage` 和上述四个主机权限，不申请 Cookie 权限。

任务协议只接受 `action: "FILL_DRAFT"`，并强制要求：

```json
{
  "safety": {
    "finalPublish": false,
    "requiresUserReview": true
  }
}
```

正文通过表单原生值或浏览器文本输入事件写入，不把任务正文当作 HTML 注入。

## 商店发布边界

同类扩展已经存在不会妨碍提交 Chrome Web Store 或 Microsoft Edge Add-ons。审核关心的是产品是否有独立实现和清晰价值、权限和隐私披露是否与实际一致、是否会误导用户或侵犯知识产权，而不是市场上是否已有类似品类。

正式提交前必须完成以下事项：

1. 接通桌面端到扩展的本地配对桥，并完成四个平台的真实草稿填充验证。
2. 提供公开隐私政策，明确不读取、上传或导出 Cookie，不将文章内容发送到未声明的服务。
3. 在商店说明中逐项解释 `activeTab`、`storage` 和四个网站主机权限的用途。
4. 保持“填入草稿，用户最终确认”的行为，不能尝试绕过登录、验证码、风控或平台确认步骤。
5. 采用完全独立的实现，不复制第三方 GPL 插件的源码、命名、注释、选择器集合或私有适配器。

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
