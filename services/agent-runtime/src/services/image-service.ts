import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { SecretProvider } from "../security/secret-provider.js";
import { throwIfOperationCancelled } from "../operations/operation-registry.js";

const MAX_PROMPT_LENGTH = 16_000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_IMAGES = 4;
const SUPPORTED_SIZES = new Set(["512x512", "768x768", "1024x1024", "1024x1536", "1536x1024"]);

export interface ImageModelProfile {
  readonly providerId: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly secretRef: string;
  readonly trustedHosts?: readonly string[];
}

export interface GenerateImageRequest {
  readonly prompt: string;
  readonly size: string;
  readonly modelProfile: ImageModelProfile;
}

export interface GeneratedImage {
  readonly id: string;
  readonly mediaType: string;
  readonly dataUrl: string;
  readonly relativePath: string;
}

export interface ImageGenerationResult {
  readonly artifactCount: number;
  readonly provider: string;
  readonly model: string;
  readonly mocked: false;
  readonly remoteUrlsIgnored: number;
  readonly mediaTypes: readonly string[];
  readonly images: readonly GeneratedImage[];
}

interface ImageApiEntry {
  readonly b64_json?: unknown;
  readonly base64?: unknown;
  readonly url?: unknown;
}

const isImageProfile = (value: ImageModelProfile): boolean =>
  /^[a-z0-9][a-z0-9_-]{0,79}$/.test(value.providerId) &&
  value.displayName.trim().length > 0 &&
  /^https:\/\//i.test(value.baseUrl) &&
  value.modelId.trim().length > 0 &&
  /^(?:env:\/\/[A-Z][A-Z0-9_]{0,127}|lease:\/\/[A-Za-z0-9][A-Za-z0-9._:-]{0,199})$/.test(
    value.secretRef,
  );

const decodeBase64 = (value: string): Uint8Array => {
  const normalized = value.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new Error("Image provider returned invalid base64 data");
  }
  const bytes = Uint8Array.from(Buffer.from(normalized, "base64"));
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error("Image provider returned an image outside the allowed size limit");
  }
  return bytes;
};

const mediaTypeFor = (bytes: Uint8Array): string => {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 6)) === "GIF87a") return "image/gif";
  if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 6)) === "GIF89a") return "image/gif";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === "ftyp") {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (["avif", "avis"].includes(brand)) return "image/avif";
  }
  throw new Error("Image provider returned an unsupported image format");
};

const extensionFor = (mediaType: string): string => ({
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
}[mediaType] ?? "bin");

const atomicWrite = async (path: string, data: Uint8Array): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  await writeFile(temporaryPath, data);
  await rename(temporaryPath, path);
};

const normaliseHosts = (hosts: readonly string[] | undefined): Set<string> =>
  new Set((hosts ?? []).map((host) => host.trim().toLowerCase()).filter(Boolean));

const readApiEntries = (payload: unknown): ImageApiEntry[] => {
  if (!payload || typeof payload !== "object") return [];
  const object = payload as { data?: unknown; images?: unknown };
  const candidates = Array.isArray(object.data) ? object.data : Array.isArray(object.images) ? object.images : [];
  return candidates.filter((entry): entry is ImageApiEntry => Boolean(entry) && typeof entry === "object").slice(0, MAX_IMAGES);
};

/**
 * Small OpenAI-compatible image client. It deliberately lives outside Pi: Pi
 * owns text/tool loops, while image rendering is a bounded, cancellable job.
 */
export class ImageService {
  constructor(
    private readonly assetDirectory: string,
    private readonly secrets: SecretProvider,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async generate(request: GenerateImageRequest, signal?: AbortSignal): Promise<ImageGenerationResult> {
    throwIfOperationCancelled(signal);
    const prompt = request.prompt.trim();
    if (!prompt || prompt.length > MAX_PROMPT_LENGTH) {
      throw new Error("Image prompt must contain 1 to 16000 characters");
    }
    if (!SUPPORTED_SIZES.has(request.size)) {
      throw new Error("Image size is not supported");
    }
    if (!isImageProfile(request.modelProfile)) {
      throw new Error("Image model profile is invalid");
    }
    const secret = await this.secrets.resolve(request.modelProfile.secretRef);
    if (!secret) throw new Error("Image model secret is unavailable");

    const response = await this.fetchImplementation(
      `${request.modelProfile.baseUrl.replace(/\/$/, "")}/images/generations`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          model: request.modelProfile.modelId,
          prompt,
          size: request.size,
          response_format: "b64_json",
        }),
        ...(signal ? { signal } : {}),
      },
    );
    throwIfOperationCancelled(signal);
    if (!response.ok) {
      throw new Error(`Image provider request failed with HTTP ${response.status}`);
    }
    const entries = readApiEntries(await response.json());
    if (entries.length === 0) throw new Error("Image provider returned no image output");

    const allowedHosts = normaliseHosts(request.modelProfile.trustedHosts);
    const images: GeneratedImage[] = [];
    let remoteUrlsIgnored = 0;
    let totalBytes = 0;
    for (const entry of entries) {
      throwIfOperationCancelled(signal);
      let bytes: Uint8Array | null = null;
      const encoded = typeof entry.b64_json === "string"
        ? entry.b64_json
        : typeof entry.base64 === "string"
          ? entry.base64
          : null;
      if (encoded) {
        bytes = decodeBase64(encoded);
      } else if (typeof entry.url === "string") {
        bytes = await this.downloadTrustedImage(entry.url, allowedHosts, signal).catch(() => null);
        if (!bytes) {
          remoteUrlsIgnored += 1;
          continue;
        }
      }
      if (!bytes) continue;
      totalBytes += bytes.length;
      if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
        throw new Error("Image provider returned too much image data");
      }
      const mediaType = mediaTypeFor(bytes);
      const id = `asset:${randomUUID()}`;
      const relativePath = join("generated", `${encodeURIComponent(id)}.${extensionFor(mediaType)}`).replaceAll("\\", "/");
      // Never return or expose a newly written asset after cancellation. A
      // concurrently interrupted atomic write may leave an unreferenced file,
      // but it is not surfaced to the renderer or media library.
      throwIfOperationCancelled(signal);
      await atomicWrite(join(this.assetDirectory, relativePath), bytes);
      throwIfOperationCancelled(signal);
      images.push({
        id,
        mediaType,
        dataUrl: `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`,
        relativePath,
      });
    }
    if (images.length === 0) {
      throw new Error("Image provider returned no trusted image output");
    }
    return {
      artifactCount: images.length,
      provider: request.modelProfile.providerId,
      model: request.modelProfile.modelId,
      mocked: false,
      remoteUrlsIgnored,
      mediaTypes: [...new Set(images.map((image) => image.mediaType))],
      images,
    };
  }

  private async downloadTrustedImage(
    rawUrl: string,
    allowedHosts: ReadonlySet<string>,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.port || !allowedHosts.has(url.hostname.toLowerCase())) {
      throw new Error("Image provider URL is not in the configured trusted-host allowlist");
    }
    const response = await this.fetchImplementation(url, {
      redirect: "manual",
      ...(signal ? { signal } : {}),
    });
    if (!response.ok || response.type === "opaqueredirect") {
      throw new Error("Trusted image download failed");
    }
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
      throw new Error("Trusted image download exceeds the allowed size limit");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
      throw new Error("Trusted image download exceeds the allowed size limit");
    }
    return bytes;
  }
}
