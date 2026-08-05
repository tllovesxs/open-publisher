export interface SecretProvider {
  resolve(secretRef: string): Promise<string | undefined>;
}

export interface SecretLeaseInput {
  readonly id: string;
  readonly secret: string;
  readonly providerId: string;
  readonly expiresAtEpochMs: number;
}

type StoredLease = SecretLeaseInput;

const ENV_SECRET_REF = /^env:\/\/([A-Z][A-Z0-9_]{0,127})$/;

/** Development bridge until Rust secret leases replace environment references. */
export class EnvironmentSecretProvider implements SecretProvider {
  async resolve(secretRef: string): Promise<string | undefined> {
    const match = ENV_SECRET_REF.exec(secretRef);
    if (!match?.[1]) {
      return undefined;
    }
    return process.env[match[1]];
  }
}

export class SecretLeaseStore implements SecretProvider {
  private readonly leases = new Map<string, StoredLease>();

  constructor(private readonly fallback?: SecretProvider) {}

  put(input: SecretLeaseInput): void {
    const expiresAtEpochMs = input.expiresAtEpochMs;
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(input.id) ||
      !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(input.providerId) ||
      input.secret.length < 1 ||
      !Number.isFinite(expiresAtEpochMs) ||
      expiresAtEpochMs <= Date.now() ||
      expiresAtEpochMs > Date.now() + 15 * 60_000
    ) {
      throw new Error("Secret lease is invalid or exceeds the 15 minute lifetime");
    }
    this.prune();
    this.leases.set(input.id, input);
  }

  async resolve(secretRef: string): Promise<string | undefined> {
    const leaseId = secretRef.startsWith("lease://") ? secretRef.slice("lease://".length) : null;
    if (!leaseId) {
      return this.fallback?.resolve(secretRef);
    }
    const lease = this.leases.get(leaseId);
    if (!lease || lease.expiresAtEpochMs <= Date.now()) {
      this.leases.delete(leaseId);
      return undefined;
    }
    return lease.secret;
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, lease] of this.leases) {
      if (lease.expiresAtEpochMs <= now) {
        this.leases.delete(id);
      }
    }
  }
}
