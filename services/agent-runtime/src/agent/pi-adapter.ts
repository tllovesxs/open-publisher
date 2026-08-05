import {
  Agent,
  type AgentEvent,
  type AgentTool,
  type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import {
  createModels,
  createProvider,
  type Model,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import type { TextModelProfile } from "./model-profile.js";

export interface CreateWriterAgentOptions {
  readonly profile: TextModelProfile;
  readonly apiKey: string;
  readonly systemPrompt: string;
  readonly sessionId: string;
  readonly tools: AgentTool[];
  readonly onEvent: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void;
}

export interface WriterAgentFactory {
  createWriterAgent(options: CreateWriterAgentOptions): Agent;
}

/** Isolates all Pi-specific types and provider wiring from product services. */
export class PiAgentAdapter implements WriterAgentFactory {
  createWriterAgent(options: CreateWriterAgentOptions): Agent {
    const profile = options.profile;
    const model: Model<TextModelProfile["protocol"]> = {
      id: profile.modelId,
      name: profile.modelId,
      api: profile.protocol,
      provider: profile.providerId,
      baseUrl: profile.baseUrl.replace(/\/$/, ""),
      reasoning: profile.reasoning,
      input: profile.supportsVision ? ["text", "image"] : ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: profile.contextWindow,
      maxTokens: profile.maxTokens,
      ...(profile.protocol === "openai-responses"
        ? { compat: { supportsStrictMode: false } }
        : profile.protocol === "openai-completions"
          ? { compat: {
              supportsStrictMode: false,
              supportsDeveloperRole: false,
              supportsReasoningEffort: profile.reasoning,
            } }
          : profile.protocol === "anthropic-messages"
            ? { compat: { supportsStrictTools: false } }
            : {}),
    };
    const provider = createProvider<TextModelProfile["protocol"]>({
      id: profile.providerId,
      name: profile.displayName,
      baseUrl: model.baseUrl,
      auth: {
        apiKey: {
          name: `${profile.displayName} API key`,
          resolve: async () => ({ auth: {} }),
        },
      },
      models: [model],
      api: {
        "openai-responses": openAIResponsesApi(),
        "openai-completions": openAICompletionsApi(),
        "anthropic-messages": anthropicMessagesApi(),
        "google-generative-ai": googleGenerativeAIApi(),
      },
    });
    const models = createModels();
    models.setProvider(provider);
    const resolvedModel = models.getModel(profile.providerId, profile.modelId);
    if (!resolvedModel) {
      throw new Error(`Pi did not register model ${profile.providerId}/${profile.modelId}`);
    }

    const agent = new Agent({
      initialState: {
        systemPrompt: options.systemPrompt,
        model: resolvedModel,
        thinkingLevel: resolveThinkingLevel(profile.thinkingLevel, profile.reasoning),
        tools: options.tools,
        messages: [],
      },
      streamFn: models.streamSimple.bind(models),
      getApiKey: () => options.apiKey,
      sessionId: options.sessionId,
      toolExecution: "sequential",
      steeringMode: "one-at-a-time",
      followUpMode: "one-at-a-time",
      beforeToolCall: async ({ toolCall }) => {
        if (!options.tools.some((tool) => tool.name === toolCall.name)) {
          return { block: true, reason: `Tool is not authorized: ${toolCall.name}` };
        }
        return undefined;
      },
    });
    agent.subscribe(options.onEvent);
    return agent;
  }
}

function resolveThinkingLevel(
  configured: TextModelProfile["thinkingLevel"],
  reasoning: boolean,
): ThinkingLevel {
  if (configured === "auto") return reasoning ? "medium" : "off";
  return configured;
}
