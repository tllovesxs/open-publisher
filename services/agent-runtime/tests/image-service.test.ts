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
    const providerRequest = JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)) as {
      prompt: string;
      negative_prompt?: string;
    };
    expect(providerRequest.negative_prompt).toContain("prompt text");
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

  it("removes legacy prompt-document fields before calling the image provider", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-image-service-"));
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: PNG }] }), { status: 200 }),
    );
    const service = new ImageService(root, { resolve: async () => "test-secret" }, fetchImplementation);

    await service.generate({
      prompt: [
        "---",
        "illustration_id: illustration-1",
        "output_file: 01-infographic.png",
        "---",
        "# 简洁正文配图",
        "LAYOUT: Create one clear illustration with generous whitespace.",
        "ZONES: A document cloud and a local folder connected by an arrow.",
        "ANCHOR: This image supports a long paragraph copied from the article.",
        "TEXT: Render no readable text.",
        "STYLE: Calm hand-drawn editorial style.",
        "ASPECT: 3:2 landscape.",
      ].join("\n"),
      size: "1536x1024",
      modelProfile: profile,
    });

    const request = JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)) as { prompt: string };
    expect(request.prompt).toContain("A document cloud and a local folder connected by an arrow.");
    expect(request.prompt).toContain("private rendering instructions");
    expect(request.prompt).not.toMatch(/简洁正文配图|illustration_id|output_file|LAYOUT:|ZONES:|ANCHOR:|TEXT:|STYLE:|ASPECT:/);
    expect(request.prompt).not.toContain("long paragraph copied from the article");
  });

  it("migrates cached prompts that exposed aspect and style metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-image-service-"));
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: PNG }] }), { status: 200 }),
    );
    const service = new ImageService(root, { resolve: async () => "test-secret" }, fetchImplementation);

    await service.generate({
      prompt: [
        "Create a 3:2 landscape text-free process diagram made from simple icons and directional arrows that explains one idea visually: 草稿、审核、发布与回滚状态之间的流程。",
        "Use one focal subject, at most three visual elements, clear relationships, and generous negative space on a simple background.",
        "Use the macaron palette with a calm sketch-notes editorial rendering style. Style guidance controls only line work, texture, shapes, and color; it never authorizes lettering or annotations.",
        "Keep the result completely text-free.",
      ].join(" "),
      size: "1536x1024",
      modelProfile: profile,
    });

    const request = JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)) as { prompt: string };
    expect(request.prompt).toContain("草稿、审核、发布与回滚状态之间的流程");
    expect(request.prompt).not.toContain("3:2 landscape");
    expect(request.prompt).not.toContain("macaron palette");
    expect(request.prompt).not.toContain("sketch-notes");
  });

  it("strips the visible-text control marker and permits only its exact article wording", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-image-service-"));
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: PNG }] }), { status: 200 }),
    );
    const service = new ImageService(root, { resolve: async () => "test-secret" }, fetchImplementation);

    await service.generate({
      prompt: [
        'OPEN_PUBLISHER_VISIBLE_TEXT_JSON:["审核"]',
        "A sequence of symbolic objects connected by arrows.",
      ].join("\n"),
      size: "1536x1024",
      modelProfile: profile,
    });

    const request = JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)) as {
      prompt: string;
      negative_prompt?: string;
    };
    expect(request.prompt).toContain('exactly ["审核"]');
    expect(request.prompt).not.toContain("OPEN_PUBLISHER_VISIBLE_TEXT_JSON");
    expect(request.negative_prompt).toBeUndefined();
  });

  it("retries without negative_prompt when an OpenAI-compatible relay rejects it", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-image-service-"));
    const fetchImplementation = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "unknown negative_prompt" }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: PNG }] }), { status: 200 }));
    const service = new ImageService(root, { resolve: async () => "test-secret" }, fetchImplementation);

    await service.generate({
      prompt: "A precise product diagram",
      size: "1024x1024",
      modelProfile: profile,
    });

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String(fetchImplementation.mock.calls[0]?.[1]?.body)) as { negative_prompt?: string };
    const second = JSON.parse(String(fetchImplementation.mock.calls[1]?.[1]?.body)) as { negative_prompt?: string };
    expect(first.negative_prompt).toBeTruthy();
    expect(second.negative_prompt).toBeUndefined();
  });

  it("downloads a provider-issued HTTPS CDN URL and stores it as a local image", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-image-service-"));
    const fetchImplementation = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ images: [{ url: "https://cdn.example.test/image.png" }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(Buffer.from(PNG, "base64"), {
        status: 200,
        headers: { "content-type": "image/png" },
      }));
    const service = new ImageService(root, { resolve: async () => "test-secret" }, fetchImplementation);

    const result = await service.generate({
      prompt: "a precise product diagram",
      size: "1024x1024",
      modelProfile: profile,
    });

    expect(result).toMatchObject({
      artifactCount: 1,
      remoteUrlsIgnored: 0,
      images: [{ mediaType: "image/png" }],
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    await expect(readFile(join(root, result.images[0]!.relativePath))).resolves.toEqual(Buffer.from(PNG, "base64"));
  });

  it("accepts provider data URLs and normalizes them into an image artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-image-service-"));
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        data: [{ data: `data:image/png;base64,${PNG}` }],
      }), { status: 200 }),
    );
    const service = new ImageService(root, { resolve: async () => "test-secret" }, fetchImplementation);

    const result = await service.generate({
      prompt: "a precise product diagram",
      size: "1024x1024",
      modelProfile: profile,
    });

    expect(result.images[0]?.dataUrl).toBe(`data:image/png;base64,${PNG}`);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("accepts unpadded URL-safe base64 image output", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-image-service-"));
    const urlSafePng = PNG.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: urlSafePng }] }), { status: 200 }),
    );
    const service = new ImageService(root, { resolve: async () => "test-secret" }, fetchImplementation);

    const result = await service.generate({
      prompt: "a precise product diagram",
      size: "1024x1024",
      modelProfile: profile,
    });

    expect(result.images[0]?.mediaType).toBe("image/png");
  });

  it("rejects non-public remote image URLs instead of leaving a stuck operation", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-image-service-"));
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ url: "http://127.0.0.1/image.png" }] }), { status: 200 }),
    );
    const service = new ImageService(root, { resolve: async () => "test-secret" }, fetchImplementation);

    await expect(service.generate({
      prompt: "a precise product diagram",
      size: "1024x1024",
      modelProfile: profile,
    })).rejects.toThrow("no usable image output: Image provider returned a non-public image URL");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("preserves safe JSON details from image-provider HTTP errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-image-service-"));
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        code: 30014,
        message: "Token is invalid.",
        authorization: "Bearer provider-secret-that-must-not-leak",
      }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    const service = new ImageService(root, { resolve: async () => "test-secret" }, fetchImplementation);

    const generation = service.generate({
      prompt: "a precise product diagram",
      size: "1024x1024",
      modelProfile: profile,
    });

    await expect(generation).rejects.toThrow(
      "Image provider request failed with HTTP 401: 30014: Token is invalid.",
    );
    await expect(generation).rejects.not.toThrow("provider-secret-that-must-not-leak");
  });

  it("reads a nested provider error message without exposing sibling fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-image-service-"));
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        error: {
          message: "Image account is unauthorized.",
          api_key: "nested-secret-that-must-not-leak",
        },
      }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );
    const service = new ImageService(root, { resolve: async () => "test-secret" }, fetchImplementation);

    const generation = service.generate({
      prompt: "a precise product diagram",
      size: "1024x1024",
      modelProfile: profile,
    });

    await expect(generation).rejects.toThrow(
      "Image provider request failed with HTTP 403: Image account is unauthorized.",
    );
    await expect(generation).rejects.not.toThrow("nested-secret-that-must-not-leak");
  });

  it("does not expose non-JSON provider response bodies", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-image-service-"));
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("upstream proxy failure: private-provider-response", { status: 502 }),
    );
    const service = new ImageService(root, { resolve: async () => "test-secret" }, fetchImplementation);

    const generation = service.generate({
      prompt: "a precise product diagram",
      size: "1024x1024",
      modelProfile: profile,
    });

    await expect(generation).rejects.toThrow("Image provider request failed with HTTP 502");
    await expect(generation).rejects.not.toThrow("private-provider-response");
  });

  it("removes control characters and limits provider error detail length", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-image-service-"));
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: `Invalid\u0000\n${"x".repeat(2_000)}` }), {
        status: 429,
        headers: { "content-type": "application/json" },
      }),
    );
    const service = new ImageService(root, { resolve: async () => "test-secret" }, fetchImplementation);

    let failure: Error | null = null;
    try {
      await service.generate({
        prompt: "a precise product diagram",
        size: "1024x1024",
        modelProfile: profile,
      });
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    }

    expect(failure).not.toBeNull();
    expect(failure!.message).toContain("Image provider request failed with HTTP 429: Invalid");
    expect(failure!.message).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(failure!.message.length).toBeLessThanOrEqual(300);
  });

});
