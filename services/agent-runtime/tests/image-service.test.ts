import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ImageService } from "../src/services/image-service.js";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlN7WQAAAAASUVORK5CYII=";

const profile = {
  providerId: "image-provider",
  displayName: "Image provider",
  baseUrl: "https://images.example.test/v1",
  modelId: "image-model",
  secretRef: "lease://image-key",
} as const;

describe("ImageService", () => {
  it("stores trusted Base64 image output and never exposes the provider key in its return value", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-image-service-"));
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: PNG }] }), { status: 200 }),
    );
    const service = new ImageService(root, { resolve: async () => "test-secret" }, fetchImplementation);

    const result = await service.generate({
      prompt: "a precise product diagram",
      size: "1024x1024",
      modelProfile: profile,
    });

    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://images.example.test/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-secret" }),
      }),
    );
    expect(result).toMatchObject({
      artifactCount: 1,
      provider: "image-provider",
      model: "image-model",
      remoteUrlsIgnored: 0,
      images: [{ mediaType: "image/png" }],
    });
    expect(result.images[0]?.dataUrl).toMatch(/^data:image\/png;base64,/);
    await expect(readFile(join(root, result.images[0]!.relativePath))).resolves.toBeInstanceOf(Buffer);
  });

  it("rejects provider URLs unless the exact HTTPS host is configured", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-image-service-"));
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ url: "https://cdn.example.test/image.png" }] }), { status: 200 }),
    );
    const service = new ImageService(root, { resolve: async () => "test-secret" }, fetchImplementation);

    await expect(service.generate({
      prompt: "a precise product diagram",
      size: "1024x1024",
      modelProfile: profile,
    })).rejects.toThrow("no trusted image output");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
});
