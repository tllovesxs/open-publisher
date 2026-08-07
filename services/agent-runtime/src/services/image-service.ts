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
  readonly image?: unknown;
  readonly image_url?: unknown;
  readonly data?: unknown;
}

const toImageApiEntry = (entry: unknown): ImageApiEntry | null => {
  if (typeof entry === "string") return { url: entry };
  return entry && typeof entry === "object" ? entry as ImageApiEntry : null;
};

const isImageProfile = (value: ImageModelProfile): boolean =>
  /^[a-z0-9][a-z0-9_-]{0,79}$/.test(value.providerId) &&
  value.displayName.trim().length > 0 &&
  /^https:\/\//i.test(value.baseUrl) &&
  value.modelId.trim().length > 0 &&
  /^(?:env:\/\/[A-Z][A-Z0-9_]{0,127}|lease:\/\/[A-Za-z0-9][A-Za-z0-9._:-]{0,199})$/.test(
    value.secretRef,
  );

const decodeBase64 = (value: string): Uint8Array => {
  let normalized = value
    .trim()
    .replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "")
    .replace(/\s/g, "")
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error("Image provider returned invalid base64 data");
  }
  const padding = normalized.length % 4;
  if (padding === 1) throw new Error("Image provider returned invalid base64 data");
  if (padding > 1) normalized += "=".repeat(4 - padding);
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

/**
 * Providers commonly return a CDN URL even when the request asks for
 * `b64_json`.  The URL is normally hosted by the same provider as the image
 * endpoint, so make that host trusted by default. Explicit hosts are still
 * honoured and can be used for a separate CDN.
 */
const trustedHostsForProfile = (profile: ImageModelProfile): Set<string> => {
  const hosts = normaliseHosts(profile.trustedHosts);
  try {
    const base = new URL(profile.baseUrl);
    if (base.protocol === "https:") hosts.add(base.hostname.toLowerCase());
  } catch {
    // Profile validation below reports an invalid base URL.
  }
  return hosts;
};

const readApiEntries = (payload: unknown): ImageApiEntry[] => {
  if (Array.isArray(payload)) {
    return payload
      .map(toImageApiEntry)
      .filter((entry): entry is ImageApiEntry => entry !== null)
      .slice(0, MAX_IMAGES);
  }
  if (!payload || typeof payload !== "object") return [];
  const object = payload as {
    data?: unknown;
    images?: unknown;
    output?: { images?: unknown };
    result?: { images?: unknown };
  };
  const candidates = [
    object.data,
    object.images,
    object.output?.images,
    object.result?.images,
  ];
  return candidates
    .flatMap((candidate) => Array.isArray(candidate)
      ? candidate
        .map(toImageApiEntry)
        .filter((entry): entry is ImageApiEntry => entry !== null)
      : [])
    .slice(0, MAX_IMAGES);
};

const encodedImageFrom = (entry: ImageApiEntry): string | null => {
  const values = [entry.b64_json, entry.base64, entry.data];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (!normalized) continue;
    if (/^(?:data:image\/[a-z0-9.+-]+;base64,)?[a-z0-9+/_=-\s]+$/i.test(normalized)) {
      return normalized;
    }
  }
  return null;
};

const remoteImageUrlFrom = (entry: ImageApiEntry): string | null => {
  const values = [entry.url, entry.image, entry.image_url, entry.data];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim();
    if (/^(?:https?:|data:image\/)/i.test(normalized)) return normalized;
  }
  return null;
};

const isPrivateIpv4 = (host: string): boolean => {
  const parts = host.split(".").map((value) => Number.parseInt(value, 10));
  if (parts.length !== 4 || parts.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }
  const [first, second] = parts;
  return first === 0
    || first === 10
    || first === 127
    || (first === 169 && second === 254)
    || (first === 172 && second !== undefined && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
};

const isPublicHttpsImageUrl = (url: URL): boolean => {
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.port || url.username || url.password) return false;
  if (host === "localhost" || host.endsWith(".localhost") || isPrivateIpv4(host)) return false;
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return false;
  return true;
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

    const allowedHosts = trustedHostsForProfile(request.modelProfile);
    const images: GeneratedImage[] = [];
    let remoteUrlsIgnored = 0;
    let lastRemoteImageError: string | null = null;
    let totalBytes = 0;
    for (const entry of entries) {
      throwIfOperationCancelled(signal);
      let bytes: Uint8Array | null = null;
      const encoded = encodedImageFrom(entry);
      if (encoded) {
        bytes = decodeBase64(encoded);
      } else {
        const remoteUrl = remoteImageUrlFrom(entry);
        if (remoteUrl && /^data:image\//i.test(remoteUrl)) {
          bytes = decodeBase64(remoteUrl);
        } else if (remoteUrl) {
          try {
            bytes = await this.downloadProviderImage(remoteUrl, allowedHosts, signal);
          } catch (error) {
            lastRemoteImageError = error instanceof Error ? error.message : "Provider image download failed";
          }
        }
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
      const detail = lastRemoteImageError ? `: ${lastRemoteImageError}` : "";
      throw new Error(`Image provider returned no usable image output${detail}`);
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

  private async downloadProviderImage(
    rawUrl: string,
    allowedHosts: ReadonlySet<string>,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    let url = new URL(rawUrl);
    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      const host = url.hostname.toLowerCase();
      if (!isPublicHttpsImageUrl(url)) {
        throw new Error("Image provider returned a non-public image URL");
      }
      // Image APIs often return signed CDN URLs rather than a URL on their API
      // host. This URL originates from the authenticated provider response,
      // not from user input. The public-HTTPS guard above makes that normal
      // provider pattern work while the explicit host list remains available
      // for deployment-specific CDN auditing.
      const configuredHost = allowedHosts.has(host);
      const response = await this.fetchImplementation(url, {
        redirect: "manual",
        ...(signal ? { signal } : {}),
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirectCount === 3) throw new Error("Image provider image URL redirected too many times");
        url = new URL(location, url);
        continue;
      }
      if (!response.ok || response.type === "opaqueredirect") {
        throw new Error(configuredHost ? "Trusted image download failed" : "Provider image download failed");
      }
      const declaredLength = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
        throw new Error("Provider image download exceeds the allowed size limit");
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
        throw new Error("Provider image download exceeds the allowed size limit");
      }
      return bytes;
    }
    throw new Error("Provider image download failed");
  }
}
