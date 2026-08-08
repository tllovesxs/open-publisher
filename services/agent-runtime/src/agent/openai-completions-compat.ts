import type { FetchFunction } from "@earendil-works/pi-ai";

const SSE_CONTENT_TYPE = "text/event-stream";

const eventData = (event: string): string => event
  .replaceAll("\r\n", "\n")
  .split("\n")
  .filter((line) => line.startsWith("data:"))
  .map((line) => line.slice(5).trimStart())
  .join("\n")
  .trim();

const syntheticFinishEvent = (reason: "stop" | "tool_calls"): string => `data: ${JSON.stringify({
  choices: [{ index: 0, delta: {}, finish_reason: reason }],
})}\n\n`;

/**
 * Some OpenAI-compatible vendors send the documented SSE [DONE] marker but
 * omit a non-null finish_reason chunk. Pi intentionally rejects a bare EOF,
 * so only repair streams that contain [DONE]. Transport truncation remains an
 * error instead of being mistaken for a successful, complete response.
 */
export const withOpenAICompletionsFinishReasonCompatibility = (
  fetchImpl: FetchFunction = globalThis.fetch,
): FetchFunction => Object.assign(async (
  input: Parameters<FetchFunction>[0],
  init?: Parameters<FetchFunction>[1],
) => {
  const response = await fetchImpl(input, init);
  if (
    !response.ok ||
    !response.body ||
    !response.headers.get("content-type")?.toLowerCase().includes(SSE_CONTENT_TYPE)
  ) {
    return response;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let hasFinishReason = false;
  let hasToolCalls = false;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      while (true) {
        const boundary = buffer.match(/\r?\n\r?\n/u);
        if (boundary?.index !== undefined) {
          const end = boundary.index + boundary[0].length;
          const event = buffer.slice(0, end);
          buffer = buffer.slice(end);
          const data = eventData(event);

          if (data === "[DONE]" && !hasFinishReason) {
            controller.enqueue(encoder.encode(syntheticFinishEvent(hasToolCalls ? "tool_calls" : "stop")));
          } else if (data && data !== "[DONE]") {
            try {
              const payload = JSON.parse(data) as {
                choices?: Array<{
                  finish_reason?: unknown;
                  delta?: { tool_calls?: unknown };
                  message?: { tool_calls?: unknown };
                }>;
              };
              for (const choice of payload.choices ?? []) {
                if (typeof choice.finish_reason === "string" && choice.finish_reason.trim()) {
                  hasFinishReason = true;
                }
                if (
                  (Array.isArray(choice.delta?.tool_calls) && choice.delta.tool_calls.length > 0) ||
                  (Array.isArray(choice.message?.tool_calls) && choice.message.tool_calls.length > 0)
                ) {
                  hasToolCalls = true;
                }
              }
            } catch {
              // Preserve vendor-specific SSE payloads unchanged. Pi will report
              // a useful provider error if the OpenAI SDK cannot parse them.
            }
          }

          controller.enqueue(encoder.encode(event));
          return;
        }

        const next = await reader.read();
        if (!next.done) {
          buffer += decoder.decode(next.value, { stream: true });
          continue;
        }

        buffer += decoder.decode();
        if (buffer) {
          const data = eventData(buffer);
          if (data === "[DONE]" && !hasFinishReason) {
            controller.enqueue(encoder.encode(syntheticFinishEvent(hasToolCalls ? "tool_calls" : "stop")));
          }
          controller.enqueue(encoder.encode(buffer));
          buffer = "";
        }
        controller.close();
        return;
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}, { preconnect: fetchImpl.preconnect });
