import { invoke } from "@tauri-apps/api/core";

export type RuntimeState = "standby" | "starting" | "ready" | "stopped" | "faulted";

export interface RuntimeSnapshot {
  state: RuntimeState;
  bridgeMode: "interface_only" | "python_sidecar";
  generation: number;
  detail: string;
}

export interface SaveDraftRequest {
  articleId: string;
  baseRevision: string | null;
  markdown: string;
}

export interface SaveDraftReceipt {
  revisionId: string;
  savedAtEpochMs: number;
  persistence: "memory" | "local_database";
}

export interface RunDemoRequest {
  title: string;
  topic: string;
  sourceMarkdown: string;
  platforms: Array<"wechat" | "csdn" | "toutiao">;
}

export interface DemoReceiptSummary {
  status: string;
  remoteId: string;
}

export interface RunDemoSummary {
  artifactCount: number;
  runStatus: string;
  planStatus: string;
  receipts: DemoReceiptSummary[];
}

export interface DesktopBridge {
  runtimeSnapshot(): Promise<RuntimeSnapshot>;
  ensureAgentRuntime(): Promise<RuntimeSnapshot>;
  stopAgentRuntime(): Promise<RuntimeSnapshot>;
  saveDraft(request: SaveDraftRequest): Promise<SaveDraftReceipt>;
  runDemo(request: RunDemoRequest): Promise<RunDemoSummary>;
}

const isTauriHost = () => typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

let mockGeneration = 0;
let mockRuntimeState: RuntimeState = "standby";

const mockBridge: DesktopBridge = {
  async runtimeSnapshot() {
    return {
      state: mockRuntimeState,
      bridgeMode: "interface_only",
      generation: mockGeneration,
      detail: "浏览器预览使用内存桥接，不会访问模型或发布平台。",
    };
  },
  async ensureAgentRuntime() {
    mockRuntimeState = "starting";
    await pause(120);
    mockRuntimeState = "ready";
    mockGeneration += 1;
    return {
      state: mockRuntimeState,
      bridgeMode: "interface_only",
      generation: mockGeneration,
      detail: "本地接口已就绪；当前为演示运行时。",
    };
  },
  async stopAgentRuntime() {
    mockRuntimeState = "stopped";
    return {
      state: mockRuntimeState,
      bridgeMode: "interface_only",
      generation: mockGeneration,
      detail: "演示运行时已停止。",
    };
  },
  async saveDraft(request) {
    await pause(80);
    return {
      revisionId: `${request.articleId}-local-${Date.now()}`,
      savedAtEpochMs: Date.now(),
      persistence: "memory",
    };
  },
  async runDemo(request) {
    mockRuntimeState = "ready";
    mockGeneration += 1;
    await pause(180);
    return {
      artifactCount: 3,
      runStatus: "completed",
      planStatus: "completed",
      receipts: request.platforms.map((platform) => ({
        status: "published",
        remoteId: `dry-run-${platform}`,
      })),
    };
  },
};

const tauriBridge: DesktopBridge = {
  runtimeSnapshot: () => invoke<RuntimeSnapshot>("runtime_snapshot"),
  ensureAgentRuntime: () => invoke<RuntimeSnapshot>("ensure_agent_runtime"),
  stopAgentRuntime: () => invoke<RuntimeSnapshot>("stop_agent_runtime"),
  saveDraft: (request) => invoke<SaveDraftReceipt>("save_draft", { request }),
  runDemo: (request) => invoke<RunDemoSummary>("run_demo_workflow", { request }),
};

/**
 * React only sees this narrow Rust command surface. It receives neither a Python
 * endpoint nor plaintext provider/platform credentials.
 */
export const desktopBridge: DesktopBridge = {
  runtimeSnapshot: () =>
    isTauriHost() ? tauriBridge.runtimeSnapshot() : mockBridge.runtimeSnapshot(),
  ensureAgentRuntime: () =>
    isTauriHost() ? tauriBridge.ensureAgentRuntime() : mockBridge.ensureAgentRuntime(),
  stopAgentRuntime: () =>
    isTauriHost() ? tauriBridge.stopAgentRuntime() : mockBridge.stopAgentRuntime(),
  saveDraft: (request) =>
    isTauriHost() ? tauriBridge.saveDraft(request) : mockBridge.saveDraft(request),
  runDemo: (request) =>
    isTauriHost() ? tauriBridge.runDemo(request) : mockBridge.runDemo(request),
};
