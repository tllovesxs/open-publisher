/**
 * Tracks a bounded local operation that does not have a durable Pi Run.
 * Writer and rewrite use RunJournal; visual planning, template analysis, and
 * image rendering are request/response operations and therefore need their
 * own explicit cancellation handle.
 */
export class OperationCancelledError extends Error {
  constructor() {
    super("Operation was stopped by the user");
    this.name = "OperationCancelledError";
  }
}

export const throwIfOperationCancelled = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new OperationCancelledError();
};

export const isOperationCancelled = (error: unknown): boolean =>
  error instanceof OperationCancelledError ||
  (error instanceof DOMException && error.name === "AbortError") ||
  (error instanceof Error && error.name === "AbortError");

export class OperationRegistry {
  private readonly active = new Map<string, AbortController>();

  async run<T>(operationId: string | undefined, task: (signal?: AbortSignal) => Promise<T>): Promise<T> {
    if (!operationId) return task(undefined);
    if (this.active.has(operationId)) {
      throw new Error("Operation id is already active");
    }
    const controller = new AbortController();
    this.active.set(operationId, controller);
    try {
      throwIfOperationCancelled(controller.signal);
      const result = await task(controller.signal);
      throwIfOperationCancelled(controller.signal);
      return result;
    } finally {
      if (this.active.get(operationId) === controller) this.active.delete(operationId);
    }
  }

  stop(operationId: string): boolean {
    const controller = this.active.get(operationId);
    if (!controller) return false;
    controller.abort();
    return true;
  }
}
