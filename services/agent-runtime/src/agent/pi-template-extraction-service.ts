import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type { SecretProvider } from "../security/secret-provider.js";
import {
  TemplateService,
  type ExtractedTemplate,
  type TemplateTextModel,
} from "./template-service.js";
import type { TextModelProfile } from "./model-profile.js";
import { PiAgentAdapter, type WriterAgentFactory } from "./pi-adapter.js";
import { runWithModelDeadline } from "./model-deadline.js";
import { throwIfOperationCancelled } from "../operations/operation-registry.js";

const TEMPLATE_RETURN_PARAMETERS = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 500 }),
  description: Type.String({ minLength: 1, maxLength: 5_000 }),
  category: Type.String({ minLength: 1, maxLength: 200 }),
  markdown: Type.String({ minLength: 1, maxLength: 2_000_000 }),
  styleProfile: Type.Optional(Type.Object({
    tone: Type.Optional(Type.String({ maxLength: 20_000 })),
    audience: Type.Optional(Type.String({ maxLength: 20_000 })),
    perspective: Type.Optional(Type.String({ maxLength: 20_000 })),
    sentenceStyle: Type.Optional(Type.String({ maxLength: 20_000 })),
    pacing: Type.Optional(Type.String({ maxLength: 20_000 })),
    density: Type.Optional(Type.String({ maxLength: 20_000 })),
  })),
  structureProfile: Type.Optional(Type.Object({
    openingPattern: Type.Optional(Type.String({ maxLength: 20_000 })),
    sectionPattern: Type.Optional(Type.String({ maxLength: 20_000 })),
    conclusionPattern: Type.Optional(Type.String({ maxLength: 20_000 })),
    headingDepth: Type.Optional(Type.String({ maxLength: 20_000 })),
    paragraphPattern: Type.Optional(Type.String({ maxLength: 20_000 })),
  })),
  layoutProfile: Type.Optional(Type.Object({
    useLists: Type.Optional(Type.Boolean()),
    useTables: Type.Optional(Type.Boolean()),
    useBlockquotes: Type.Optional(Type.Boolean()),
    useCodeBlocks: Type.Optional(Type.Boolean()),
    imagePlacement: Type.Optional(Type.String({ maxLength: 20_000 })),
    emphasisRules: Type.Optional(Type.String({ maxLength: 20_000 })),
  })),
  variables: Type.Optional(Type.Array(Type.String({ pattern: "^[a-z][a-z0-9_]*$" }), { maxItems: 64 })),
  usageInstructions: Type.Optional(Type.String({ maxLength: 20_000 })),
  fixedBlocks: Type.Optional(Type.Array(Type.Never(), { maxItems: 0 })),
});

/** Pi-backed, single-tool text model used exclusively for template analysis. */
export class PiTemplateTextModel implements TemplateTextModel {
  constructor(
    private readonly profile: TextModelProfile,
    private readonly apiKey: string,
    private readonly factory: WriterAgentFactory = new PiAgentAdapter(),
  ) {}

  async generate(request: { readonly prompt: string; readonly maxOutputTokens: number }, signal?: AbortSignal): Promise<{
    text: string;
    provider: string;
    model: string;
    mocked: boolean;
  }> {
    let returned: unknown = null;
    const returnTool: AgentTool<typeof TEMPLATE_RETURN_PARAMETERS, { readonly accepted: true }> = {
      name: "return_template_analysis",
      label: "返回模板分析",
      description: "返回唯一一次完整的模板分析。不得调用其他工具。",
      parameters: TEMPLATE_RETURN_PARAMETERS,
      executionMode: "sequential",
      execute: async (_toolCallId, parameters) => {
        returned = parameters;
        return {
          content: [{ type: "text", text: "Template analysis accepted." }],
          details: { accepted: true },
          terminate: true,
        };
      },
    };
    const agent = this.factory.createWriterAgent({
      profile: this.profile,
      apiKey: this.apiKey,
      systemPrompt: "You extract reusable writing templates. Return results only via return_template_analysis.",
      sessionId: `template:${crypto.randomUUID()}`,
      tools: [returnTool],
      onEvent: () => undefined,
    });
    throwIfOperationCancelled(signal);
    await runWithModelDeadline(
      agent,
      this.profile,
      "Template extraction",
      () => agent.prompt(`${request.prompt}\n\nUse return_template_analysis now. Do not answer with prose.`),
      signal,
    );
    throwIfOperationCancelled(signal);
    if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
    if (!returned) throw new Error("Template model finished without structured output");
    return {
      text: JSON.stringify(returned),
      provider: this.profile.providerId,
      model: this.profile.modelId,
      mocked: false,
    };
  }
}

export interface TemplateExtractor {
  extract(profile: TextModelProfile, sourceMarkdown: string, signal?: AbortSignal): Promise<ExtractedTemplate>;
}

export class PiTemplateExtractionService implements TemplateExtractor {
  constructor(
    private readonly secrets: SecretProvider,
    private readonly factory: WriterAgentFactory = new PiAgentAdapter(),
  ) {}

  async extract(profile: TextModelProfile, sourceMarkdown: string, signal?: AbortSignal): Promise<ExtractedTemplate> {
    const apiKey = await this.secrets.resolve(profile.secretRef);
    if (!apiKey) throw new Error(`Model secret is unavailable: ${profile.secretRef}`);
    throwIfOperationCancelled(signal);
    return new TemplateService(new PiTemplateTextModel(profile, apiKey, this.factory)).extract(sourceMarkdown, signal);
  }
}
