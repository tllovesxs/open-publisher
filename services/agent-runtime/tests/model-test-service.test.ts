import { Agent } from "@earendil-works/pi-agent-core";
import { createModels, fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import type { CreateWriterAgentOptions, WriterAgentFactory } from "../src/agent/pi-adapter.js";
import { ModelTestService } from "../src/agent/model-test-service.js";

class FauxModelTestFactory implements WriterAgentFactory {
  createWriterAgent(options: CreateWriterAgentOptions): Agent {
    const faux = fauxProvider({ provider: "faux-model-test", tokensPerSecond: 10_000 });
    faux.setResponses([fauxAssistantMessage("OK")]);
    const models = createModels();
    models.setProvider(faux.provider);
    const agent = new Agent({
      initialState: {
        systemPrompt: options.systemPrompt,
        model: faux.getModel(),
        tools: options.tools,
        messages: [],
        thinkingLevel: "off",
      },
      streamFn: models.streamSimple.bind(models),
      sessionId: options.sessionId,
      toolExecution: "sequential",
    });
    agent.subscribe(options.onEvent);
    return agent;
  }
}

describe("ModelTestService", () => {
  it("probes the Pi provider without invoking product tools", async () => {
    const result = await new ModelTestService(new FauxModelTestFactory()).test(
      {
        providerId: "configured-model",
        displayName: "Configured model",
        protocol: "openai-responses",
        baseUrl: "https://example.invalid/v1",
        modelId: "test-model",
        secretRef: "env://MODEL_TEST_KEY",
        supportsVision: false,
        reasoning: false,
        thinkingLevel: "off",
        contextWindow: 32_768,
        maxTokens: 4_096,
        timeoutSeconds: 120,
      },
      "test-key",
    );

    expect(result.provider).toBe("configured-model");
    expect(result.model).toBe("test-model");
    expect(result.responseText).toBe("OK");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.mocked).toBe(false);
  });
});
