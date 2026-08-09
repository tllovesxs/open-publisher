import { afterEach, describe, expect, it } from "vitest";
import { WechatSyncLocalBridge } from "../src/publishing/wechat-sync-local-bridge.js";

const bridges: WechatSyncLocalBridge[] = [];
const sockets: WebSocket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const bridge of bridges.splice(0)) bridge.stop();
});

const connectExtension = async (
  bridge: WechatSyncLocalBridge,
  respond: (request: Record<string, unknown>) => Record<string, unknown>,
): Promise<WebSocket> => {
  const port = bridge.websocketPort;
  if (!port) throw new Error("bridge websocket did not start");
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.push(socket);
  socket.addEventListener("message", (event) => {
    const request = JSON.parse(String(event.data)) as Record<string, unknown>;
    socket.send(JSON.stringify(respond(request)));
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("extension websocket failed")), { once: true });
  });
  return socket;
};

describe("WechatSyncLocalBridge", () => {
  it("hosts the extension socket and places the configured token in every request", async () => {
    const bridge = new WechatSyncLocalBridge({
      token: "extension-token",
      websocketPort: 0,
      httpPort: 0,
      requestTimeoutMs: 2_000,
    });
    bridges.push(bridge);
    bridge.start();
    let receivedToken: unknown;
    await connectExtension(bridge, (request) => {
      receivedToken = request.token;
      return {
        id: request.id,
        result: [{ id: "zhihu", isAuthenticated: true, username: "writer" }],
      };
    });

    const port = bridge.httpPort;
    if (!port) throw new Error("bridge HTTP API did not start");
    const status = await fetch(`http://127.0.0.1:${port}/status`);
    await expect(status.json()).resolves.toMatchObject({ connected: true, tokenConfigured: true });

    const response = await fetch(`http://127.0.0.1:${port}/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "listPlatforms", params: { forceRefresh: true } }),
    });
    expect(response.status).toBe(200);
    expect(receivedToken).toBe("extension-token");
    await expect(response.json()).resolves.toEqual({
      result: [{ id: "zhihu", isAuthenticated: true, username: "writer" }],
    });
  });

  it("preserves the extension's token rejection as an actionable HTTP status", async () => {
    const bridge = new WechatSyncLocalBridge({
      token: "wrong-token",
      websocketPort: 0,
      httpPort: 0,
      requestTimeoutMs: 2_000,
    });
    bridges.push(bridge);
    bridge.start();
    await connectExtension(bridge, (request) => ({
      id: request.id,
      error: { code: 403, message: "Invalid or missing token" },
    }));

    const response = await fetch(`http://127.0.0.1:${bridge.httpPort}/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "listPlatforms", params: {} }),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Invalid or missing token" });
  });

  it("keeps an established extension session active with lightweight heartbeats", async () => {
    const bridge = new WechatSyncLocalBridge({
      token: "extension-token",
      websocketPort: 0,
      httpPort: 0,
      heartbeatIntervalMs: 10,
    });
    bridges.push(bridge);
    bridge.start();

    const requests: Record<string, unknown>[] = [];
    await connectExtension(bridge, (request) => {
      requests.push(request);
      return request.method === "openPublisherHeartbeat"
        ? { id: request.id, error: { code: -32601, message: "Unknown method" } }
        : { id: request.id, result: [{ id: "wechat", isAuthenticated: true }] };
    });

    await expect.poll(
      () => requests.some((request) => request.method === "openPublisherHeartbeat"),
    ).toBe(true);

    const response = await fetch(`http://127.0.0.1:${bridge.httpPort}/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "listPlatforms", params: {} }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      result: [{ id: "wechat", isAuthenticated: true }],
    });
  });

  it("stops heartbeats after the extension disconnects", async () => {
    const bridge = new WechatSyncLocalBridge({
      token: "extension-token",
      websocketPort: 0,
      httpPort: 0,
      heartbeatIntervalMs: 10,
    });
    bridges.push(bridge);
    bridge.start();

    let heartbeatCount = 0;
    const socket = await connectExtension(bridge, (request) => {
      if (request.method === "openPublisherHeartbeat") heartbeatCount += 1;
      return { id: request.id, error: { code: -32601, message: "Unknown method" } };
    });
    await expect.poll(() => heartbeatCount).toBeGreaterThan(0);
    socket.close();
    await expect.poll(async () => {
      const response = await fetch(`http://127.0.0.1:${bridge.httpPort}/status`);
      const status = await response.json() as { connected: boolean };
      return status.connected;
    }).toBe(false);

    const countAfterDisconnect = heartbeatCount;
    await new Promise((resolve) => setTimeout(resolve, 35));
    expect(heartbeatCount).toBe(countAfterDisconnect);
  });

  it("waits briefly for the extension's automatic reconnect before rejecting a request", async () => {
    const bridge = new WechatSyncLocalBridge({
      token: "extension-token",
      websocketPort: 0,
      httpPort: 0,
      reconnectGraceMs: 500,
    });
    bridges.push(bridge);
    bridge.start();

    const responsePromise = fetch(`http://127.0.0.1:${bridge.httpPort}/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "listPlatforms", params: {} }),
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    await connectExtension(bridge, (request) => ({
      id: request.id,
      result: [{ id: "csdn", isAuthenticated: true }],
    }));

    const response = await responsePromise;
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      result: [{ id: "csdn", isAuthenticated: true }],
    });
  });

  it("immediately marks an in-flight draft request uncertain when the socket is replaced", async () => {
    const bridge = new WechatSyncLocalBridge({
      token: "extension-token",
      websocketPort: 0,
      httpPort: 0,
      requestTimeoutMs: 2_000,
    });
    bridges.push(bridge);
    bridge.start();

    const first = new WebSocket(`ws://127.0.0.1:${bridge.websocketPort}`);
    sockets.push(first);
    let draftReceived = false;
    first.addEventListener("message", (event) => {
      const request = JSON.parse(String(event.data)) as { method?: unknown };
      if (request.method === "syncArticle") draftReceived = true;
    });
    await new Promise<void>((resolve, reject) => {
      first.addEventListener("open", () => resolve(), { once: true });
      first.addEventListener("error", () => reject(new Error("extension websocket failed")), { once: true });
    });

    const responsePromise = fetch(`http://127.0.0.1:${bridge.httpPort}/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "syncArticle",
        params: { platforms: ["csdn"], article: { title: "Draft", markdown: "# Draft" } },
      }),
    });
    await expect.poll(() => draftReceived).toBe(true);
    await connectExtension(bridge, (request) => ({ id: request.id, result: [] }));

    const response = await responsePromise;
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      outcomeUncertain: true,
    });
  });
});
