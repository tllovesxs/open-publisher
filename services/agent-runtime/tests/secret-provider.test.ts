import { describe, expect, it, vi } from "vitest";
import { SecretLeaseStore } from "../src/security/secret-provider.js";

describe("SecretLeaseStore", () => {
  it("resolves an unexpired in-memory lease without exposing it in the reference", async () => {
    const store = new SecretLeaseStore();
    store.put({
      id: "lease:test",
      secret: "private-test-key",
      providerId: "openai-compatible",
      expiresAtEpochMs: Date.now() + 60_000,
    });

    await expect(store.resolve("lease://lease:test")).resolves.toBe("private-test-key");
    await expect(store.resolve("lease://missing")).resolves.toBeUndefined();
  });

  it("drops an expired lease", async () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-08-04T00:00:00.000Z");
      vi.setSystemTime(now);
      const store = new SecretLeaseStore();
      store.put({
        id: "lease:short",
        secret: "private-test-key",
        providerId: "openai-compatible",
        expiresAtEpochMs: now.getTime() + 1_000,
      });
      vi.setSystemTime(new Date(now.getTime() + 2_000));

      await expect(store.resolve("lease://lease:short")).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
