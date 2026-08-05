import { describe, expect, it, vi } from "vitest";
import { ModelDeadlineExceededError, runWithModelDeadline } from "../src/agent/model-deadline.js";

describe("runWithModelDeadline", () => {
  it("aborts Pi work and returns a structured deadline error", async () => {
    vi.useFakeTimers();
    const agent = { abort: vi.fn() };
    const work = vi.fn(() => new Promise<never>(() => undefined));
    const result = runWithModelDeadline(agent as never, { timeoutSeconds: 3 }, "Article generation", work);
    const expectation = expect(result).rejects.toMatchObject({
      name: "ModelDeadlineExceededError",
      code: "MODEL_DEADLINE_EXCEEDED",
      operation: "Article generation",
      timeoutSeconds: 3,
    } satisfies Partial<ModelDeadlineExceededError>);

    await vi.advanceTimersByTimeAsync(3_000);

    await expectation;
    expect(agent.abort).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("composes an outside cancellation signal without replacing Pi abort", async () => {
    const controller = new AbortController();
    const agent = { abort: vi.fn() };
    const pending = runWithModelDeadline(
      agent as never,
      { timeoutSeconds: 120 },
      "Visual planning",
      () => new Promise<never>(() => undefined),
      controller.signal,
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(agent.abort).toHaveBeenCalledTimes(1);
  });
});
