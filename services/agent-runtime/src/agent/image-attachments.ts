import type { ImageContent } from "@earendil-works/pi-ai";

export type ImageAttachmentIntent = "auto" | "material" | "insert" | "analyze";

export interface PromptImageAttachment {
  readonly assetId: string;
  readonly name: string;
  readonly mimeType: string;
  /** Base64 data with no data URL prefix. */
  readonly data: string;
  readonly intent: ImageAttachmentIntent;
}

const IDENTIFIER = /^[a-z][a-z0-9_-]{0,99}$/;
const MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);
const BASE64 = /^[a-z0-9+/]+={0,2}$/i;
const MAX_IMAGE_ATTACHMENTS = 6;
const MAX_IMAGE_DATA_LENGTH = 20_000_000;
const MAX_TOTAL_IMAGE_DATA_LENGTH = 32_000_000;

export function isPromptImageAttachment(value: unknown): value is PromptImageAttachment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const image = value as Record<string, unknown>;
  return (
    typeof image.assetId === "string" && IDENTIFIER.test(image.assetId) &&
    typeof image.name === "string" && image.name.trim().length > 0 && image.name.length <= 2_000 &&
    typeof image.mimeType === "string" && MIME_TYPES.has(image.mimeType.toLowerCase()) &&
    typeof image.data === "string" && image.data.length > 0 && image.data.length <= MAX_IMAGE_DATA_LENGTH &&
    BASE64.test(image.data) && image.data.length % 4 === 0 &&
    (image.intent === "auto" || image.intent === "material" || image.intent === "insert" || image.intent === "analyze")
  );
}

export function arePromptImageAttachments(value: unknown): value is readonly PromptImageAttachment[] {
  return Array.isArray(value) &&
    value.length <= MAX_IMAGE_ATTACHMENTS &&
    value.every(isPromptImageAttachment) &&
    new Set(value.map((image) => image.assetId)).size === value.length &&
    value.reduce((total, image) => total + image.data.length, 0) <= MAX_TOTAL_IMAGE_DATA_LENGTH;
}

export function promptImageContents(
  images: readonly PromptImageAttachment[],
  supportsVision: boolean,
): ImageContent[] {
  if (!supportsVision) return [];
  return images.map((image) => ({
    type: "image",
    data: image.data,
    // API validation accepts MIME casing case-insensitively. Pi providers and
    // OpenAI-compatible endpoints are less consistent, so send the canonical
    // MIME spelling across the model boundary.
    mimeType: image.mimeType.toLowerCase(),
  }));
}

export function promptImageInstructions(
  images: readonly PromptImageAttachment[],
  options: { readonly exposeAssetIds?: boolean } = {},
): string {
  if (images.length === 0) return "";
  return [
    "## 用户附图（内部说明，不要原样输出）",
    "这些图片已加入本机素材库。若模型支持视觉输入，你可以直接查看图片；否则只能依据用户写明的用途，不能编造图片内容。",
    "不要在文章正文中输出附件文件名、素材 ID、存储路径、图片占位符、配图说明或本节处理过程。图片插入由后续视觉流程完成。",
    ...images.map((image, index) => {
      const purpose = image.intent === "insert"
        ? "用户明确希望把它插入文章；写作阶段只需组织适合插图的正文，后续视觉流程会负责实际插入。"
        : image.intent === "analyze"
          ? "用户希望你识别图片内容，并依据可见信息回答或修改文章；不能识别时应明确说明。"
          : image.intent === "material"
            ? "用户仅将它作为素材库图片，可在确实匹配正文时使用。"
            : "请以用户当前指令判断用途；它可能是待加工原文、参考素材或待插入图片，不得因为看见主题就扩写成另一篇文章。";
      const identity = options.exposeAssetIds
        ? `${image.name}（素材 ID：${image.assetId}）`
        : image.name;
      return `- 附图 ${index + 1}：${identity}。${purpose}`;
    }),
  ].join("\n");
}
