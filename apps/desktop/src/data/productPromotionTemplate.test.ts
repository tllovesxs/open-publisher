import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bundledProductPromotionDocument,
  fetchProductPromotionDocument,
  normalizeProductPromotionDocument,
  PRODUCT_PROMOTION_TEMPLATE_ID,
  readCachedProductPromotionDocument,
} from "./productPromotionTemplate";

describe("product-promotion template source", () => {
  beforeEach(() => window.localStorage.clear());

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("ships exactly one valid product-promotion blueprint", () => {
    expect(bundledProductPromotionDocument.template).toMatchObject({
      id: PRODUCT_PROMOTION_TEMPLATE_ID,
      name: "产品推广",
      category: "产品推广",
      isBuiltIn: true,
    });
    expect(bundledProductPromotionDocument.template.usageInstructions).toContain("产品事实表");
  });

  it("rejects a remote document that tries to replace another template id", () => {
    expect(normalizeProductPromotionDocument({
      ...bundledProductPromotionDocument,
      template: { ...bundledProductPromotionDocument.template, id: "tutorial" },
    })).toBeNull();
  });

  it("fetches, validates, and caches the GitHub document", async () => {
    const remote = {
      ...bundledProductPromotionDocument,
      version: "remote-test",
      template: {
        ...bundledProductPromotionDocument.template,
        description: "远端测试版本",
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(remote), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    const result = await fetchProductPromotionDocument();

    expect(result.version).toBe("remote-test");
    expect(result.template.description).toBe("远端测试版本");
    expect(readCachedProductPromotionDocument()?.version).toBe("remote-test");
  });
});
