import assert from "node:assert/strict";
import test from "node:test";

import type { SkillManifest } from "@open-publisher/contracts";

import { defineSkillManifest } from "../src/index.ts";

function manifest(overrides: Partial<SkillManifest> = {}): SkillManifest {
  return {
    schemaVersion: "1.0",
    id: "skill:test",
    name: "Test skill",
    version: "0.1.0",
    description: "A deterministic test skill.",
    inputs: [],
    outputs: [],
    runtime: {
      kind: "declarative",
    },
    permissions: {
      modelAccess: false,
      imageGeneration: false,
      networkAccess: false,
      platformWrites: false,
      filesystemRead: false,
      filesystemWrite: false,
    },
    ...overrides,
  };
}

test("safe declarative manifests are frozen at registration", () => {
  const registered = defineSkillManifest(manifest());
  assert.equal(Object.isFrozen(registered), true);
  assert.equal(registered.id, "skill:test");
});

test("skills cannot smuggle executable code or platform writes", () => {
  assert.throws(
    () =>
      defineSkillManifest(
        manifest({
          runtime: {
            kind: "declarative",
            entrypoint: "unsafe.js",
          },
        }),
      ),
    /cannot declare executable entrypoints/,
  );
  assert.throws(
    () =>
      defineSkillManifest(
        manifest({
          permissions: {
            ...manifest().permissions,
            platformWrites: true,
          },
        }),
      ),
    /cannot perform platform writes/,
  );
});
