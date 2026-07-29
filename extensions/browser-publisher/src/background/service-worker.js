import {
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
  lastStatus: "lastStatus",
});

async function saveLastStatus(status) {
  await chrome.storage.local.set({ [STORAGE_KEYS.lastStatus]: status });
  return status;
}

async function pairNonce(nonce) {
  if (!validatePairingNonce(nonce)) {
    return { ok: false, status: "NEEDS_USER", reason: "INVALID_PAIRING_NONCE" };
  }
  const pairingHash = await hashPairingNonce(nonce);
  const pairedAt = new Date().toISOString();
  await chrome.storage.local.set({
    [STORAGE_KEYS.pairingHash]: pairingHash,
    [STORAGE_KEYS.pairedAt]: pairedAt,
    [STORAGE_KEYS.lastStatus]: {
      status: "PAIRED",
      at: pairedAt,
    },
  });
  return { ok: true, status: "PAIRED", pairedAt };
}

async function getStatus() {
  const stored = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return {
    ok: true,
    paired: typeof stored[STORAGE_KEYS.pairingHash] === "string",
    pairedAt: stored[STORAGE_KEYS.pairedAt] ?? null,
    editor: typeof tab?.url === "string" ? platformForEditorUrl(tab.url) : null,
    lastStatus: stored[STORAGE_KEYS.lastStatus] ?? null,
  };
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

  const stored = await chrome.storage.local.get(STORAGE_KEYS.pairingHash);
  const expectedHash = stored[STORAGE_KEYS.pairingHash];
  if (typeof expectedHash !== "string" || (await hashPairingNonce(task.nonce)) !== expectedHash) {
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
