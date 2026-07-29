import {
  consumeTaskRecord,
  hashPairingNonce,
  isAllowedEditorUrl,
  platformForEditorUrl,
  stripPairingNonce,
  validateBrowserDraftTask,
  validatePairingNonce,
} from "../shared/protocol.js";

const STORAGE_KEYS = Object.freeze({
  pairingHash: "pairingNonceHash",
  pairedAt: "pairedAt",
  pairingExpiresAt: "pairingExpiresAt",
  consumedTasks: "consumedDraftTasks",
  lastStatus: "lastStatus",
});
const PAIRING_TTL_MS = 15 * 60 * 1000;
const MAX_CONSUMED_TASKS = 500;
let consumeQueue = Promise.resolve();

async function saveLastStatus(status) {
  await chrome.storage.local.set({ [STORAGE_KEYS.lastStatus]: status });
  return status;
}

async function pairNonce(nonce) {
  if (!validatePairingNonce(nonce)) {
    return { ok: false, status: "NEEDS_USER", reason: "INVALID_PAIRING_NONCE" };
  }
  const pairingHash = await hashPairingNonce(nonce);
  const now = Date.now();
  const pairedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + PAIRING_TTL_MS).toISOString();
  await chrome.storage.local.set({
    [STORAGE_KEYS.pairingHash]: pairingHash,
    [STORAGE_KEYS.pairedAt]: pairedAt,
    [STORAGE_KEYS.pairingExpiresAt]: expiresAt,
    [STORAGE_KEYS.consumedTasks]: {},
    [STORAGE_KEYS.lastStatus]: {
      status: "PAIRED",
      at: pairedAt,
    },
  });
  return { ok: true, status: "PAIRED", pairedAt, expiresAt };
}

async function getStatus() {
  const stored = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  const pairingExpiresAt = Date.parse(stored[STORAGE_KEYS.pairingExpiresAt] ?? "");
  const paired =
    typeof stored[STORAGE_KEYS.pairingHash] === "string" &&
    Number.isFinite(pairingExpiresAt) &&
    pairingExpiresAt > Date.now();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return {
    ok: true,
    paired,
    pairedAt: paired ? (stored[STORAGE_KEYS.pairedAt] ?? null) : null,
    pairingExpiresAt: paired ? stored[STORAGE_KEYS.pairingExpiresAt] : null,
    editor: typeof tab?.url === "string" ? platformForEditorUrl(tab.url) : null,
    lastStatus: stored[STORAGE_KEYS.lastStatus] ?? null,
  };
}

function consumeTaskOnce(task) {
  const operation = consumeQueue.then(async () => {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.consumedTasks);
    const current = stored[STORAGE_KEYS.consumedTasks];
    const result = consumeTaskRecord(current, task, Date.now(), MAX_CONSUMED_TASKS);
    await chrome.storage.local.set({
      [STORAGE_KEYS.consumedTasks]: result.records,
    });
    return result.accepted;
  });
  consumeQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

async function submitDraftTask(task) {
  const validation = validateBrowserDraftTask(task);
  if (!validation.ok) {
    return saveLastStatus({
      ok: false,
      status: "NEEDS_USER",
      reason: "INVALID_TASK",
      diagnostics: validation.errors,
      at: new Date().toISOString(),
    });
  }

  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.pairingHash,
    STORAGE_KEYS.pairingExpiresAt,
  ]);
  const expectedHash = stored[STORAGE_KEYS.pairingHash];
  const pairingExpiresAt = Date.parse(stored[STORAGE_KEYS.pairingExpiresAt] ?? "");
  if (
    typeof expectedHash !== "string" ||
    !Number.isFinite(pairingExpiresAt) ||
    pairingExpiresAt <= Date.now() ||
    (await hashPairingNonce(task.nonce)) !== expectedHash
  ) {
    if (Number.isFinite(pairingExpiresAt) && pairingExpiresAt <= Date.now()) {
      await chrome.storage.local.remove([
        STORAGE_KEYS.pairingHash,
        STORAGE_KEYS.pairedAt,
        STORAGE_KEYS.pairingExpiresAt,
      ]);
    }
    return saveLastStatus({
      ok: false,
      status: "NEEDS_USER",
      reason: "PAIRING_REQUIRED",
      at: new Date().toISOString(),
    });
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (
    tab?.id === undefined ||
    typeof tab.url !== "string" ||
    !isAllowedEditorUrl(tab.url, task.platform)
  ) {
    return saveLastStatus({
      ok: false,
      status: "NEEDS_USER",
      reason: "OPEN_EXPECTED_EDITOR",
      at: new Date().toISOString(),
    });
  }

  if (!(await consumeTaskOnce(task))) {
    return saveLastStatus({
      ok: false,
      status: "NEEDS_USER",
      reason: "TASK_REPLAYED",
      at: new Date().toISOString(),
    });
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: "OPEN_PUBLISHER_FILL_DRAFT",
      task: stripPairingNonce(task),
    });
    return saveLastStatus({
      ...response,
      at: new Date().toISOString(),
    });
  } catch (error) {
    return saveLastStatus({
      ok: false,
      status: "NEEDS_USER",
      reason: "CONTENT_SCRIPT_UNAVAILABLE",
      diagnostics: String(error),
      at: new Date().toISOString(),
    });
  }
}

async function handleMessage(message, sender) {
  if (sender.id !== chrome.runtime.id || message === null || typeof message !== "object") {
    return { ok: false, status: "NEEDS_USER", reason: "UNTRUSTED_SENDER" };
  }
  switch (message.type) {
    case "PAIR_NONCE":
      return pairNonce(message.nonce);
    case "GET_STATUS":
      return getStatus();
    case "SUBMIT_DRAFT_TASK":
      return submitDraftTask(message.task);
    default:
      return { ok: false, status: "NEEDS_USER", reason: "UNKNOWN_MESSAGE" };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) =>
      sendResponse({
        ok: false,
        status: "NEEDS_USER",
        reason: "INTERNAL_ERROR",
        diagnostics: String(error),
      }),
    );
  return true;
});
