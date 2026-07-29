import assert from "node:assert/strict";
import test from "node:test";

import {
  consumeTaskRecord,
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
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
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

test("consumed task records reject replay and prune expired records", () => {
  const now = Date.now();
  const task = validTask();
  const first = consumeTaskRecord(
    {
      expired: new Date(now - 1).toISOString(),
    },
    task,
    now,
  );
  assert.equal(first.accepted, true);
  assert.equal("expired" in first.records, false);
  const replay = consumeTaskRecord(first.records, task, now);
  assert.equal(replay.accepted, false);
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
  assert.equal(
    validateBrowserDraftTask({
      ...validTask(),
      article: {
        ...validTask().article,
        body: { ...validTask().article.body, cookies: "secret" },
      },
    }).ok,
    false,
  );
  assert.equal(
    validateBrowserDraftTask({
      ...validTask(),
      safety: { ...validTask().safety, cookies: "secret" },
    }).ok,
    false,
  );
  assert.equal(
    validateBrowserDraftTask({ ...validTask(), expectedDomVersion: { secret: "value" } }).ok,
    false,
  );
  assert.equal(
    validateBrowserDraftTask({
      ...validTask(),
      article: { ...validTask().article, summary: { apiKey: "secret" } },
    }).ok,
    false,
  );
  assert.equal(
    validateBrowserDraftTask({
      ...validTask(),
      expiresAt: new Date(Date.now() - 1).toISOString(),
    }).ok,
    false,
  );
});

test("nonce is hashed for storage and stripped before content-script delivery", async () => {
  const digest = await hashPairingNonce(nonce);
  assert.match(digest, /^[a-f0-9]{64}$/);
  const stripped = stripPairingNonce(validTask());
  assert.equal("nonce" in stripped, false);
  assert.equal(stripped.action, "FILL_DRAFT");
  const taskWithUnknownNestedData = validTask();
  taskWithUnknownNestedData.article.body.cookies = "must-not-cross-boundary";
  const sanitized = stripPairingNonce(taskWithUnknownNestedData);
  assert.equal("cookies" in sanitized.article.body, false);
});
