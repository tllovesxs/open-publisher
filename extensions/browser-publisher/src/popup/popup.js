import { platformForEditorUrl, validatePairingNonce } from "../shared/protocol.js";

const statusElement = document.querySelector("#status");
const nonceElement = document.querySelector("#nonce");
const titleElement = document.querySelector("#title");
const bodyElement = document.querySelector("#body");

function setStatus(message) {
  statusElement.textContent = message;
}

async function runtimeMessage(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    return { ok: false, status: "NEEDS_USER", reason: String(error) };
  }
}

async function refreshStatus() {
  const status = await runtimeMessage({ type: "GET_STATUS" });
  const pairing = status.paired ? "已配对" : "未配对";
  const editor = status.editor ?? "未打开支持的编辑页";
  const last = status.lastStatus?.status ?? "暂无任务";
  setStatus(`${pairing} · ${editor} · ${last}`);
}

document.querySelector("#pair").addEventListener("click", async () => {
  const nonce = nonceElement.value.trim();
  if (!validatePairingNonce(nonce)) {
    setStatus("配对码必须是 32–128 位 base64url 字符。");
    return;
  }
  const result = await runtimeMessage({ type: "PAIR_NONCE", nonce });
  setStatus(result.ok ? "配对成功。" : `需要用户处理：${result.reason}`);
});

document.querySelector("#fill").addEventListener("click", async () => {
  const nonce = nonceElement.value.trim();
  if (!validatePairingNonce(nonce)) {
    setStatus("请重新输入本地配对码后再填充。");
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const platform = typeof tab?.url === "string" ? platformForEditorUrl(tab.url) : null;
  if (platform === null) {
    setStatus("请先打开 CSDN、今日头条或微信公众号编辑页。");
    return;
  }

  const result = await runtimeMessage({
    type: "SUBMIT_DRAFT_TASK",
    task: {
      schemaVersion: "1.0",
      taskId: `draft:${crypto.randomUUID()}`,
      nonce,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      platform,
      action: "FILL_DRAFT",
      article: {
        title: titleElement.value,
        body: {
          format: "plain",
          content: bodyElement.value,
        },
      },
      safety: {
        finalPublish: false,
        requiresUserReview: true,
      },
    },
  });

  setStatus(
    result.status === "DRAFT_FILLED"
      ? "草稿已填充，请在平台页面人工检查。"
      : `需要用户处理：${result.reason ?? "UNKNOWN"}`,
  );
});

await refreshStatus();
