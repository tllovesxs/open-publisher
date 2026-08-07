import { resolve } from "node:path";

export interface RuntimeConfig {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly token: string;
  readonly dataDir: string;
  readonly articleDir: string;
  readonly protocolVersion: "2";
  readonly wechatSyncToken: string;
  readonly wechatSyncWebsocketPort: number;
  readonly wechatSyncHttpPort: number;
}

const requireValue = (environment: NodeJS.ProcessEnv, key: string): string => {
  const value = environment[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

export const loadRuntimeConfig = (environment: NodeJS.ProcessEnv): RuntimeConfig => {
  const rawPort = requireValue(environment, "OPEN_PUBLISHER_RUNTIME_PORT");
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("OPEN_PUBLISHER_RUNTIME_PORT must be an integer between 1 and 65535");
  }

  const protocolVersion = requireValue(environment, "OPEN_PUBLISHER_PROTOCOL_VERSION");
  if (protocolVersion !== "2") {
    throw new Error(`Unsupported protocol version: ${protocolVersion}`);
  }

  const wechatSyncWebsocketPort = Number.parseInt(
    environment.OPEN_PUBLISHER_WECHATSYNC_WS_PORT?.trim() || "9527",
    10,
  );
  const wechatSyncHttpPort = Number.parseInt(
    environment.OPEN_PUBLISHER_WECHATSYNC_HTTP_PORT?.trim() || "9528",
    10,
  );
  if (
    !Number.isInteger(wechatSyncWebsocketPort)
    || !Number.isInteger(wechatSyncHttpPort)
    || wechatSyncWebsocketPort < 1
    || wechatSyncHttpPort < 1
    || wechatSyncWebsocketPort > 65_535
    || wechatSyncHttpPort > 65_535
    || wechatSyncWebsocketPort === wechatSyncHttpPort
  ) {
    throw new Error("WechatSync bridge ports must be distinct integers between 1 and 65535");
  }

  return {
    host: "127.0.0.1",
    port,
    token: requireValue(environment, "OPEN_PUBLISHER_RUNTIME_TOKEN"),
    dataDir: resolve(requireValue(environment, "OPEN_PUBLISHER_DATA_DIR")),
    articleDir: resolve(requireValue(environment, "OPEN_PUBLISHER_ARTICLE_DIR")),
    protocolVersion,
    wechatSyncToken: environment.OPEN_PUBLISHER_WECHATSYNC_TOKEN?.trim() || "",
    wechatSyncWebsocketPort,
    wechatSyncHttpPort,
  };
};
