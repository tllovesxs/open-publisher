import type { MediaAsset } from "../types";

const ASSET_REFERENCE_PATTERN = /^asset:\/\/([a-z0-9_-]{1,256})$/i;
const DATA_IMAGE_PATTERN =
  /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i;

type MediaSource = Pick<MediaAsset, "id" | "src">;

export function mediaMarkdownReference(asset: Pick<MediaAsset, "id">) {
  return `asset://${asset.id}`;
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
