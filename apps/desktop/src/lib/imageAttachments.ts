import type { MediaAsset } from "../types";

export type PromptImageIntent = "auto" | "material" | "insert" | "analyze";

/** Must stay aligned with the native and runtime attachment request limits. */
export const MAX_PROMPT_IMAGE_ATTACHMENTS = 6;

export interface PromptImageAttachment {
  assetId: string;
  name: string;
  mimeType: string;
  /** Base64 payload without a data URL prefix. */
  data: string;
  intent: PromptImageIntent;
}

const LOCAL_IMAGE_DATA_URL = /^data:(image\/(?:png|jpe?g|gif|webp|avif));base64,([a-z0-9+/=\s]+)$/i;

/**
 * Only locally persisted image assets can be supplied to a multimodal model.
 * Remote URLs are deliberately not fetched by the renderer on the model's
 * behalf, which keeps a pasted attachment local and predictable.
 */
export function promptImageAttachmentFromAsset(
  asset: Pick<MediaAsset, "id" | "name" | "src">,
  intent: PromptImageIntent,
): PromptImageAttachment | null {
  const match = asset.src.match(LOCAL_IMAGE_DATA_URL);
  if (!match) return null;
  const data = match[2].replace(/\s/g, "");
  if (!data) return null;
  return {
    assetId: asset.id,
    name: asset.name.slice(0, 160),
    mimeType: match[1].toLowerCase(),
    data,
    intent,
  };
}
