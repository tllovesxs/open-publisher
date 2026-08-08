import type { Context, FetchFunction, Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { describe, expect, it } from "vitest";
import { withOpenAICompletionsFinishReasonCompatibility } from "../src/agent/openai-completions-compat.js";

const sseResponse = (body: string): Response => new Response(body, {
  headers: { "content-type": "text/event-stream; charset=utf-8" },
});

const wrap = (body: string) => withOpenAICompletionsFinishReasonCompatibility(
  Object.assign(async () => sseResponse(body), { preconnect: () => undefined }) as FetchFunction,
)("https://provider.invalid/v1/chat/completions").then((response) => response.text());

const wrapChunks = (chunks: string[]) => {
  const encoder = new TextEncoder();
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
  return withOpenAICompletionsFinishReasonCompatibility(
    Object.assign(async () => response, { preconnect: () => undefined }) as FetchFunction,
  )("https://provider.invalid/v1/chat/completions").then((result) => result.text());
};

describe("OpenAI completions stream compatibility", () => {
  it("adds a stop finish reason before a clean DONE marker", async () => {
    const body = [
      'data: {"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":null}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    const repaired = await wrap(body);

    expect(repaired).toContain('"finish_reason":"stop"');
    expect(repaired.indexOf('"finish_reason":"stop"')).toBeLessThan(repaired.indexOf("[DONE]"));
  });

  it("uses tool_calls when the stream contains a tool call", async () => {
    const body = [
      'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"read","arguments":"{}"}}]},"finish_reason":null}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    expect(await wrap(body)).toContain('"finish_reason":"tool_calls"');
  });

  it("does not duplicate an existing finish reason", async () => {
    const body = [
      'data: {"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":"stop"}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");

    expect((await wrap(body)).match(/finish_reason/g)).toHaveLength(1);
  });

  it("does not turn a truncated bare EOF into success", async () => {
    const body = 'data: {"choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\n';

    const unchanged = await wrap(body);

    expect(unchanged).toBe(body);
    expect(unchanged).not.toContain('"finish_reason":"stop"');
  });

  it("repairs DONE even when network chunks split the SSE boundary", async () => {
    const repaired = await wrapChunks([
      'data: {"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":null}]}\r',
      "\n\r",
      "\ndata: [DO",
      "NE]\r\n\r\n",
    ]);

    expect(repaired).toContain('"finish_reason":"stop"');
    expect(repaired).toContain("data: [DONE]");
  });

  it("lets the real Pi completions parser finish a vendor stream without finish_reason", async () => {
    const body = [
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":0,"model":"deepseek-ai/DeepSeek-V3.2","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
      "",
      'data: {"id":"chatcmpl-1","object":"chat.completion.chunk","created":0,"model":"deepseek-ai/DeepSeek-V3.2","choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":null}]}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const fetch = withOpenAICompletionsFinishReasonCompatibility(
      Object.assign(async () => sseResponse(body), { preconnect: () => undefined }) as FetchFunction,
    );
    const model: Model<"openai-completions"> = {
      id: "deepseek-ai/DeepSeek-V3.2",
      name: "DeepSeek V3.2",
      api: "openai-completions",
      provider: "zhipu-compatible",
      baseUrl: "https://provider.invalid/v1",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 16_384,
      compat: {
        supportsDeveloperRole: false,
        supportsStrictMode: false,
        supportsReasoningEffort: false,
      },
    };
    const context: Context = {
      messages: [{ role: "user", content: "Reply with OK only.", timestamp: Date.now() }],
      tools: [],
    };
    const stream = openAICompletionsApi().streamSimple(model, context, {
      apiKey: "test-key",
      fetch,
    });
    const events = [];

    for await (const event of stream) events.push(event);
    const result = await stream.result();

    expect(events.at(-1)?.type).toBe("done");
    expect(result.stopReason).toBe("stop");
    expect(result.content).toContainEqual({ type: "text", text: "OK" });
  });
});
