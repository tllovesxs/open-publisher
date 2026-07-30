import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  isCanonicalContentPackagePath,
  validateConnectionSecretBoundary,
  validateContentPackageManifest,
  validateWorkflowGraph,
} from "../src/validation.ts";

const directory = new URL("../schemas/v1/", import.meta.url);
const files = (await readdir(directory)).filter((fileName) => fileName.endsWith(".schema.json"));
const schemas = await Promise.all(
  files.map(async (fileName) => JSON.parse(await readFile(new URL(fileName, directory), "utf8"))),
);
const ajv = new Ajv2020({ allErrors: true, strictSchema: true, strictTypes: false });
addFormats(ajv);
schemas.forEach((schema) => ajv.addSchema(schema));
const hash = `sha256:${"a".repeat(64)}`;
const sidecarFixtures = JSON.parse(
  await readFile(new URL("../fixtures/v1/sidecar-protocol.json", import.meta.url), "utf8"),
);

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
  assert.equal(
    validate({
      ...plan,
      approvedAt: "2026-07-30T00:01:00.000Z",
      approvedBy: { kind: "agent", id: "agent:auto" },
    }),
    false,
    "Only a human user can approve final publication",
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
    source: { kind: "first-party" },
  };
  assert.equal(validate(manifest), false);
});

test("third-party skills are immutable and cannot write platforms", () => {
  const validate = ajv.getSchema("https://schemas.openpublisher.dev/v1/skill-manifest.schema.json");
  const manifest = {
    schemaVersion: "1.0",
    id: "third-party.example",
    name: "Example",
    version: "1.0.0",
    description: "Third-party declarative skill",
    license: "MIT",
    runtime: { kind: "declarative", apiVersion: "1.0" },
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
      guardrails: ["Do not mutate platform state."],
    },
    configSchema: { type: "object" },
    source: {
      kind: "third-party",
      url: "https://github.com/example/skill",
      commit: "a".repeat(40),
      license: "MIT",
    },
  };
  assert.equal(validate(manifest), true, JSON.stringify(validate.errors));
  assert.equal(
    validate({
      ...manifest,
      permissions: { ...manifest.permissions, platformWrites: true },
    }),
    false,
  );
  assert.equal(
    validate({
      ...manifest,
      source: { ...manifest.source, commit: "abcdef0" },
    }),
    false,
  );
});

test("browser adapter manifests enforce safe capabilities in the schema", () => {
  const validate = ajv.getSchema(
    "https://schemas.openpublisher.dev/v1/platform-adapter-manifest.schema.json",
  );
  const manifest = {
    schemaVersion: "1.0",
    id: "adapter:browser:csdn",
    platform: "csdn",
    name: "CSDN draft filler",
    version: "1.0.0",
    license: "AGPL-3.0-only",
    transport: "browser_extension",
    supportedOperations: ["probe", "prepare_draft", "save_draft"],
    requiredAuthMethods: ["browser_session"],
    editorUrlPatterns: ["https://editor.csdn.net/md*"],
    capabilities: {
      supportsMarkdown: true,
      supportsHtml: false,
      supportsDrafts: true,
      supportsScheduling: false,
    },
    permissions: {
      hostPatterns: ["https://editor.csdn.net/*"],
      cookieAccess: false,
    },
    safeDefaults: {
      defaultMode: "save_draft",
      finalPublishRequiresUser: true,
      exportsCookies: false,
    },
  };
  assert.equal(validate(manifest), true, JSON.stringify(validate.errors));
  assert.equal(
    validate({
      ...manifest,
      permissions: { hostPatterns: ["<all_urls>"], cookieAccess: true },
      safeDefaults: {
        defaultMode: "publish",
        finalPublishRequiresUser: false,
        exportsCookies: true,
      },
    }),
    false,
  );
});

test("workflow semantic validation enforces a reachable DAG and protected nodes", () => {
  const validWorkflow = {
    nodes: [
      { id: "research", kind: "agent", handler: "research" },
      { id: "review", kind: "human", handler: "approval" },
    ],
    edges: [{ from: "research", to: "review" }],
    entryNodeIds: ["research"],
    requiredNodeIds: ["review"],
  };
  assert.deepEqual(validateWorkflowGraph(validWorkflow), { valid: true, errors: [] });

  const invalid = validateWorkflowGraph({
    nodes: [
      { id: "a", kind: "agent", handler: "a" },
      { id: "b", kind: "agent", handler: "b" },
      { id: "orphan", kind: "tool", handler: "orphan" },
      { id: "optional-review", kind: "human", handler: "approval", optional: true },
    ],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "a" },
      { from: "a", to: "b" },
      { from: "orphan", to: "orphan" },
    ],
    entryNodeIds: ["a"],
    requiredNodeIds: ["optional-review", "missing"],
  });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((error) => error.includes("acyclic")));
  assert.ok(invalid.errors.some((error) => error.includes("Duplicate workflow edge")));
  assert.ok(invalid.errors.some((error) => error.includes("unreachable")));
  assert.ok(invalid.errors.some((error) => error.includes("cannot be optional")));
  assert.ok(invalid.errors.some((error) => error.includes("Required node does not exist")));
});

