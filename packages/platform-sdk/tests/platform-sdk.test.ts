import assert from "node:assert/strict";
import test from "node:test";

import type { PlatformAdapterManifest } from "@open-publisher/contracts";

import {
  assertSafeBrowserAdapterManifest,
  needsUser,
  unknownRemoteState,
} from "../src/index.ts";

function browserManifest(
  overrides: Partial<PlatformAdapterManifest> = {},
): PlatformAdapterManifest {
  return {
    schemaVersion: "1.0",
    id: "adapter:browser:test",
    platformId: "test",
    displayName: "Test browser adapter",
    version: "0.1.0",
    transport: "browser_extension",
    capabilities: ["save_draft"],
    authMethods: ["browser_session"],
    editorUrlPatterns: ["https://editor.example.com/*"],
    permissions: {
      network: true,
      cookieAccess: false,
      localFileRead: false,
      localFileWrite: false,
      hostPatterns: ["https://editor.example.com/*"],
    },
    safeDefaults: {
      defaultMode: "save_draft",
      finalPublishRequiresUser: true,
      exportsCookies: false,
    },
    ...overrides,
  };
}

test("result helpers keep ambiguous and user-required work non-retryable", () => {
  assert.deepEqual(needsUser("review"), {
    status: "NEEDS_USER",
    reason: "review",
    retryable: false,
  });
  assert.deepEqual(unknownRemoteState("timeout", { remoteId: "remote:1" }), {
    status: "UNKNOWN_REMOTE_STATE",
    reason: "timeout",
    retryable: false,
    remoteId: "remote:1",
  });
});

test("browser adapter manifests enforce the reviewed authority boundary", () => {
  assert.doesNotThrow(() => assertSafeBrowserAdapterManifest(browserManifest()));
  assert.throws(
    () =>
      assertSafeBrowserAdapterManifest(
        browserManifest({
          permissions: {
            ...browserManifest().permissions,
            cookieAccess: true,
          },
        }),
      ),
    /must not access or export cookies/,
  );
  assert.throws(
    () =>
      assertSafeBrowserAdapterManifest(
        browserManifest({
          editorUrlPatterns: ["http://editor.example.com/*"],
        }),
      ),
    /explicit HTTPS patterns/,
  );
});
