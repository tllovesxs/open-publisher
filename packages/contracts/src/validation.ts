import type { ConnectionProfile, WorkflowDefinition } from "./types.js";

export interface SemanticValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateWorkflowGraph(
  workflow: Pick<WorkflowDefinition, "nodes" | "edges" | "entryNodeIds">,
): SemanticValidationResult {
  const errors: string[] = [];
  const nodeIds = new Set<string>();

  for (const node of workflow.nodes) {
    if (nodeIds.has(node.id)) {
      errors.push(`Duplicate workflow node id: ${node.id}`);
    }
    nodeIds.add(node.id);
  }

  for (const entryNodeId of workflow.entryNodeIds) {
    if (!nodeIds.has(entryNodeId)) {
      errors.push(`Entry node does not exist: ${entryNodeId}`);
    }
  }

  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push(`Edge source does not exist: ${edge.from}`);
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`Edge target does not exist: ${edge.to}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateConnectionSecretBoundary(
  profile: ConnectionProfile,
): SemanticValidationResult {
  const errors: string[] = [];

  if (profile.credentialRef !== undefined && !profile.credentialRef.startsWith("secret://")) {
    errors.push("credentialRef must be an opaque secret:// reference");
  }
  if (
    profile.browserProfileRef !== undefined &&
    !profile.browserProfileRef.startsWith("browser-profile://")
  ) {
    errors.push("browserProfileRef must be an opaque browser-profile:// reference");
  }
  if (profile.authMethod === "browser_session" && profile.browserProfileRef === undefined) {
    errors.push("browser_session requires browserProfileRef");
  }
  if (profile.authMethod === "browser_session" && profile.credentialRef !== undefined) {
    errors.push("browser_session must not include credentialRef");
  }

  return { valid: errors.length === 0, errors };
}
