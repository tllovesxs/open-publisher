export type SupportedTextProtocol =
  | "openai-responses"
  | "openai-completions"
  | "anthropic-messages"
  | "google-generative-ai";

export type ConfiguredThinkingLevel =
  | "auto"
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

/**
 * Native web search is opt-in per profile. OpenAI-compatible endpoint and
 * model names alone are not reliable capability signals.
 */
export type NativeWebSearchMode = "auto" | "enabled" | "disabled";

export interface TextModelProfile {
  readonly providerId: string;
  readonly displayName: string;
  readonly protocol: SupportedTextProtocol;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly secretRef: string;
  readonly supportsVision: boolean;
  readonly reasoning: boolean;
  readonly thinkingLevel: ConfiguredThinkingLevel;
  readonly contextWindow: number;
  readonly maxTokens: number;
  /** Maximum wall-clock time for one Pi text-model operation. */
  readonly timeoutSeconds: number;
  readonly nativeWebSearch?: NativeWebSearchMode;
  /** Optional leased fallback credentials. They never cross into the WebView. */
  readonly tavilySecretRef?: string;
  readonly githubSecretRef?: string;
}

export const validateTextModelProfile = (value: unknown): value is TextModelProfile => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const profile = value as Partial<TextModelProfile>;
  return (
    typeof profile.providerId === "string" &&
    /^[a-z0-9][a-z0-9_-]{0,79}$/.test(profile.providerId) &&
    typeof profile.displayName === "string" &&
    profile.displayName.trim().length > 0 &&
    [
      "openai-responses",
      "openai-completions",
      "anthropic-messages",
      "google-generative-ai",
    ].includes(profile.protocol ?? "") &&
    typeof profile.baseUrl === "string" &&
    /^https?:\/\//.test(profile.baseUrl) &&
    typeof profile.modelId === "string" &&
    profile.modelId.trim().length > 0 &&
    typeof profile.secretRef === "string" &&
    /^(env:\/\/[A-Z][A-Z0-9_]{0,127}|lease:\/\/[A-Za-z0-9][A-Za-z0-9._:-]{0,199})$/.test(
      profile.secretRef,
    ) &&
    typeof profile.supportsVision === "boolean" &&
    typeof profile.reasoning === "boolean" &&
    ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(
      profile.thinkingLevel ?? "",
    ) &&
    Number.isInteger(profile.contextWindow) &&
    (profile.contextWindow ?? 0) >= 8_192 &&
    Number.isInteger(profile.maxTokens) &&
    (profile.maxTokens ?? 0) >= 1_024 &&
    Number.isInteger(profile.timeoutSeconds) &&
    (profile.timeoutSeconds ?? 0) >= 1 &&
    (profile.timeoutSeconds ?? 0) <= 1_800 &&
    (profile.nativeWebSearch === undefined ||
      ["auto", "enabled", "disabled"].includes(profile.nativeWebSearch)) &&
    (profile.tavilySecretRef === undefined ||
      /^(env:\/\/[A-Z][A-Z0-9_]{0,127}|lease:\/\/[A-Za-z0-9][A-Za-z0-9._:-]{0,199})$/.test(
        profile.tavilySecretRef,
      )) &&
    (profile.githubSecretRef === undefined ||
      /^(env:\/\/[A-Z][A-Z0-9_]{0,127}|lease:\/\/[A-Za-z0-9][A-Za-z0-9._:-]{0,199})$/.test(
        profile.githubSecretRef,
      ))
  );
};
