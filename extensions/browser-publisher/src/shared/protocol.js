export const TASK_SCHEMA_VERSION = "1.0";
export const NONCE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
export const SUPPORTED_PLATFORMS = Object.freeze(["csdn", "toutiao", "wechat"]);

const ALLOWED_EDITORS = Object.freeze({
  csdn: (url) => url.protocol === "https:" && url.hostname === "editor.csdn.net",
  toutiao: (url) => url.protocol === "https:" && url.hostname === "mp.toutiao.com",
  wechat: (url) => url.protocol === "https:" && url.hostname === "mp.weixin.qq.com",
});

export function platformForEditorUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  for (const [platform, matches] of Object.entries(ALLOWED_EDITORS)) {
    if (matches(url)) {
      return platform;
    }
  }
  return null;
}

export function isAllowedEditorUrl(rawUrl, expectedPlatform) {
  return platformForEditorUrl(rawUrl) === expectedPlatform;
}

export function validatePairingNonce(nonce) {
  return typeof nonce === "string" && NONCE_PATTERN.test(nonce);
}

export async function hashPairingNonce(nonce) {
  if (!validatePairingNonce(nonce)) {
    throw new Error("Pairing nonce must be 32-128 base64url characters");
  }
  const bytes = new TextEncoder().encode(nonce);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function validateBrowserDraftTask(task) {
  const errors = [];
  if (task === null || typeof task !== "object" || Array.isArray(task)) {
    return { ok: false, errors: ["Task must be an object"] };
  }

  const allowedTopLevel = new Set([
    "schemaVersion",
    "taskId",
    "nonce",
    "platform",
    "action",
    "expectedDomVersion",
    "article",
    "safety",
  ]);
  for (const key of Object.keys(task)) {
    if (!allowedTopLevel.has(key)) {
      errors.push(`Unknown task field: ${key}`);
    }
  }
  if (task.schemaVersion !== TASK_SCHEMA_VERSION) errors.push("Unsupported schemaVersion");
  if (typeof task.taskId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(task.taskId)) {
    errors.push("Invalid taskId");
  }
  if (!validatePairingNonce(task.nonce)) errors.push("Invalid pairing nonce");
  if (!SUPPORTED_PLATFORMS.includes(task.platform)) errors.push("Unsupported platform");
  if (task.action !== "FILL_DRAFT") errors.push("Only FILL_DRAFT is permitted");

  const article = task.article;
  if (article === null || typeof article !== "object" || Array.isArray(article)) {
    errors.push("article must be an object");
  } else {
    const articleKeys = new Set(["title", "body", "summary", "tags"]);
    for (const key of Object.keys(article)) {
      if (!articleKeys.has(key)) errors.push(`Unknown article field: ${key}`);
    }
    if (typeof article.title !== "string" || article.title.length < 1 || article.title.length > 500) {
      errors.push("Invalid article title");
    }
    if (
      article.body === null ||
      typeof article.body !== "object" ||
      !["markdown", "plain"].includes(article.body.format) ||
      typeof article.body.content !== "string" ||
      article.body.content.length < 1 ||
      article.body.content.length > 1_000_000
    ) {
      errors.push("Invalid article body");
    }
  }

  if (
    task.safety === null ||
    typeof task.safety !== "object" ||
    task.safety.finalPublish !== false ||
    task.safety.requiresUserReview !== true
  ) {
    errors.push("Unsafe task policy");
  }

  return { ok: errors.length === 0, errors };
}

export function stripPairingNonce(task) {
  const { nonce: _nonce, ...safeTask } = task;
  return safeTask;
}
