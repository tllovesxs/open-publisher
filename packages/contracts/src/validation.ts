import type {
  ConnectionProfile,
  ContentPackageManifest,
  WorkflowDefinition,
} from "./types.js";

export interface SemanticValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateWorkflowGraph(
  workflow: Pick<
    WorkflowDefinition,
    "nodes" | "edges" | "entryNodeIds" | "requiredNodeIds"
  >,
): SemanticValidationResult {
  const errors: string[] = [];
  const nodeIds = new Set<string>();
  const nodeById = new Map(workflow.nodes.map((node) => [node.id, node]));

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

  for (const requiredNodeId of workflow.requiredNodeIds) {
    const requiredNode = nodeById.get(requiredNodeId);
    if (requiredNode === undefined) {
      errors.push(`Required node does not exist: ${requiredNodeId}`);
    } else if (requiredNode.optional === true) {
      errors.push(`Required node cannot be optional: ${requiredNodeId}`);
    }
  }

  const adjacency = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  for (const nodeId of nodeIds) {
    adjacency.set(nodeId, new Set());
    indegree.set(nodeId, 0);
  }
  const edgeKeys = new Set<string>();

  for (const edge of workflow.edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push(`Edge source does not exist: ${edge.from}`);
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`Edge target does not exist: ${edge.to}`);
    }
    const edgeKey = `${edge.from}\u0000${edge.to}`;
    if (edgeKeys.has(edgeKey)) {
      errors.push(`Duplicate workflow edge: ${edge.from} -> ${edge.to}`);
    }
    edgeKeys.add(edgeKey);
    if (edge.from === edge.to) {
      errors.push(`Workflow self-loop is forbidden: ${edge.from}`);
    }
    if (
      nodeIds.has(edge.from) &&
      nodeIds.has(edge.to) &&
      edge.from !== edge.to &&
      !adjacency.get(edge.from)?.has(edge.to)
    ) {
      adjacency.get(edge.from)?.add(edge.to);
      indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    }
  }

  const reachable = new Set<string>();
  const pendingReachability = workflow.entryNodeIds.filter((nodeId) => nodeIds.has(nodeId));
  while (pendingReachability.length > 0) {
    const nodeId = pendingReachability.pop();
    if (nodeId === undefined || reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    pendingReachability.push(...(adjacency.get(nodeId) ?? []));
  }
  for (const nodeId of nodeIds) {
    if (!reachable.has(nodeId)) {
      errors.push(`Workflow node is unreachable from every entry: ${nodeId}`);
    }
  }

  const zeroIndegree = [...indegree.entries()]
    .filter(([, count]) => count === 0)
    .map(([nodeId]) => nodeId);
  let visitedCount = 0;
  while (zeroIndegree.length > 0) {
    const nodeId = zeroIndegree.pop();
    if (nodeId === undefined) continue;
    visitedCount += 1;
    for (const target of adjacency.get(nodeId) ?? []) {
      const nextIndegree = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, nextIndegree);
      if (nextIndegree === 0) zeroIndegree.push(target);
    }
  }
  if (visitedCount !== nodeIds.size) {
    errors.push("Workflow graph must be acyclic");
  }

  return { valid: errors.length === 0, errors };
}

const SENSITIVE_ENDPOINT_QUERY_KEYS = new Set([
  "apikey",
  "key",
  "token",
  "accesstoken",
  "secret",
  "clientsecret",
  "signature",
  "sig",
  "password",
  "authorization",
  "auth",
]);

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
  if (profile.endpoint !== undefined) {
    try {
      const endpoint = new URL(profile.endpoint);
      if (endpoint.username !== "" || endpoint.password !== "") {
        errors.push("endpoint must not contain URI user information");
      }
      for (const queryKey of endpoint.searchParams.keys()) {
        const normalizedKey = queryKey.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (SENSITIVE_ENDPOINT_QUERY_KEYS.has(normalizedKey)) {
          errors.push(`endpoint must not contain sensitive query parameter: ${queryKey}`);
        }
      }
      if (endpoint.hash !== "") {
        errors.push("endpoint must not contain a URI fragment");
      }
    } catch {
      errors.push("endpoint must be an absolute URI");
    }
  }

  return { valid: errors.length === 0, errors };
}

const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const FORBIDDEN_PACKAGE_PATH_CHARACTERS = /[\\<>:"|?*\u0000-\u001f\u007f]/;

export function isCanonicalContentPackagePath(path: string): boolean {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("//") ||
    FORBIDDEN_PACKAGE_PATH_CHARACTERS.test(path) ||
    path !== path.normalize("NFC")
  ) {
    return false;
  }
  const segments = path.split("/");
  return segments.every(
    (segment) =>
      segment !== "" &&
      segment !== "." &&
      segment !== ".." &&
      !segment.endsWith(".") &&
      !segment.endsWith(" ") &&
      !WINDOWS_RESERVED_SEGMENT.test(segment),
  );
}

export function validateContentPackageManifest(
  manifest: Pick<ContentPackageManifest, "entries">,
): SemanticValidationResult {
  const errors: string[] = [];
  const portablePaths = new Set<string>();
  const artifactIds = new Set<string>();

  if (manifest.entries.length === 0) {
    errors.push("Content package must contain at least one entry");
  }

  for (const entry of manifest.entries) {
    if (!isCanonicalContentPackagePath(entry.path)) {
      errors.push(`Content package path is not canonical and portable: ${entry.path}`);
    }
    const portablePath = entry.path.normalize("NFC").toLowerCase();
    if (portablePaths.has(portablePath)) {
      errors.push(`Duplicate content package path: ${entry.path}`);
    }
    portablePaths.add(portablePath);
    if (artifactIds.has(entry.artifactId)) {
      errors.push(`Duplicate content package artifact id: ${entry.artifactId}`);
    }
    artifactIds.add(entry.artifactId);
  }

  return { valid: errors.length === 0, errors };
}
