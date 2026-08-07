import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const directory = new URL("../schemas/v2/", import.meta.url);
const files = (await readdir(directory)).filter((fileName) => fileName.endsWith(".schema.json"));
const schemas = await Promise.all(
  files.map(async (fileName) => JSON.parse(await readFile(new URL(fileName, directory), "utf8"))),
);
const ajv = new Ajv2020({ allErrors: true, strictSchema: true, strictTypes: false });
addFormats(ajv);
schemas.forEach((schema) => ajv.addSchema(schema));

test("v2 Agent events require monotonic sequence-compatible fields", () => {
  const validate = ajv.getSchema("https://schemas.openpublisher.dev/v2/agent-event.schema.json");
  const event = {
    schemaVersion: "2",
    id: "event:run-1:1",
    runId: "run:1",
    sequence: 1,
    timestamp: "2026-08-04T00:00:00.000Z",
    articleId: "article:1",
    agentId: "writer",
    parentAgentId: null,
    operation: "create_article",
    type: "article.preview_delta",
    payload: { text: "# Draft" },
  };
  assert.equal(validate(event), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...event, sequence: 0 }), false);
  assert.equal(validate({ ...event, hiddenChainOfThought: "must not cross" }), false);
});

test("v2 article writes bind nullable creation bases and reject unknown fields", () => {
  const validate = ajv.compile({
    $ref: "https://schemas.openpublisher.dev/v2/article-write.schema.json#/$defs/Request",
  });
  const request = {
    schemaVersion: "2",
    articleId: "article:1",
    baseRevisionId: null,
    baseContentHash: null,
    title: "A reliable draft",
    markdown: "# A reliable draft\n\nBody.",
    reason: "Initial article creation",
  };
  assert.equal(validate(request), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...request, apiKey: "plaintext" }), false);
});

test("v2 revision history identifies immutable versions and the current head", () => {
  const validate = ajv.compile({
    $ref: "https://schemas.openpublisher.dev/v2/article-revision-history.schema.json#/$defs/Detail",
  });
  const revision = {
    schemaVersion: "2",
    articleId: "article:1",
    revisionId: "revision:2",
    revisionNumber: 2,
    parentRevisionId: "revision:1",
    title: "Restored draft",
    contentHash: `sha256:${"a".repeat(64)}`,
    createdAt: "2026-08-07T00:00:00.000Z",
    reason: "restore:revision:1",
    isCurrent: true,
    markdown: "# Restored draft",
  };
  assert.equal(validate(revision), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...revision, plaintextApiKey: "must not cross" }), false);
});

test("v2 Runtime protocol exposes the pinned engine without secrets", () => {
  const validate = ajv.getSchema(
    "https://schemas.openpublisher.dev/v2/runtime-protocol.schema.json",
  );
  const version = {
    schemaVersion: "2",
    runtimeVersion: "0.3.0",
    piAgentVersion: "0.83.0",
    engine: "pi",
    build: "development",
  };
  assert.equal(validate(version), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...version, runtimeToken: "leak" }), false);
});