test("content package paths are portable and duplicate-safe", () => {
  const validateSchema = ajv.getSchema(
    "https://schemas.openpublisher.dev/v1/content-package-manifest.schema.json",
  );
  assert.equal(isCanonicalContentPackagePath("content/article.md"), true);
  for (const unsafePath of [
    "../secret",
    "assets/../secret",
    "..\\secret",
    "C:\\Windows\\secret",
    "assets\\..\\secret",
    ".",
    "a//b",
    "assets/NUL.txt",
  ]) {
    assert.equal(isCanonicalContentPackagePath(unsafePath), false, unsafePath);
  }
  const manifest = {
    schemaVersion: "1.0",
    id: "package:1",
    sourceApp: "open-publisher",
    articleRevisionId: "revision:1",
    entries: [
      {
        artifactId: "artifact:article",
        path: "content/article.md",
        mediaType: "text/markdown",
        contentHash: hash,
        sizeBytes: 1,
      },
    ],
    platformVariantIds: [],
    packageHash: hash,
    createdAt: "2026-07-30T00:00:00.000Z",
  };
  assert.equal(validateSchema(manifest), true, JSON.stringify(validateSchema.errors));
  const { sourceApp: _sourceApp, ...missingSourceApp } = manifest;
  assert.equal(validateSchema(missingSourceApp), false);
  assert.equal(
    validateSchema({
      ...manifest,
      entries: [{ ...manifest.entries[0], path: "..\\secret" }],
    }),
    false,
  );

  const result = validateContentPackageManifest({
    entries: [
      {
        artifactId: "artifact:1",
        path: "assets/Cover.png",
        mediaType: "image/png",
        contentHash: hash,
        sizeBytes: 1,
      },
      {
        artifactId: "artifact:1",
        path: "assets/cover.png",
        mediaType: "image/png",
        contentHash: hash,
        sizeBytes: 1,
      },
    ],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("Duplicate content package path")));
  assert.ok(result.errors.some((error) => error.includes("Duplicate content package artifact")));
});

test("connection endpoints reject embedded credentials without echoing values", () => {
  const baseProfile = {
    schemaVersion: "1.0",
    id: "connection:model:1",
    providerKind: "model",
    providerId: "openai-compatible",
    displayName: "Gateway",
    authMethod: "api_key",
    credentialRef: "secret://connections/model-1",
    capabilities: ["chat"],
    status: "ready",
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  };
  assert.equal(
    validateConnectionSecretBoundary({
      ...baseProfile,
      endpoint: "https://gateway.example/v1?api-version=2026-01-01",
    }).valid,
    true,
  );
  const userInfo = validateConnectionSecretBoundary({
    ...baseProfile,
    endpoint: "https://user:password@gateway.example/v1",
  });
  assert.equal(userInfo.valid, false);
  const querySecret = validateConnectionSecretBoundary({
    ...baseProfile,
    endpoint: "https://gateway.example/v1?api_key=do-not-echo",
  });
  assert.equal(querySecret.valid, false);
  assert.equal(querySecret.errors.join(" ").includes("do-not-echo"), false);
});

test("canonical Sidecar fixtures validate each Rust/Python wire definition", () => {
  const schemaId = "https://schemas.openpublisher.dev/v1/sidecar-protocol.schema.json";
  for (const [definition, fixture] of Object.entries(sidecarFixtures)) {
    const validate = ajv.compile({ $ref: `${schemaId}#/$defs/${definition}` });
    assert.equal(validate(fixture), true, `${definition}: ${JSON.stringify(validate.errors)}`);
  }

  const processedJob = sidecarFixtures.ProcessPublishJobResponse;
  const processedVariant = sidecarFixtures.PublishPlanDetailResponse.variants.find(
    (variant) => variant.id === processedJob.job.variant_id,
  );
  assert.ok(processedVariant, "processed job fixture must reference a known platform variant");
  assert.equal(processedJob.receipt.content_hash, processedVariant.content_hash);
  assert.notEqual(
    processedJob.receipt.content_hash,
    processedJob.job.payload_hash,
    "receipt content_hash represents canonical platform content, not the transport payload",
  );

  const validateDemo = ajv.compile({ $ref: `${schemaId}#/$defs/CompleteDemoRequest` });
  assert.equal(
    validateDemo({
      ...sidecarFixtures.CompleteDemoRequest,
      api_key: "must-not-cross-the-boundary",
    }),
    false,
  );

  const validateConnection = ajv.compile({
    $ref: `${schemaId}#/$defs/ConnectionProfilePublic`,
  });
  assert.equal(
    validateConnection({
      ...sidecarFixtures.ConnectionProfilePublic,
      secret_ref: "env://MUST_NOT_LEAK",
    }),
    false,
  );
});

test("publish jobs expose explicit unknown and reconciling states", () => {
  const validate = ajv.getSchema("https://schemas.openpublisher.dev/v1/publish-job.schema.json");
  const job = {
    schemaVersion: "1.0",
    id: "job:1",
    planId: "plan:1",
    targetId: "target:1",
    variantId: "variant:1",
    connectionProfileId: "connection:1",
    state: "unknown",
    idempotencyKey: "idempotency-key-0001",
    attempts: [],
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z",
  };
  assert.equal(validate(job), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...job, state: "reconciling" }), true, JSON.stringify(validate.errors));
});
