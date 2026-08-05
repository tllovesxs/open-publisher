import { resolve } from "node:path";

export interface RuntimeConfig {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly token: string;
  readonly dataDir: string;
  readonly articleDir: string;
  readonly protocolVersion: "2";
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

  return {
    host: "127.0.0.1",
    port,
    token: requireValue(environment, "OPEN_PUBLISHER_RUNTIME_TOKEN"),
    dataDir: resolve(requireValue(environment, "OPEN_PUBLISHER_DATA_DIR")),
    articleDir: resolve(requireValue(environment, "OPEN_PUBLISHER_ARTICLE_DIR")),
    protocolVersion,
  };
};
