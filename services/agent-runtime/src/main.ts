import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { WriterService } from "./agent/writer-service.js";
import { RewriteService } from "./agent/rewrite-service.js";
import { ModelTestService } from "./agent/model-test-service.js";
import { PiTemplateExtractionService } from "./agent/pi-template-extraction-service.js";
import { VisualPlanningService } from "./agent/visual-planning-service.js";
import { createRuntimeApp, type RuntimeReadiness } from "./api/app.js";
import { loadRuntimeConfig } from "./config.js";
import { RunJournal } from "./runs/run-journal.js";
import {
  EnvironmentSecretProvider,
  SecretLeaseStore,
} from "./security/secret-provider.js";
import { ArticleStore } from "./storage/article-store.js";
import { openRuntimeDatabase, type RuntimeDatabase } from "./storage/database.js";
import { importLegacyPythonArticlesOnce } from "./storage/legacy-python-import.js";
import {
  DryRunDelivery,
  PublishDeliveryRouter,
  PublishOutboxService,
  WechatSyncDraftDelivery,
} from "./publishing/publish-outbox-service.js";
import { WechatSyncLocalBridge } from "./publishing/wechat-sync-local-bridge.js";
import { ImageService } from "./services/image-service.js";

const config = loadRuntimeConfig(process.env);
const wechatSyncBridge = new WechatSyncLocalBridge({
  token: config.wechatSyncToken,
  websocketPort: config.wechatSyncWebsocketPort,
  httpPort: config.wechatSyncHttpPort,
});
let wechatSyncBridgeRetryTimer: ReturnType<typeof setTimeout> | null = null;
let wechatSyncBridgeStartAttempts = 0;
let stopping = false;

const startWechatSyncBridge = (): void => {
  try {
    wechatSyncBridge.start();
    wechatSyncBridgeStartAttempts = 0;
    console.log(JSON.stringify({
      level: "info",
      event: "wechat_sync_bridge.listening",
      websocketPort: config.wechatSyncWebsocketPort,
      httpPort: config.wechatSyncHttpPort,
      tokenConfigured: config.wechatSyncToken.length > 0,
    }));
  } catch (error: unknown) {
    wechatSyncBridgeStartAttempts += 1;
    const retryInMs = Math.min(2_000 * (2 ** (wechatSyncBridgeStartAttempts - 1)), 10_000);
    console.error(JSON.stringify({
      level: "error",
      event: "wechat_sync_bridge.start_failed",
      message: error instanceof Error ? error.message : String(error),
      retryInMs,
    }));
    if (!stopping) {
      wechatSyncBridgeRetryTimer = setTimeout(() => {
        wechatSyncBridgeRetryTimer = null;
        startWechatSyncBridge();
      }, retryInMs);
    }
  }
};

const stopWechatSyncBridge = (): void => {
  stopping = true;
  if (wechatSyncBridgeRetryTimer) {
    clearTimeout(wechatSyncBridgeRetryTimer);
    wechatSyncBridgeRetryTimer = null;
  }
  wechatSyncBridge.stop();
};

startWechatSyncBridge();
const state: RuntimeReadiness = {
  ready: false,
  checks: {
    dataDirectory: "pending",
    articleDirectory: "pending",
    storage: "pending",
  },
};
const articleStore = new ArticleStore(config.articleDir);
let database: RuntimeDatabase;

const initialize = async (): Promise<RuntimeDatabase> => {
  await mkdir(config.dataDir, { recursive: true });
  state.checks = { ...state.checks, dataDirectory: "ready" };
  await mkdir(config.articleDir, { recursive: true });
  await articleStore.initialize();
  state.checks = { ...state.checks, articleDirectory: "ready" };
  const legacyImport = await importLegacyPythonArticlesOnce({
    // The desktop keeps the retired Python runtime alongside pi-runtime.
    legacyDatabasePath: join(dirname(config.dataDir), "agent-runtime", "open-publisher.db"),
    articleStore,
    markerPath: join(config.dataDir, "legacy-python-article-import.json"),
    retry: process.env.OPEN_PUBLISHER_RETRY_LEGACY_IMPORT === "1",
  });
  if (legacyImport.outcome === "already-checked") {
    console.log(JSON.stringify({
      level: "info",
      event: "runtime.legacy_python_articles_import_skipped",
      priorOutcome: legacyImport.marker.outcome,
      checkedAt: legacyImport.marker.checkedAt,
    }));
  } else {
    console.log(JSON.stringify({
      level: "info",
      event: "runtime.legacy_python_articles_import_checked",
      outcome: legacyImport.outcome,
      importedArticleCount: legacyImport.result.importedArticleIds.length,
      skippedArticleCount: legacyImport.result.skippedArticleIds.length,
    }));
  }
  const openedDatabase = openRuntimeDatabase(config.dataDir);
  state.checks = { ...state.checks, storage: "ready" };
  state.ready = true;
  return openedDatabase;
};

const shutdown = (): void => {
  stopWechatSyncBridge();
  database.close();
  server.stop(true);
  process.exit(0);
};

try {
  database = await initialize();
} catch (error: unknown) {
  stopWechatSyncBridge();
  state.checks = { ...state.checks, storage: "failed" };
  console.error(
    JSON.stringify({
      level: "error",
      event: "runtime.initialization_failed",
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  throw error;
}

const journal = new RunJournal(database.sqlite);
const secretLeaseStore = new SecretLeaseStore(new EnvironmentSecretProvider());
const writerService = new WriterService(
  journal,
  articleStore,
  secretLeaseStore,
);
const rewriteService = new RewriteService(journal, secretLeaseStore);
const modelTestService = new ModelTestService();
const templateExtractor = new PiTemplateExtractionService(secretLeaseStore);
const visualPlanningService = new VisualPlanningService(secretLeaseStore);
const imageService = new ImageService(
  join(config.dataDir, "assets"),
  secretLeaseStore,
);
const publishOutboxService = new PublishOutboxService(
  database.sqlite,
  new PublishDeliveryRouter(
    new DryRunDelivery(),
    new WechatSyncDraftDelivery(
      fetch,
      `http://127.0.0.1:${config.wechatSyncHttpPort}/request`,
    ),
  ),
);
const app = createRuntimeApp({
  config,
  readiness: () => state,
  articleStore,
  writerService,
  rewriteService,
  modelTestService,
  templateExtractor,
  secretLeaseStore,
  imageService,
  publishOutboxService,
  visualPlanningService,
});
const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  fetch: app.fetch,
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(
  JSON.stringify({
    level: "info",
    event: "runtime.listening",
    host: config.host,
    port: server.port,
  }),
);
