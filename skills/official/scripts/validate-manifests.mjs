import { readFile, readdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const expectedIds = new Set([
  "official.research",
  "official.writing",
  "official.natural-style",
  "official.sensitive-terms",
  "official.wechat",
  "official.csdn",
  "official.toutiao",
  "official.visual-planning",
]);
const forbiddenExecutableKeys = new Set(["command", "entrypoint", "executable", "script", "scripts"]);

function inspectForExecutableFields(value, path = "$") {
  if (value === null || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenExecutableKeys.has(key)) {
      throw new Error(`Executable field ${path}.${key} is forbidden in official declarative skills`);
    }
    inspectForExecutableFields(nested, `${path}.${key}`);
  }
}

const directories = (await readdir(root, { withFileTypes: true })).filter(
  (entry) => entry.isDirectory() && entry.name !== "scripts",
);
const seenIds = new Set();

for (const directory of directories) {
  const manifest = JSON.parse(
    await readFile(new URL(`${directory.name}/skill.json`, root), "utf8"),
  );
  inspectForExecutableFields(manifest);

  if (manifest.schemaVersion !== "1.0") throw new Error(`${directory.name}: invalid schemaVersion`);
  if (manifest.runtime?.kind !== "declarative") {
    throw new Error(`${directory.name}: official skills must be declarative`);
  }
  if (manifest.runtime?.apiVersion !== "1.0") {
    throw new Error(`${directory.name}: invalid runtime API version`);
  }
  if (manifest.permissions?.platformWrites !== false) {
    throw new Error(`${directory.name}: skills cannot perform platform writes`);
  }
  if (manifest.permissions?.browserRead !== false) {
    throw new Error(`${directory.name}: official skills cannot read browser sessions`);
  }
  if (manifest.source?.kind !== "first-party") {
    throw new Error(`${directory.name}: source must be first-party`);
  }
  if (!Array.isArray(manifest.outputArtifactTypes) || manifest.outputArtifactTypes.length === 0) {
    throw new Error(`${directory.name}: outputArtifactTypes is required`);
  }
  if (seenIds.has(manifest.id)) throw new Error(`Duplicate skill id: ${manifest.id}`);
  seenIds.add(manifest.id);
}

for (const expectedId of expectedIds) {
  if (!seenIds.has(expectedId)) throw new Error(`Missing official skill: ${expectedId}`);
}
if (seenIds.size !== expectedIds.size) {
  throw new Error(`Expected ${expectedIds.size} official skills, found ${seenIds.size}`);
}

console.log(`Validated ${seenIds.size} declarative official skill manifests.`);
