import bundledDocument from "./product-promotion.v1.json";
import type { MarkdownTemplate } from "../types";

export const PRODUCT_PROMOTION_TEMPLATE_ID = "product-promotion";
export const PRODUCT_PROMOTION_TEMPLATE_URL =
  "https://raw.githubusercontent.com/tllovesxs/open-publisher/main/apps/desktop/src/data/product-promotion.v1.json";

const CACHE_KEY = "open-publisher-product-promotion-template:v1";

export type ProductPromotionTemplateSource = "loading" | "remote" | "cached" | "bundled";

export interface ProductPromotionTemplateDocument {
  schemaVersion: 1;
  version: string;
  updatedAt: string;
  template: MarkdownTemplate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isStringRecord(value: unknown, keys: readonly string[]) {
  return isRecord(value) && keys.every((key) => typeof value[key] === "string");
}

export function normalizeProductPromotionDocument(
  value: unknown,
): ProductPromotionTemplateDocument | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.version !== "string"
    || typeof value.updatedAt !== "string" || !isRecord(value.template)) return null;
  const template = value.template;
  if (
    template.id !== PRODUCT_PROMOTION_TEMPLATE_ID
    || typeof template.name !== "string"
    || typeof template.description !== "string"
    || typeof template.category !== "string"
    || typeof template.markdown !== "string"
    || typeof template.usageInstructions !== "string"
    || !isStringRecord(template.styleProfile, ["tone", "audience", "perspective", "sentenceStyle", "pacing", "density"])
    || !isStringRecord(template.structureProfile, ["openingPattern", "sectionPattern", "conclusionPattern", "headingDepth", "paragraphPattern"])
    || !isRecord(template.layoutProfile)
    || !Array.isArray(template.fixedBlocks)
    || !Array.isArray(template.variables)
    || !template.variables.every((variable) => typeof variable === "string")
  ) return null;
  const layout = template.layoutProfile;
  if (
    typeof layout.useLists !== "boolean"
    || typeof layout.useTables !== "boolean"
    || typeof layout.useBlockquotes !== "boolean"
    || typeof layout.useCodeBlocks !== "boolean"
    || typeof layout.imagePlacement !== "string"
    || typeof layout.emphasisRules !== "string"
  ) return null;
  return {
    schemaVersion: 1,
    version: value.version.slice(0, 80),
    updatedAt: value.updatedAt.slice(0, 40),
    template: {
      ...(template as unknown as MarkdownTemplate),
      id: PRODUCT_PROMOTION_TEMPLATE_ID,
      name: "产品推广",
      category: "产品推广",
      isBuiltIn: true,
      mode: "scaffold",
      referenceMarkdown: undefined,
      rightsConfirmed: undefined,
    },
  };
}

const normalizedBundled = normalizeProductPromotionDocument(bundledDocument);
if (!normalizedBundled) throw new Error("Bundled product-promotion template is invalid");

export const bundledProductPromotionDocument = normalizedBundled;
export const bundledProductPromotionTemplate = normalizedBundled.template;

export function readCachedProductPromotionDocument(): ProductPromotionTemplateDocument | null {
  try {
    const stored = window.localStorage.getItem(CACHE_KEY);
    return stored ? normalizeProductPromotionDocument(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
}

export function cacheProductPromotionDocument(document: ProductPromotionTemplateDocument): void {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(document));
  } catch {
    // The in-memory template remains usable when browser storage is unavailable.
  }
}

export async function fetchProductPromotionDocument(
  signal?: AbortSignal,
): Promise<ProductPromotionTemplateDocument> {
  const response = await fetch(PRODUCT_PROMOTION_TEMPLATE_URL, {
    headers: { Accept: "application/json" },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`GitHub 返回 HTTP ${response.status}`);
  const document = normalizeProductPromotionDocument(await response.json());
  if (!document) throw new Error("GitHub 模板格式无效");
  cacheProductPromotionDocument(document);
  return document;
}
