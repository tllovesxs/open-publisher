import type { Agent } from "@earendil-works/pi-agent-core";
import type { TextModelProfile } from "./model-profile.js";

export class ModelDeadlineExceededError extends Error {
  readonly code = "MODEL_DEADLINE_EXCEEDED";

  constructor(readonly operation: string, readonly timeoutSeconds: number) {
    super(`${operation} exceeded the configured model timeout (${timeoutSeconds}s)`);
    this.name = "ModelDeadlineExceededError";
  }
}

const cancellationError = (operation: string): Error => {
  const error = new Error(`${operation} was cancelled`);
  error.name = "AbortError";
  return error;
};

/**
 * Pi owns the request AbortSignal internally. Aborting the Agent propagates
 * the saved desktop model budget to that request. An optional outside signal
 * composes with, rather than replaces, Pi's own cancellation mechanism.
 */
export const runWithModelDeadline = async <T>(
  agent: Pick<Agent, "abort">,
  profile: Pick<TextModelProfile, "timeoutSeconds">,
  operation: string,
  work: () => Promise<T>,
  externalSignal?: AbortSignal,
): Promise<T> => {
  let expired = false;
  const timeoutError = new ModelDeadlineExceededError(operation, profile.timeoutSeconds);
  let rejectDeadline: ((reason: Error) => void) | undefined;
  let rejectCancellation: ((reason: Error) => void) | undefined;
  const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; });
  const cancellation = new Promise<never>((_, reject) => { rejectCancellation = reject; });
  const abortAgent = (): void => agent.abort();
  const onExternalAbort = (): void => {
    abortAgent();
    rejectCancellation?.(cancellationError(operation));
  };
  if (externalSignal?.aborted) onExternalAbort();
  else externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  const timer = setTimeout(() => {
    expired = true;
    abortAgent();
    rejectDeadline?.(timeoutError);
  }, profile.timeoutSeconds * 1_000);
  try {
    if (externalSignal?.aborted) throw cancellationError(operation);
    return await Promise.race([work(), deadline, cancellation]);
  } catch (error: unknown) {
    if (expired) throw timeoutError;
    if (externalSignal?.aborted) throw cancellationError(operation);
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
};
