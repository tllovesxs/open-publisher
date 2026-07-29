export const TASK_SCHEMA_VERSION = "1.0";
export const NONCE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
export const SUPPORTED_PLATFORMS = Object.freeze(["csdn", "toutiao", "wechat"]);
export const TASK_MAX_TTL_MS = 10 * 60 * 1000;

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

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownFields(value, allowedFields, path, errors) {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      errors.push(`Unknown ${path} field: ${key}`);
    }
  }
}

export function validateBrowserDraftTask(task, now = Date.now()) {
  const errors = [];
  if (!isObject(task)) {
    return { ok: false, errors: ["Task must be an object"] };
  }

  const allowedTopLevel = new Set([
    "schemaVersion",
    "taskId",
    "nonce",
    "expiresAt",
    "platform",
    "action",
    "expectedDomVersion",
    "article",
    "safety",
  ]);
  rejectUnknownFields(task, allowedTopLevel, "task", errors);
  if (task.schemaVersion !== TASK_SCHEMA_VERSION) errors.push("Unsupported schemaVersion");
  if (typeof task.taskId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(task.taskId)) {
    errors.push("Invalid taskId");
  }
  if (!validatePairingNonce(task.nonce)) errors.push("Invalid pairing nonce");
  if (typeof task.expiresAt !== "string") {
    errors.push("Invalid task expiry");
  } else {
    const expiresAt = Date.parse(task.expiresAt);
    if (!Number.isFinite(expiresAt)) {
      errors.push("Invalid task expiry");
    } else if (expiresAt <= now) {
      errors.push("Task has expired");
    } else if (expiresAt > now + TASK_MAX_TTL_MS) {
      errors.push("Task expiry exceeds the maximum TTL");
    }
  }
  if (!SUPPORTED_PLATFORMS.includes(task.platform)) errors.push("Unsupported platform");
  if (task.action !== "FILL_DRAFT") errors.push("Only FILL_DRAFT is permitted");
  if (
    task.expectedDomVersion !== undefined &&
    (typeof task.expectedDomVersion !== "string" ||
      task.expectedDomVersion.length < 1 ||
      task.expectedDomVersion.length > 100)
  ) {
    errors.push("Invalid expectedDomVersion");
  }

  const article = task.article;
  if (!isObject(article)) {
    errors.push("article must be an object");
  } else {
    const articleKeys = new Set(["title", "body", "summary", "tags"]);
    rejectUnknownFields(article, articleKeys, "article", errors);
    if (typeof article.title !== "string" || article.title.length < 1 || article.title.length > 500) {
      errors.push("Invalid article title");
    }
    if (!isObject(article.body)) {
      errors.push("Invalid article body");
    } else {
      rejectUnknownFields(article.body, new Set(["format", "content"]), "article.body", errors);
      if (
        !["markdown", "plain"].includes(article.body.format) ||
        typeof article.body.content !== "string" ||
        article.body.content.length < 1 ||
        article.body.content.length > 1_000_000
      ) {
        errors.push("Invalid article body");
      }
    }
    if (
      article.summary !== undefined &&
      (typeof article.summary !== "string" || article.summary.length > 4000)
    ) {
      errors.push("Invalid article summary");
    }
    if (article.tags !== undefined) {
      if (
        !Array.isArray(article.tags) ||
        article.tags.length > 100 ||
        article.tags.some(
          (tag) => typeof tag !== "string" || tag.length < 1 || tag.length > 100,
        ) ||
        new Set(article.tags).size !== article.tags.length
      ) {
        errors.push("Invalid article tags");
      }
    }
  }

  if (!isObject(task.safety)) {
    errors.push("Unsafe task policy");
  } else {
    rejectUnknownFields(
      task.safety,
      new Set(["finalPublish", "requiresUserReview"]),
      "safety",
      errors,
    );
    if (task.safety.finalPublish !== false || task.safety.requiresUserReview !== true) {
      errors.push("Unsafe task policy");
    }
  }

  return { ok: errors.length === 0, errors };
}

export function consumeTaskRecord(
  storedRecords,
  task,
  now = Date.now(),
  maximumRecords = 500,
) {
  const unexpiredEntries = isObject(storedRecords)
    ? Object.entries(storedRecords).filter(
        ([, expiresAt]) => typeof expiresAt === "string" && Date.parse(expiresAt) > now,
      )
    : [];
  if (unexpiredEntries.some(([taskId]) => taskId === task.taskId)) {
    return {
      accepted: false,
      records: Object.fromEntries(unexpiredEntries.slice(-maximumRecords)),
    };
  }
  unexpiredEntries.push([task.taskId, task.expiresAt]);
  return {
    accepted: true,
    records: Object.fromEntries(unexpiredEntries.slice(-maximumRecords)),
  };
}

export function stripPairingNonce(task) {
  const safeArticle = {
    title: task.article.title,
    body: {
      format: task.article.body.format,
      content: task.article.body.content,
    },
  };
  if (typeof task.article.summary === "string") safeArticle.summary = task.article.summary;
  if (Array.isArray(task.article.tags)) safeArticle.tags = [...task.article.tags];
  const safeTask = {
    schemaVersion: task.schemaVersion,
    taskId: task.taskId,
    expiresAt: task.expiresAt,
    platform: task.platform,
    action: "FILL_DRAFT",
    article: safeArticle,
    safety: {
      finalPublish: false,
      requiresUserReview: true,
    },
  };
  if (typeof task.expectedDomVersion === "string") {
    safeTask.expectedDomVersion = task.expectedDomVersion;
  }
  return safeTask;
}
