import { randomUUID } from "node:crypto";

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

interface ExtensionResponse {
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code?: unknown; readonly message?: unknown };
}

export interface WechatSyncLocalBridgeOptions {
  readonly token: string;
  readonly websocketPort: number;
  readonly httpPort: number;
  readonly requestTimeoutMs?: number;
}

export class WechatSyncBridgeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Local bridge compatible with WechatSync's CLI/MCP wire protocol.
 * The browser extension connects as a WebSocket client; trusted local
 * publishing code uses the loopback HTTP endpoint to dispatch requests.
 */
export class WechatSyncLocalBridge {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly requestTimeoutMs: number;
  private extension: Bun.ServerWebSocket<undefined> | null = null;
  private websocketServer: Bun.Server<undefined> | null = null;
  private httpServer: Bun.Server<undefined> | null = null;

  constructor(private readonly options: WechatSyncLocalBridgeOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 360_000;
  }

  get websocketPort(): number | null {
    return this.websocketServer?.port ?? null;
  }

  get httpPort(): number | null {
    return this.httpServer?.port ?? null;
  }

  start(): void {
    if (this.websocketServer || this.httpServer) return;
    try {
      this.websocketServer = Bun.serve<undefined>({
        hostname: "127.0.0.1",
        port: this.options.websocketPort,
        fetch: (request, server) => {
          if (server.upgrade(request)) return undefined;
          return new Response("WechatSync WebSocket bridge", { status: 426 });
        },
        websocket: {
          open: (socket) => {
            if (this.extension && this.extension !== socket) {
              this.extension.close(1012, "A newer extension connection replaced this one");
            }
            this.extension = socket;
          },
          message: (_socket, message) => this.handleExtensionMessage(message),
          close: (socket) => {
            if (this.extension === socket) this.extension = null;
            this.rejectPending("WechatSync 扩展已断开连接。", 503);
          },
        },
      });
      this.httpServer = Bun.serve({
        hostname: "127.0.0.1",
        port: this.options.httpPort,
        fetch: (request) => this.handleHttpRequest(request),
      });
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop(): void {
    this.rejectPending("WechatSync 本地桥已停止。", 503);
    this.extension?.close(1001, "Open Publisher is stopping");
    this.extension = null;
    this.httpServer?.stop(true);
    this.websocketServer?.stop(true);
    this.httpServer = null;
    this.websocketServer = null;
  }

  private async handleHttpRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/status") {
      return Response.json({
        connected: this.extension !== null,
        mode: "open-publisher",
        tokenConfigured: this.options.token.length > 0,
      });
    }
    if (request.method !== "POST" || url.pathname !== "/request") {
      return new Response("Not found", { status: 404 });
    }

    const body = await request.json().catch(() => null) as {
      method?: unknown;
      params?: unknown;
    } | null;
    if (
      typeof body?.method !== "string"
      || body.method.length === 0
      || body.method.length > 100
      || (body.params !== undefined && (typeof body.params !== "object" || body.params === null || Array.isArray(body.params)))
    ) {
      return Response.json({ error: "WechatSync 请求格式无效。" }, { status: 400 });
    }

    try {
      const result = await this.requestExtension(
        body.method,
        body.params as Record<string, unknown> | undefined,
      );
      return Response.json({ result });
    } catch (error: unknown) {
      const status = error instanceof WechatSyncBridgeError ? error.status : 502;
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status },
      );
    }
  }

  private requestExtension(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.options.token) {
      return Promise.reject(new WechatSyncBridgeError("请先在 Open Publisher 设置中填写 WechatSync Token。", 401));
    }
    if (!this.extension) {
      return Promise.reject(new WechatSyncBridgeError("本地桥已启动，但浏览器扩展尚未连接。", 503));
    }

    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new WechatSyncBridgeError(`WechatSync 请求超时：${method}`, 504));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      try {
        this.extension!.send(JSON.stringify({
          id,
          method,
          token: this.options.token,
          ...(params ? { params } : {}),
        }));
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(new WechatSyncBridgeError(
          error instanceof Error ? error.message : "WechatSync 请求发送失败。",
          503,
        ));
      }
    });
  }

  private handleExtensionMessage(message: string | Buffer): void {
    try {
      const response = JSON.parse(typeof message === "string" ? message : message.toString("utf8")) as ExtensionResponse;
      if (typeof response.id !== "string") return;
      const pending = this.pending.get(response.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(response.id);
      if (response.error) {
        const code = typeof response.error.code === "number" ? response.error.code : -1;
        const message = typeof response.error.message === "string"
          ? response.error.message
          : "WechatSync 扩展返回了未知错误。";
        const status = code === 401 ? 401 : code === 403 ? 403 : 502;
        pending.reject(new WechatSyncBridgeError(message, status));
        return;
      }
      pending.resolve(response.result);
    } catch {
      // Ignore unrelated or malformed extension messages. A matching request
      // remains pending until its bounded timeout instead of accepting data
      // that cannot be correlated safely.
    }
  }

  private rejectPending(message: string, status: number): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new WechatSyncBridgeError(message, status));
    }
    this.pending.clear();
  }
}
