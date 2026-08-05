import { describe, expect, it } from "vitest";
import { buildModelsListUrl, parseDiscoveredModels } from "../src/agent/model-discovery.js";
import type { TextModelProfile } from "../src/agent/model-profile.js";

const profile = (protocol: TextModelProfile["protocol"], baseUrl: string): TextModelProfile => ({
  providerId: "test-provider",
  displayName: "Test Provider",
  protocol,
  baseUrl,
  modelId: "test-model",
  secretRef: "env://TEST_KEY",
  supportsVision: false,
  reasoning: false,
  thinkingLevel: "off",
  contextWindow: 32_768,
  maxTokens: 4_096,
  timeoutSeconds: 120,
});

describe("Pi model discovery", () => {
  it("normalizes OpenAI, Anthropic, and Google model endpoints", () => {
    expect(buildModelsListUrl(profile("openai-responses", "https://example.com/v1")).toString())
      .toBe("https://example.com/v1/models");
    expect(buildModelsListUrl(profile("anthropic-messages", "https://api.anthropic.com")).toString())
      .toBe("https://api.anthropic.com/v1/models?limit=1000");
    expect(buildModelsListUrl(profile("google-generative-ai", "https://generativelanguage.googleapis.com")).toString())
      .toBe("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000");
  });

  it("accepts common provider response shapes and removes duplicates", () => {
    expect(parseDiscoveredModels({
      data: [
        { id: "gpt-5", name: "GPT 5" },
        { model: "gpt-5" },
        { name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
      ],
    })).toEqual([
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
      { id: "gpt-5", name: "GPT 5" },
    ]);
  });
});
