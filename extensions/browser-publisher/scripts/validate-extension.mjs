import { readFile, readdir } from "node:fs/promises";
import { extname } from "node:path";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const taskSchema = JSON.parse(
  await readFile(new URL("schemas/browser-draft-task.schema.json", root), "utf8"),
);

const expectedHosts = [
  "https://editor.csdn.net/*",
  "https://mp.weixin.qq.com/*",
  "https://zhuanlan.zhihu.com/*",
  "https://creator.xiaohongshu.com/*",
];
const expectedPermissions = ["activeTab", "storage"];
const forbiddenPermissions = new Set([
  "cookies",
  "declarativeNetRequest",
  "nativeMessaging",
  "scripting",
  "unlimitedStorage",
  "webRequest",
]);

if (manifest.manifest_version !== 3) throw new Error("Extension must use Manifest V3");
if (JSON.stringify(manifest.permissions) !== JSON.stringify(expectedPermissions)) {
  throw new Error("permissions must contain only activeTab and storage");
}
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(expectedHosts)) {
  throw new Error("host_permissions must contain only the four reviewed editor origins");
}
if ("externally_connectable" in manifest) {
  throw new Error("P0 must not expose an externally_connectable message endpoint");
}
for (const permission of manifest.permissions ?? []) {
  if (forbiddenPermissions.has(permission)) {
    throw new Error(`Forbidden extension permission: ${permission}`);
  }
}
for (const pattern of [
  ...(manifest.host_permissions ?? []),
  ...manifest.content_scripts.flatMap((script) => script.matches ?? []),
]) {
  if (pattern.includes("<all_urls>") || pattern.includes("*://") || pattern.includes("http://")) {
    throw new Error(`Broad or insecure host pattern: ${pattern}`);
  }
}
if (taskSchema.$schema !== "https://json-schema.org/draft/2020-12/schema") {
  throw new Error("Browser task must use JSON Schema draft 2020-12");
}
if (taskSchema.properties?.safety?.properties?.finalPublish?.const !== false) {
  throw new Error("Browser task schema must make final publication impossible");
}
if (taskSchema.properties?.safety?.properties?.requiresUserReview?.const !== true) {
  throw new Error("Browser task schema must require user review");
}
if (
  !taskSchema.required?.includes("expiresAt") ||
  taskSchema.properties?.expiresAt?.format !== "date-time"
) {
  throw new Error("Browser tasks must carry a required date-time expiry");
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
      if (entry.isDirectory()) return sourceFiles(url);
      return [url];
    }),
  );
  return nested.flat();
}

for (const file of await sourceFiles(new URL("src/", root))) {
  if (![".js", ".html"].includes(extname(file.pathname))) continue;
  const source = await readFile(file, "utf8");
  if (source.includes("chrome.cookies")) {
    throw new Error(`Cookie API usage is forbidden: ${file.pathname}`);
  }
  if (/querySelector\([^)]*(publish|发布)/i.test(source)) {
    throw new Error(`Final-publish control lookup is forbidden: ${file.pathname}`);
  }
}

console.log("Manifest V3 safety checks passed.");
