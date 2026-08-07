import type { MediaAsset } from "../types";

// Older generated assets used an `asset:<uuid>` runtime ID. Keep accepting
// those persisted references while all new generated IDs use the safer form
// created by generatedMediaAssetId().
const ASSET_REFERENCE_PATTERN = /^asset:\/\/([a-z0-9:_-]{1,256})$/i;
const DATA_IMAGE_PATTERN =
  /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;

type MediaSource = Pick<MediaAsset, "id" | "src">;

export interface PublishMediaSource {
  assetId: string;
  source: string;
}

export interface PublishMediaResolution {
  sources: PublishMediaSource[];
  missingAssetIds: string[];
}

export function mediaMarkdownReference(asset: Pick<MediaAsset, "id">) {
  return `asset://${asset.id}`;
}

/** Converts an image-runtime identifier into a compact Markdown-safe asset ID. */
export function generatedMediaAssetId(imageId: string): string {
  const safeImageId = imageId
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 246);
  return `generated-${safeImageId || "image"}`;
}

export function mediaAssetIdFromReference(value: string): string | null {
  return value.match(ASSET_REFERENCE_PATTERN)?.[1] ?? null;
}

function directImageSource(value: string): string | null {
  if (DATA_IMAGE_PATTERN.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Resolves an article's compact local media URL without allowing arbitrary schemes. */
export function resolveMarkdownImageSource(
  reference: string,
  assets: readonly MediaSource[],
): string | null {
  const assetId = mediaAssetIdFromReference(reference);
  if (assetId) {
    const source = assets.find((asset) => asset.id === assetId)?.src;
    return source ? directImageSource(source) : null;
  }
  return directImageSource(reference);
}

/**
 * Projects only the local assets referenced by the current article into the
 * publish request. Canonical Markdown keeps compact asset:// URLs; the runtime
 * resolves them only in its immutable platform variants.
 */
export function publishMediaSourcesForMarkdown(
  markdown: string,
  assets: readonly MediaSource[],
): PublishMediaResolution {
  const assetIds = [...new Set(
    Array.from(markdown.matchAll(/asset:\/\/([a-z0-9:_-]{1,256})/gi), (match) => match[1]!),
  )];
  const sources: PublishMediaSource[] = [];
  const missingAssetIds: string[] = [];
  for (const assetId of assetIds) {
    const asset = assets.find((candidate) => candidate.id === assetId);
    const source = asset ? directImageSource(asset.src) : null;
    if (!source) {
      missingAssetIds.push(assetId);
      continue;
    }
    sources.push({ assetId, source });
  }
  return { sources, missingAssetIds };
}
