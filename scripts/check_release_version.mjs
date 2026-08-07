import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const rootPackage = readJson(join(repositoryRoot, "package.json"));
const desktopPackage = readJson(join(repositoryRoot, "apps", "desktop", "package.json"));
const tauriConfig = readJson(join(repositoryRoot, "apps", "desktop", "src-tauri", "tauri.conf.json"));
const cargoManifest = readFileSync(
  join(repositoryRoot, "apps", "desktop", "src-tauri", "Cargo.toml"),
  "utf8",
);
const cargoPackage = cargoManifest.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);

if (!cargoPackage) {
  throw new Error("Could not read the desktop package version from Cargo.toml.");
}

const versions = {
  root: rootPackage.version,
  desktop: desktopPackage.version,
  tauri: tauriConfig.version,
  cargo: cargoPackage[1],
};
const uniqueVersions = new Set(Object.values(versions));

if (uniqueVersions.size !== 1) {
  throw new Error(
    `Desktop release versions differ: ${Object.entries(versions)
      .map(([source, version]) => `${source}=${version}`)
      .join(", ")}`,
  );
}

const releaseVersion = versions.desktop;
const tag = process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined;

if (tag && tag !== `v${releaseVersion}`) {
  throw new Error(`Release tag ${tag} does not match desktop version v${releaseVersion}.`);
}

console.log(`Desktop release version contract passed: ${releaseVersion}.`);
