import type { TextModelProfile } from "./model-profile.js";

export interface DiscoveredModel {
  readonly id: string;
  readonly name?: string;
}

export interface ModelDiscoveryResult {
  readonly models: DiscoveredModel[];
  readonly endpoint: string;
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const clean = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

export const parseDiscoveredModels = (value: unknown): DiscoveredModel[] => {
  const container = record(value)
    ? ["data", "models", "results", "items"]
        .map((key) => value[key])
        .find((candidate) => Array.isArray(candidate) || record(candidate))
    : value;
  const items = Array.isArray(container)
    ? container
    : record(container)
      ? Object.values(container)
      : [];
  const seen = new Set<string>();
  const models: DiscoveredModel[] = [];
  for (const item of items) {
    const rawId = typeof item === "string"
      ? item.trim()
      : record(item)
        ? clean(item.id) ?? clean(item.model) ?? clean(item.name) ?? ""
        : "";
    const id = rawId.startsWith("models/") ? rawId.slice("models/".length) : rawId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = record(item)
      ? clean(item.display_name) ?? clean(item.displayName)
        ?? ((clean(item.id) || clean(item.model)) ? clean(item.name) : undefined)
      : undefined;
    models.push(name && name !== id ? { id, name } : { id });
  }
  return models.sort((left, right) =>
    (left.name ?? left.id).localeCompare(right.name ?? right.id, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
};

export const buildModelsListUrl = (profile: TextModelProfile): URL => {
  const url = new URL(profile.baseUrl);
  const trimmedPath = url.pathname.replace(/\/+$/, "");
  if (!/\/models$/i.test(trimmedPath)) {
    let path = trimmedPath;
    if (profile.protocol === "anthropic-messages" && !/\/v\d+(?:beta)?$/i.test(path)) {
      path += "/v1";
    }
    if (profile.protocol === "google-generative-ai" && !/\/v\d+(?:beta)?$/i.test(path)) {
      path += "/v1beta";
    }
    url.pathname = `${path}/models`.replace(/\/{2,}/g, "/");
  }
  if (profile.protocol === "anthropic-messages") url.searchParams.set("limit", "1000");
  if (profile.protocol === "google-generative-ai") url.searchParams.set("pageSize", "1000");
  return url;
};

export const discoverModels = async (
  profile: TextModelProfile,
  apiKey: string,
  timeoutMs = 20_000,
): Promise<ModelDiscoveryResult> => {
  const endpoint = buildModelsListUrl(profile);
  const headers = new Headers({ Accept: "application/json" });
  if (profile.protocol === "anthropic-messages") {
    headers.set("x-api-key", apiKey);
    headers.set("anthropic-version", "2023-06-01");
  } else if (profile.protocol === "google-generative-ai") {
    headers.set("x-goog-api-key", apiKey);
  } else {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }
  const response = await fetch(endpoint, {
    cache: "no-store",
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(responseText.slice(0, 500) || `Model discovery returned HTTP ${response.status}`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new Error("Model discovery response was not valid JSON");
  }
  const models = parseDiscoveredModels(payload);
  if (models.length === 0) throw new Error("No models were found in the provider response");
  return { models, endpoint: endpoint.toString() };
};
