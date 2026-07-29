import type {
  ConnectionProfile,
  ContractError,
  JsonValue,
  PlatformAdapterManifest,
  PlatformVariant,
  PublishJob,
  PublishReceipt,
} from "@open-publisher/contracts";

export interface AdapterExecutionContext {
  readonly runId: string;
  readonly jobId: string;
  readonly attemptNumber: number;
  readonly idempotencyKey: string;
  readonly signal: AbortSignal;
  emitDiagnostic(event: {
    level: "debug" | "info" | "warning" | "error";
    code: string;
    message: string;
    details?: JsonValue;
  }): void;
}

export interface CapabilityProbeResult {
  status: "READY" | "NEEDS_USER" | "UNSUPPORTED";
  capabilities: string[];
  reason?: string;
  observedAt: string;
}

export interface PrepareDraftRequest {
  variant: PlatformVariant;
  connection: ConnectionProfile;
}

export interface PrepareDraftResult {
  status: "PREPARED" | "NEEDS_USER" | "UNSUPPORTED";
  payloadHash?: `sha256:${string}`;
  preview?: JsonValue;
  reason?: string;
}

export type AdapterJobResult =
  | {
      status: "DRAFT_SAVED" | "PUBLISHED";
      receipt: PublishReceipt;
    }
  | {
      status: "NEEDS_USER";
      reason: string;
      retryable: false;
      diagnostics?: JsonValue;
    }
  | {
      status: "UNKNOWN_REMOTE_STATE";
      reason: string;
      retryable: false;
      remoteId?: string;
      diagnostics?: JsonValue;
    }
  | {
      status: "RETRYABLE_ERROR" | "PERMANENT_ERROR";
      error: ContractError;
    };

export interface ReconcileRequest {
  job: PublishJob;
  connection: ConnectionProfile;
  remoteId?: string;
}

export interface ReconcileResult {
  state: "matched" | "mismatched" | "not_found" | "unknown";
  receipt?: PublishReceipt;
  details?: JsonValue;
}

/**
 * Implementations are invoked only by the deterministic PublishService.
 * The SDK deliberately exposes opaque connection references, never plaintext
 * credentials or browser cookies.
 */
export interface PlatformAdapter {
  readonly manifest: PlatformAdapterManifest;
  probe(
    connection: ConnectionProfile,
    context: AdapterExecutionContext,
  ): Promise<CapabilityProbeResult>;
  prepareDraft(
    request: PrepareDraftRequest,
    context: AdapterExecutionContext,
  ): Promise<PrepareDraftResult>;
  executeJob(
    job: PublishJob,
    variant: PlatformVariant,
    connection: ConnectionProfile,
    context: AdapterExecutionContext,
  ): Promise<AdapterJobResult>;
  reconcile(
    request: ReconcileRequest,
    context: AdapterExecutionContext,
  ): Promise<ReconcileResult>;
}

export function needsUser(reason: string, diagnostics?: JsonValue): AdapterJobResult {
  return diagnostics === undefined
    ? { status: "NEEDS_USER", reason, retryable: false }
    : { status: "NEEDS_USER", reason, retryable: false, diagnostics };
}

export function unknownRemoteState(
  reason: string,
  options: { remoteId?: string; diagnostics?: JsonValue } = {},
): AdapterJobResult {
  return {
    status: "UNKNOWN_REMOTE_STATE",
    reason,
    retryable: false,
    ...options,
  };
}

export function assertSafeBrowserAdapterManifest(manifest: PlatformAdapterManifest): void {
  if (manifest.transport !== "browser_extension") {
    return;
  }
  if (manifest.permissions.cookieAccess || manifest.safeDefaults.exportsCookies) {
    throw new Error("Browser adapters must not access or export cookies");
  }
  if (!manifest.safeDefaults.finalPublishRequiresUser) {
    throw new Error("Browser adapters must require the user for final publication");
  }
  if (manifest.safeDefaults.defaultMode !== "save_draft") {
    throw new Error("Browser adapters must default to saving a draft");
  }
  const patterns = [...manifest.permissions.hostPatterns, ...(manifest.editorUrlPatterns ?? [])];
  if (
    patterns.some(
      (pattern) =>
        !/^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::[0-9]{1,5})?\/\S*$/.test(
          pattern,
        ),
    )
  ) {
    throw new Error("Browser adapter hosts must be explicit HTTPS patterns");
  }
}
