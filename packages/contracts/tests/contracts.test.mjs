import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const directory = new URL("../schemas/v1/", import.meta.url);
const files = (await readdir(directory)).filter((fileName) => fileName.endsWith(".schema.json"));
const schemas = await Promise.all(
  files.map(async (fileName) => JSON.parse(await readFile(new URL(fileName, directory), "utf8"))),
);
const ajv = new Ajv2020({ allErrors: true, strictSchema: true, strictTypes: false });
addFormats(ajv);
schemas.forEach((schema) => ajv.addSchema(schema));
const hash = `sha256:${"a".repeat(64)}`;

test("canonical Markdown revision validates and unknown fields fail", () => {
  const validate = ajv.getSchema(
    "https://schemas.openpublisher.dev/v1/article-revision.schema.json",
  );
  const revision = {
    schemaVersion: "1.0",
    id: "revision:1",
    articleId: "article:1",
    revisionNumber: 1,
    title: "Safe draft",
    markdown: "# Safe draft",
    contentHash: hash,
    status: "draft",
    createdAt: "2026-07-30T00:00:00.000Z",
    createdBy: { kind: "user", id: "user:local" },
  };
  assert.equal(validate(revision), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...revision, apiKey: "plaintext" }), false);
  assert.equal(validate({ ...revision, schemaVersion: "2.0" }), false);
});

test("connection profiles accept opaque references and reject plaintext fields", () => {
  const validate = ajv.getSchema(
    "https://schemas.openpublisher.dev/v1/connection-profile.schema.json",
  );
  const profile = {
    schemaVersion: "1.0",
    id: "connection:model:1",
    providerKind: "model",
    providerId: "openai-compatible",
    displayName: "Gateway",
    endpoint: "https://example.invalid/v1",
    authMethod: "api_key",
    credentialRef: "secret://connections/model-1",
    capabilities: ["chat"],
    status: "ready",
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  };
  assert.equal(validate(profile), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...profile, apiKey: "plaintext" }), false);
});

test("publish mode requires explicit approval", () => {
  const validate = ajv.getSchema("https://schemas.openpublisher.dev/v1/publish-plan.schema.json");
  const plan = {
    schemaVersion: "1.0",
    id: "plan:1",
    revisionId: "revision:1",
    mode: "publish",
    targets: [
      {
        id: "target:1",
        platform: "csdn",
        connectionProfileId: "connection:csdn:1",
        variantId: "variant:csdn:1",
      },
    ],
    planHash: hash,
    createdAt: "2026-07-30T00:00:00.000Z",
  };
  assert.equal(validate(plan), false);
  assert.equal(
    validate({
      ...plan,
      approvedAt: "2026-07-30T00:01:00.000Z",
      approvedBy: { kind: "user", id: "user:local" },
    }),
    true,
    JSON.stringify(validate.errors),
  );
});

test("declarative skills cannot declare executable entrypoints", () => {
  const validate = ajv.getSchema("https://schemas.openpublisher.dev/v1/skill-manifest.schema.json");
  const manifest = {
    schemaVersion: "1.0",
    id: "official.example",
    name: "Example",
    version: "1.0.0",
    description: "Example declarative skill",
    license: "AGPL-3.0-only",
    runtime: { kind: "declarative", apiVersion: "1.0", entrypoint: "third-party.js" },
    capabilities: [],
    inputArtifactTypes: [],
    outputArtifactTypes: ["example"],
    permissions: {
      modelAccess: false,
      imageGeneration: false,
      browserRead: false,
      platformWrites: false,
      filesystem: "none",
      networkServices: [],
    },
    declaration: {
      objective: "Return an artifact.",
      instructions: ["Return structured data."],
      guardrails: ["Do not mutate canonical content."],
    },
    configSchema: { type: "object" },
  };
  assert.equal(validate(manifest), false);
});
