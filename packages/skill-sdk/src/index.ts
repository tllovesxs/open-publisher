import type {
  Artifact,
  JsonValue,
  SkillManifest,
} from "@open-publisher/contracts";

export interface SkillInvocation {
  readonly runId: string;
  readonly nodeId: string;
  readonly inputArtifactIds: string[];
  readonly configuration: Record<string, JsonValue>;
}

export interface ModelRequest {
  capability: "chat" | "structured_output" | "embedding";
  prompt: string;
  responseSchema?: Record<string, unknown>;
  connectionProfileId?: string;
}

export interface ImageRequest {
  prompt: string;
  width: number;
  height: number;
  connectionProfileId?: string;
}

export interface SkillContext {
  readonly signal: AbortSignal;
  readArtifact(artifactId: string): Promise<Readonly<Artifact>>;
  emitArtifact(
    artifact: Omit<Artifact, "schemaVersion" | "id" | "runId" | "createdAt">,
  ): Promise<Readonly<Artifact>>;
  requestModel(request: ModelRequest): Promise<JsonValue>;
  requestImage(request: ImageRequest): Promise<Readonly<Artifact>>;
  emitProgress(progress: {
    phase: string;
    completed: number;
    total?: number;
    message?: string;
  }): void;
}

export type SkillResult =
  | {
      status: "SUCCEEDED";
      outputArtifactIds: string[];
    }
  | {
      status: "NEEDS_USER";
      reason: string;
      partialArtifactIds: string[];
    }
  | {
      status: "FAILED";
      code: string;
      message: string;
      retryable: boolean;
      partialArtifactIds: string[];
    };

export interface ExecutableSkill {
  readonly manifest: SkillManifest;
  execute(invocation: SkillInvocation, context: SkillContext): Promise<SkillResult>;
}

export function defineSkillManifest<const T extends SkillManifest>(manifest: T): T {
  if (manifest.runtime.kind === "declarative" && manifest.runtime.entrypoint !== undefined) {
    throw new Error("Declarative skills cannot declare executable entrypoints");
  }
  if (manifest.permissions.platformWrites) {
    throw new Error("Skills cannot perform platform writes; return an artifact instead");
  }
  return Object.freeze(manifest);
}
