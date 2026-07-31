import type { MediaAsset } from "../types";

const DATABASE_NAME = "open-publisher-studio";
const DATABASE_VERSION = 1;
const STORE_NAME = "media-assets";

function databaseAvailable() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

function openDatabase(): Promise<IDBDatabase> {
  if (!databaseAvailable()) {
    return Promise.reject(new Error("当前运行环境不支持本地素材数据库。"));
  }
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error ?? new Error("无法打开本地素材数据库。"));
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

export async function loadMediaAssetsFromDatabase(): Promise<MediaAsset[]> {
  const database = await openDatabase();
  try {
    return await new Promise<MediaAsset[]>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).getAll();
      request.onerror = () => reject(request.error ?? new Error("无法读取本地素材。"));
      request.onsuccess = () => resolve(request.result as MediaAsset[]);
    });
  } finally {
    database.close();
  }
}

/**
 * IndexedDB stores the image payload outside Web Storage's small synchronous
 * quota. The existing compact asset:// Markdown references remain unchanged.
 */
export async function saveMediaAssetsToDatabase(assets: readonly MediaAsset[]) {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      for (const asset of assets) store.put(asset);
      transaction.onerror = () => reject(transaction.error ?? new Error("无法保存本地素材。"));
      transaction.onabort = () => reject(transaction.error ?? new Error("保存本地素材被中断。"));
      transaction.oncomplete = () => resolve();
    });
  } finally {
    database.close();
  }
}
