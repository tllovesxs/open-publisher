import assert from "node:assert/strict";
import test from "node:test";

import {
  hashPairingNonce,
  isAllowedEditorUrl,
  platformForEditorUrl,
  stripPairingNonce,
  validateBrowserDraftTask,
} from "../src/shared/protocol.js";

const nonce = "abcdefghijklmnopqrstuvwxyzABCDEF";

function validTask() {
  return {
    schemaVersion: "1.0",
    taskId: "task:1",
    nonce,
    platform: "csdn",
    action: "FILL_DRAFT",
    article: {
      title: "Draft",
      body: { format: "markdown", content: "# Draft" },
    },
    safety: {
      finalPublish: false,
      requiresUserReview: true,
    },
  };
}

test("editor allowlist is exact and HTTPS-only", () => {
  assert.equal(platformForEditorUrl("https://editor.csdn.net/md?articleId=1"), "csdn");
  assert.equal(platformForEditorUrl("https://mp.toutiao.com/profile_v4/graphic/publish"), "toutiao");
  assert.equal(platformForEditorUrl("https://mp.weixin.qq.com/cgi-bin/appmsg"), "wechat");
  assert.equal(platformForEditorUrl("http://editor.csdn.net/md"), null);
  assert.equal(platformForEditorUrl("https://editor.csdn.net.evil.invalid/md"), null);
  assert.equal(
    isAllowedEditorUrl("https://mp.weixin.qq.com/cgi-bin/appmsg", "wechat"),
    true,
  );
});

test("only safe draft-fill tasks are accepted", () => {
  assert.deepEqual(validateBrowserDraftTask(validTask()), { ok: true, errors: [] });
  assert.equal(
    validateBrowserDraftTask({
      ...validTask(),
      action: "PUBLISH",
      safety: { finalPublish: true, requiresUserReview: false },
    }).ok,
    false,
  );
  assert.equal(validateBrowserDraftTask({ ...validTask(), cookies: "secret" }).ok, false);
});

test("nonce is hashed for storage and stripped before content-script delivery", async () => {
  const digest = await hashPairingNonce(nonce);
  assert.match(digest, /^[a-f0-9]{64}$/);
  const stripped = stripPairingNonce(validTask());
  assert.equal("nonce" in stripped, false);
  assert.equal(stripped.action, "FILL_DRAFT");
});
