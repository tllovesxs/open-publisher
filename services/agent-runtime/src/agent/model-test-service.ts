import type { Agent } from "@earendil-works/pi-agent-core";
import type { TextModelProfile } from "./model-profile.js";
import { PiAgentAdapter, type WriterAgentFactory } from "./pi-adapter.js";

export interface ModelTestResult {
  readonly provider: string;
  readonly model: string;
  readonly latencyMs: number;
  readonly responseText: string;
  readonly mocked: boolean;
}

/**
 * Runs the same Pi provider wiring used by Writer, but with no product tools
 * and a bounded probe prompt. This keeps the settings test honest without
 * creating an article revision or exposing a provider key to the WebView.
 */
export class ModelTestService {
  constructor(private readonly factory: WriterAgentFactory = new PiAgentAdapter()) {}

  async test(
    profile: TextModelProfile,
    apiKey: string,
    timeoutMs = 20_000,
  ): Promise<ModelTestResult> {
    if (!apiKey.trim()) {
      throw new Error("Model API key is unavailable");
    }

    const startedAt = Date.now();
    let responseText = "";
    let agent: Agent | null = null;
    let promptError: unknown;

    agent = this.factory.createWriterAgent({
      profile,
      apiKey,
      systemPrompt: "You are a connectivity probe. Reply with OK only.",
      sessionId: `model-test:${profile.providerId}:${profile.modelId}`,
      tools: [],
      onEvent: (event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          responseText += event.assistantMessageEvent.delta;
        }
      },
    });

    const prompt = agent.prompt("Reply with OK only.").catch((error: unknown) => {
      promptError = error;
    });
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      prompt,
      new Promise<void>((resolve) => {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          agent?.abort();
          resolve();
        }, timeoutMs);
      }),
    ]);
    if (timeoutHandle) clearTimeout(timeoutHandle);

    if (timedOut) {
      throw new Error(`Model connection test timed out after ${timeoutMs}ms`);
    }
    if (promptError) {
      throw promptError instanceof Error ? promptError : new Error(String(promptError));
    }
    if (agent.state.errorMessage) {
      throw new Error(agent.state.errorMessage);
    }

    return {
      provider: profile.providerId,
      model: profile.modelId,
      latencyMs: Date.now() - startedAt,
      responseText: responseText.trim().slice(0, 300),
      mocked: false,
    };
  }
}
