import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { validateTextModelProfile } from "../agent/model-profile.js";
import { arePromptImageAttachments, type PromptImageAttachment } from "../agent/image-attachments.js";
import { discoverModels } from "../agent/model-discovery.js";
import type { ModelTestService } from "../agent/model-test-service.js";
import type { TemplateExtractor } from "../agent/pi-template-extraction-service.js";
import type { WriterService } from "../agent/writer-service.js";
import type { RewriteService } from "../agent/rewrite-service.js";
import type { TextModelProfile } from "../agent/model-profile.js";
import type {
  VisualCompositionRequest,
  VisualPlanningService,
} from "../agent/visual-planning-service.js";
import type { RuntimeConfig } from "../config.js";
import type { SecretLeaseStore } from "../security/secret-provider.js";
import type { ArticleStore } from "../storage/article-store.js";
import { ArticleConflictError } from "../storage/article-store.js";
import {
  isOperationCancelled,
  OperationRegistry,
} from "../operations/operation-registry.js";
import type { ImageModelProfile, ImageService } from "../services/image-service.js";
import type {
  PublishDeliveryMode,
  PublishOutboxService,
  PublishTargetInput,
  UnknownPublishResolution,
} from "../publishing/publish-outbox-service.js";
import type { PublishMediaSourceInput } from "../publishing/publish-media.js";
import type { ArticleWriteRequestV2 } from "@open-publisher/contracts";
import {
  PI_AGENT_VERSION,
  PROTOCOL_VERSION,
  RUNTIME_VERSION,
} from "../runtime-version.js";

export interface RuntimeReadiness {
  ready: boolean;
  checks: Readonly<Record<string, "ready" | "pending" | "failed">>;
}

export interface CreateRuntimeAppOptions {
  readonly config: RuntimeConfig;
  readonly readiness: () => RuntimeReadiness;
  readonly articleStore?: ArticleStore;
  readonly writerService?: WriterService;
  readonly rewriteService?: RewriteService;
  readonly modelTestService?: ModelTestService;
  readonly templateExtractor?: TemplateExtractor;
  readonly secretLeaseStore?: SecretLeaseStore;
  readonly imageService?: ImageService;
  readonly publishOutboxService?: PublishOutboxService;
  readonly visualPlanningService?: VisualPlanningService;
  /** Injectable only for focused runtime tests; production owns one registry per app. */
  readonly operationRegistry?: OperationRegistry;
}

const readBearerToken = (authorization: string | undefined): string | null => {
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }
  return authorization.slice("Bearer ".length);
};

const isTerminalRunStatus = (status: string): boolean =>
  ["completed", "failed", "stopped", "interrupted"].includes(status);

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/;
const MEDIA_ASSET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

const isArticleWriteRequest = (value: unknown): value is ArticleWriteRequestV2 => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return (
    body.schemaVersion === "2" &&
    typeof body.articleId === "string" &&
    IDENTIFIER_PATTERN.test(body.articleId) &&
    (body.baseRevisionId === null ||
      (typeof body.baseRevisionId === "string" && IDENTIFIER_PATTERN.test(body.baseRevisionId))) &&
    (body.baseContentHash === null ||
      (typeof body.baseContentHash === "string" && SHA256_PATTERN.test(body.baseContentHash))) &&
    typeof body.title === "string" &&
    body.title.length > 0 &&
    body.title.length <= 500 &&
    typeof body.markdown === "string" &&
    body.markdown.length > 0 &&
    body.markdown.length <= 2_000_000 &&
    typeof body.reason === "string" &&
    body.reason.length > 0 &&
    body.reason.length <= 1_000
  );
};

interface RewriteRequest {
  readonly articleId: string;
  readonly requestId: string;
  readonly markdown: string;
  readonly instruction: string;
  readonly selectedTexts: readonly string[];
  readonly conversation: readonly { readonly role: "user" | "assistant"; readonly text: string }[];
  readonly images?: readonly PromptImageAttachment[];
  readonly modelProfile: TextModelProfile;
}

interface ImageGenerationRequest {
  readonly operationId?: string;
  readonly prompt: string;
  readonly size: string;
  readonly modelProfile: ImageModelProfile;
}

const isImageGenerationRequest = (value: unknown): value is ImageGenerationRequest => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  const profile = body.modelProfile;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return false;
  const imageProfile = profile as Record<string, unknown>;
  return (
    (body.operationId === undefined || (typeof body.operationId === "string" && IDENTIFIER_PATTERN.test(body.operationId))) &&
    typeof body.prompt === "string" && body.prompt.trim().length > 0 && body.prompt.length <= 16_000 &&
    typeof body.size === "string" &&
    typeof imageProfile.providerId === "string" &&
    typeof imageProfile.displayName === "string" &&
    typeof imageProfile.baseUrl === "string" &&
    typeof imageProfile.modelId === "string" &&
    typeof imageProfile.secretRef === "string" &&
    (imageProfile.trustedHosts === undefined ||
      (Array.isArray(imageProfile.trustedHosts) && imageProfile.trustedHosts.every((host) => typeof host === "string")))
  );
};

interface PublishPlanRequest {
  readonly articleId: string;
  readonly revisionId: string;
  readonly targets: readonly PublishTargetInput[];
  readonly mediaSources?: readonly PublishMediaSourceInput[];
}

const isPublishDeliveryMode = (value: unknown): value is PublishDeliveryMode =>
  value === "dry_run" || value === "wechat_sync_draft";

const isUnknownPublishResolution = (value: unknown): value is UnknownPublishResolution =>
  value === "draft_exists" || value === "draft_missing";

const isPublishPlanRequest = (value: unknown): value is PublishPlanRequest => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.articleId === "string" && IDENTIFIER_PATTERN.test(body.articleId) &&
    typeof body.revisionId === "string" && IDENTIFIER_PATTERN.test(body.revisionId) &&
    (body.mediaSources === undefined || (
      Array.isArray(body.mediaSources) && body.mediaSources.length <= 200 &&
      body.mediaSources.every((media) => {
        if (!media || typeof media !== "object" || Array.isArray(media)) return false;
        const source = media as Record<string, unknown>;
        return typeof source.assetId === "string" && MEDIA_ASSET_ID_PATTERN.test(source.assetId) &&
          typeof source.source === "string" && source.source.length > 0 && source.source.length <= 50_000_000 &&
          (/^https:\/\//i.test(source.source) ||
            /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[a-z0-9+/=\s]+$/i.test(source.source));
      })
    )) &&
    Array.isArray(body.targets) && body.targets.length > 0 && body.targets.length <= 50 &&
    body.targets.every((target) => {
      if (!target || typeof target !== "object" || Array.isArray(target)) return false;
      const value = target as Record<string, unknown>;
      return (
        typeof value.platform === "string" && value.platform.trim().length > 0 && value.platform.length <= 100 &&
        typeof value.accountRef === "string" && value.accountRef.trim().length > 0 && value.accountRef.length <= 200 &&
        (value.title === undefined || (typeof value.title === "string" && value.title.trim().length > 0 && value.title.length <= 500)) &&
        isPublishDeliveryMode(value.deliveryMode)
      );
    })
  );
};

const isRewriteRequest = (value: unknown): value is RewriteRequest => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.articleId === "string" && IDENTIFIER_PATTERN.test(body.articleId) &&
    typeof body.requestId === "string" && IDENTIFIER_PATTERN.test(body.requestId) &&
    typeof body.markdown === "string" && body.markdown.length > 0 && body.markdown.length <= 2_000_000 &&
    typeof body.instruction === "string" && body.instruction.trim().length > 0 && body.instruction.length <= 100_000 &&
    Array.isArray(body.selectedTexts) && body.selectedTexts.length <= 32 &&
    body.selectedTexts.every((text) => typeof text === "string" && text.trim().length > 0 && text.length <= 2_000_000) &&
    Array.isArray(body.conversation) && body.conversation.length <= 64 &&
    body.conversation.every((message) => {
      if (!message || typeof message !== "object" || Array.isArray(message)) return false;
      const value = message as Record<string, unknown>;
      return (value.role === "user" || value.role === "assistant") &&
        typeof value.text === "string" && value.text.length <= 100_000;
    }) &&
    (body.images === undefined || arePromptImageAttachments(body.images)) &&
    validateTextModelProfile(body.modelProfile)
  );
};

interface VisualPlanRequest {
  readonly operationId?: string;
  readonly articleId: string;
  readonly markdown: string;
  readonly sourceRevisionHash?: string;
  readonly instruction?: string;
  /** Local prompt attachments that a vision-capable planning model may inspect. */
  readonly images?: readonly PromptImageAttachment[];
  readonly visualComposition: VisualCompositionRequest;
  readonly modelProfile?: TextModelProfile;
}

const isVisualPlanRequest = (value: unknown): value is VisualPlanRequest => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  const composition = body.visualComposition;
  if (!composition || typeof composition !== "object" || Array.isArray(composition)) return false;
  const visual = composition as Record<string, unknown>;
  const assets = visual.assets;
  return (
    (body.operationId === undefined || (typeof body.operationId === "string" && IDENTIFIER_PATTERN.test(body.operationId))) &&
    typeof body.articleId === "string" && IDENTIFIER_PATTERN.test(body.articleId) &&
    typeof body.markdown === "string" && body.markdown.length > 0 && body.markdown.length <= 2_000_000 &&
    (body.sourceRevisionHash === undefined || (typeof body.sourceRevisionHash === "string" && SHA256_PATTERN.test(body.sourceRevisionHash))) &&
    (body.instruction === undefined || (typeof body.instruction === "string" && body.instruction.length <= 100_000)) &&
    (body.images === undefined || arePromptImageAttachments(body.images)) &&
    (body.modelProfile === undefined || validateTextModelProfile(body.modelProfile)) &&
    ["none", "auto", "fixed"].includes(visual.mode as string) &&
    Number.isInteger(visual.targetCount) && (visual.targetCount as number) >= 0 && (visual.targetCount as number) <= 6 &&
    Array.isArray(assets) && assets.length <= 6 && assets.every((asset) => {
      if (!asset || typeof asset !== "object" || Array.isArray(asset)) return false;
      const input = asset as Record<string, unknown>;
      return typeof input.id === "string" && /^[a-z][a-z0-9_-]{0,99}$/.test(input.id) &&
        typeof input.alt === "string" && input.alt.trim().length > 0 && input.alt.length <= 2_000 &&
        typeof input.description === "string" && input.description.length <= 12_000;
    }) &&
    Array.isArray(visual.requiredAssetIds) && visual.requiredAssetIds.length <= assets.length &&
    visual.requiredAssetIds.every((id) => typeof id === "string" && /^[a-z][a-z0-9_-]{0,99}$/.test(id)) &&
    new Set(visual.requiredAssetIds).size === visual.requiredAssetIds.length &&
    visual.requiredAssetIds.every((id) => assets.some((asset) => (
      asset && typeof asset === "object" && !Array.isArray(asset) && (asset as Record<string, unknown>).id === id
    ))) &&
    ["selected_only", "library", "none"].includes(visual.assetScope as string) &&
    ["infographic", "scene", "flowchart", "comparison", "framework", "timeline"].includes(visual.preferredType as string) &&
    ["minimal", "balanced", "per-section", "rich"].includes(visual.density as string) &&
    typeof visual.style === "string" && visual.style.trim().length > 0 && visual.style.length <= 500 &&
    (visual.palette === null || (typeof visual.palette === "string" && visual.palette.length <= 500)) &&
    typeof visual.preferredImageBackend === "string" && visual.preferredImageBackend.trim().length > 0 && visual.preferredImageBackend.length <= 500 &&
    Number.isInteger(visual.generationBatchSize) && (visual.generationBatchSize as number) >= 1 && (visual.generationBatchSize as number) <= 8 &&
    Number.isInteger(visual.materialMatchThreshold) && (visual.materialMatchThreshold as number) >= 0 && (visual.materialMatchThreshold as number) <= 100 &&
    typeof visual.skipConfirmation === "boolean" &&
    !(visual.assetScope === "none" && assets.length > 0)
  );
};

export const createRuntimeApp = ({
  config,
  readiness,
  articleStore,
  writerService,
  rewriteService,
  modelTestService,
  templateExtractor,
  secretLeaseStore,
  imageService,
  publishOutboxService,
  visualPlanningService,
  operationRegistry,
}: CreateRuntimeAppOptions): Hono => {
  const app = new Hono();
  const operations = operationRegistry ?? new OperationRegistry();

  app.use("/v2/*", async (context, next) => {
    const token = readBearerToken(context.req.header("authorization"));
    if (token !== config.token) {
      return context.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "A valid per-launch runtime token is required",
            retryable: false,
          },
        },
        401,
      );
    }
    await next();
  });

  app.get("/health/live", (context) =>
    context.json({
      status: "live",
      runtimeVersion: RUNTIME_VERSION,
      protocolVersion: PROTOCOL_VERSION,
    }),
  );

  app.get("/health/ready", (context) => {
    const state = readiness();
    return context.json(
      {
        status: state.ready ? "ready" : "starting",
        checks: state.checks,
      },
      state.ready ? 200 : 503,
    );
  });

  app.get("/v2/version", (context) =>
    context.json({
      schemaVersion: PROTOCOL_VERSION,
      runtimeVersion: RUNTIME_VERSION,
      piAgentVersion: PI_AGENT_VERSION,
      engine: "pi",
      build: process.env.OPEN_PUBLISHER_BUILD_ID ?? "development",
    }),
  );

  app.post("/v2/operations/:operationId/stop", (context) => {
    const operationId = context.req.param("operationId");
    if (!IDENTIFIER_PATTERN.test(operationId)) {
      return context.json({ error: { code: "INVALID_OPERATION_ID", message: "Operation id is invalid", retryable: false } }, 400);
    }
    if (!operations.stop(operationId)) {
      return context.json({ error: { code: "OPERATION_NOT_FOUND", message: "Operation is not active", retryable: false } }, 404);
    }
    return context.json({ operationId, status: "stopping" }, 202);
  });

  if (secretLeaseStore) {
    app.post("/v2/secret-leases", async (context) => {
      const body = (await context.req.json().catch(() => null)) as
        | { id?: unknown; secret?: unknown; providerId?: unknown; expiresAtEpochMs?: unknown }
        | null;
      if (
        !body ||
        typeof body.id !== "string" ||
        typeof body.secret !== "string" ||
        typeof body.providerId !== "string" ||
        typeof body.expiresAtEpochMs !== "number"
      ) {
        return context.json(
          {
            error: {
              code: "INVALID_SECRET_LEASE",
              message: "A complete secret lease is required",
              retryable: false,
            },
          },
          400,
        );
      }
      try {
        secretLeaseStore.put({
          id: body.id,
          secret: body.secret,
          providerId: body.providerId,
          expiresAtEpochMs: body.expiresAtEpochMs,
        });
        return context.json(
          { id: body.id, accepted: true, expiresAtEpochMs: body.expiresAtEpochMs },
          201,
        );
      } catch (error: unknown) {
        return context.json(
          {
            error: {
              code: "INVALID_SECRET_LEASE",
              message: error instanceof Error ? error.message : String(error),
              retryable: false,
            },
          },
          400,
        );
      }
    });

    app.post("/v2/models/discover", async (context) => {
      const body = (await context.req.json().catch(() => null)) as
        | { modelProfile?: unknown }
        | null;
      if (!body || !validateTextModelProfile(body.modelProfile)) {
        return context.json(
          {
            error: {
              code: "INVALID_MODEL_DISCOVERY",
              message: "A valid modelProfile is required",
              retryable: false,
            },
          },
          400,
        );
      }
      const apiKey = await secretLeaseStore.resolve(body.modelProfile.secretRef);
      if (!apiKey) {
        return context.json(
          {
            error: {
              code: "MODEL_SECRET_UNAVAILABLE",
              message: "The model secret lease is unavailable",
              retryable: false,
            },
          },
          401,
        );
      }
      try {
        return context.json(await discoverModels(body.modelProfile, apiKey));
      } catch (error: unknown) {
        return context.json(
          {
            error: {
              code: "MODEL_DISCOVERY_FAILED",
              message: error instanceof Error ? error.message : String(error),
              retryable: true,
            },
          },
          502,
        );
      }
    });
  }

  if (templateExtractor) {
    app.post("/v2/templates/extract", async (context) => {
      const body = (await context.req.json().catch(() => null)) as
        | { operationId?: unknown; modelProfile?: unknown; sourceMarkdown?: unknown }
        | null;
      const sourceMarkdown = typeof body?.sourceMarkdown === "string" ? body.sourceMarkdown : null;
      if (
        !body ||
        (body.operationId !== undefined && (typeof body.operationId !== "string" || !IDENTIFIER_PATTERN.test(body.operationId))) ||
        !validateTextModelProfile(body.modelProfile) ||
        sourceMarkdown === null
      ) {
        return context.json({
          error: {
            code: "INVALID_TEMPLATE_EXTRACTION",
            message: "A valid modelProfile and sourceMarkdown are required",
            retryable: false,
          },
        }, 400);
      }
      const modelProfile = body.modelProfile;
      try {
        const extracted = await operations.run(body.operationId, (signal) =>
          templateExtractor.extract(modelProfile, sourceMarkdown, signal),
        );
        const { referenceMarkdown: _referenceMarkdown, ...summary } = extracted;
        return context.json(summary, 200);
      } catch (error: unknown) {
        return context.json({
          error: {
            code: isOperationCancelled(error) ? "OPERATION_STOPPED" : "TEMPLATE_EXTRACTION_FAILED",
            message: error instanceof Error ? error.message : String(error),
            retryable: !isOperationCancelled(error),
          },
        }, isOperationCancelled(error) ? 409 : 502);
      }
    });
  }

  if (articleStore) {
    app.get("/v2/articles", async (context) => context.json({ articles: await articleStore.list() }));

    app.get("/v2/articles/:articleId/revisions", async (context) => {
      const articleId = context.req.param("articleId");
      const article = await articleStore.read(articleId);
      if (!article) {
        return context.json({
          error: {
            code: "ARTICLE_NOT_FOUND",
            message: "Article was not found",
            retryable: false,
          },
        }, 404);
      }
      return context.json({ revisions: await articleStore.listRevisions(articleId) });
    });

    app.get("/v2/articles/:articleId/revisions/:revisionId", async (context) => {
      const revision = await articleStore.readRevision(
        context.req.param("articleId"),
        context.req.param("revisionId"),
      );
      return revision
        ? context.json(revision)
        : context.json({
            error: {
              code: "ARTICLE_REVISION_NOT_FOUND",
              message: "Article revision was not found",
              retryable: false,
            },
          }, 404);
    });

    app.post("/v2/articles/:articleId/revisions/:revisionId/restore", async (context) => {
      const restored = await articleStore.restoreRevision(
        context.req.param("articleId"),
        context.req.param("revisionId"),
      );
      return restored
        ? context.json(restored, 201)
        : context.json({
            error: {
              code: "ARTICLE_REVISION_NOT_FOUND",
              message: "Article revision was not found",
              retryable: false,
            },
          }, 404);
    });

    app.post("/v2/articles", async (context) => {
      const body = await context.req.json().catch(() => null);
      if (!isArticleWriteRequest(body)) {
        return context.json(
          {
            error: {
              code: "INVALID_ARTICLE_WRITE",
              message: "A valid ArticleWriteRequestV2 is required",
              retryable: false,
            },
          },
          400,
        );
      }
      try {
        return context.json(await articleStore.commit(body), 201);
      } catch (error: unknown) {
        if (error instanceof ArticleConflictError) {
          return context.json(
            {
              error: {
                code: error.code,
                message: error.message,
                retryable: true,
              },
            },
            409,
          );
        }
        throw error;
      }
    });

    app.get("/v2/articles/:articleId", async (context) => {
      const article = await articleStore.read(context.req.param("articleId"));
      return article
        ? context.json(article)
        : context.json(
            {
              error: {
                code: "ARTICLE_NOT_FOUND",
                message: "Article was not found",
                retryable: false,
              },
            },
            404,
          );
    });
  }

  if (articleStore && visualPlanningService) {
    app.post("/v2/visual/plan", async (context) => {
      const body = await context.req.json().catch(() => null);
      if (!isVisualPlanRequest(body)) {
        return context.json(
          {
            error: {
              code: "INVALID_VISUAL_PLAN_REQUEST",
              message: "A current article, Markdown, visualComposition, and optional valid modelProfile are required",
              retryable: false,
            },
          },
          400,
        );
      }
      const article = await articleStore.read(body.articleId);
      if (!article) {
        return context.json(
          {
            error: {
              code: "ARTICLE_NOT_FOUND",
              message: "Visual planning requires an existing article",
              retryable: false,
            },
          },
          404,
        );
      }
      if (
        article.markdown !== body.markdown ||
        (body.sourceRevisionHash !== undefined && body.sourceRevisionHash !== article.contentHash)
      ) {
        return context.json(
          {
            error: {
              code: "VISUAL_REVISION_NOT_CURRENT",
              message: "Visual planning requires the current saved Markdown revision",
              retryable: true,
            },
          },
          409,
        );
      }
      try {
        return context.json(await operations.run(body.operationId, (signal) => visualPlanningService.plan({
          markdown: article.markdown,
          sourceRevisionHash: article.contentHash,
          ...(body.instruction === undefined ? {} : { instruction: body.instruction }),
          ...(body.images === undefined ? {} : { images: body.images }),
          visualComposition: body.visualComposition,
          ...(body.modelProfile === undefined ? {} : { modelProfile: body.modelProfile }),
        }, signal)));
      } catch (error: unknown) {
        return context.json(
          {
            error: {
              code: isOperationCancelled(error) ? "OPERATION_STOPPED" : "VISUAL_PLAN_REJECTED",
              message: error instanceof Error ? error.message : String(error),
              retryable: !isOperationCancelled(error),
            },
          },
          isOperationCancelled(error) ? 409 : 400,
        );
      }
    });
  }

  if (imageService) {
    app.post("/v2/images/generate", async (context) => {
      const body = await context.req.json().catch(() => null);
      if (!isImageGenerationRequest(body)) {
        return context.json(
          {
            error: {
              code: "INVALID_IMAGE_GENERATION",
              message: "A prompt, supported size, and valid image model profile are required",
              retryable: false,
            },
          },
          400,
        );
      }
      try {
        return context.json(await operations.run(body.operationId, (signal) => imageService.generate(body, signal)), 201);
      } catch (error: unknown) {
        return context.json(
          {
            error: {
              code: isOperationCancelled(error) ? "OPERATION_STOPPED" : "IMAGE_GENERATION_FAILED",
              message: error instanceof Error ? error.message : String(error),
              retryable: !isOperationCancelled(error),
            },
          },
          isOperationCancelled(error) ? 409 : 502,
        );
      }
    });
  }

  if (articleStore && publishOutboxService) {
    app.post("/v2/publish/plans", async (context) => {
      const body = await context.req.json().catch(() => null);
      if (!isPublishPlanRequest(body)) {
        return context.json(
          {
            error: {
              code: "INVALID_PUBLISH_PLAN",
              message: "A current article revision and publish targets are required",
              retryable: false,
            },
          },
          400,
        );
      }
      const article = await articleStore.read(body.articleId);
      if (!article || article.currentRevisionId !== body.revisionId) {
        return context.json(
          {
            error: {
              code: "PUBLISH_REVISION_NOT_CURRENT",
              message: "Publishing requires the article's current immutable revision",
              retryable: true,
            },
          },
          409,
        );
      }
      try {
        return context.json(
          publishOutboxService.createPlan({
            revisionId: article.currentRevisionId,
            title: article.title,
            markdown: article.markdown,
            mediaSources: body.mediaSources ?? [],
            targets: body.targets,
          }),
          201,
        );
      } catch (error: unknown) {
        return context.json(
          {
            error: {
              code: "PUBLISH_PLAN_REJECTED",
              message: error instanceof Error ? error.message : String(error),
              retryable: false,
            },
          },
          400,
        );
      }
    });

    app.get("/v2/publish/plans/:planId", (context) => {
      try {
        return context.json(publishOutboxService.getPlan(context.req.param("planId")));
      } catch (error: unknown) {
        return context.json(
          {
            error: {
              code: "PUBLISH_PLAN_NOT_FOUND",
              message: error instanceof Error ? error.message : String(error),
              retryable: false,
            },
          },
          404,
        );
      }
    });

    app.post("/v2/publish/plans/:planId/approve", async (context) => {
      const body = (await context.req.json().catch(() => null)) as { actorId?: unknown } | null;
      const actorId = typeof body?.actorId === "string" ? body.actorId : "user:desktop";
      try {
        return context.json(publishOutboxService.approve(context.req.param("planId"), actorId));
      } catch (error: unknown) {
        return context.json(
          {
            error: {
              code: "PUBLISH_APPROVAL_REJECTED",
              message: error instanceof Error ? error.message : String(error),
              retryable: true,
            },
          },
          409,
        );
      }
    });

    app.post("/v2/publish/plans/:planId/enqueue", (context) => {
      try {
        return context.json(publishOutboxService.enqueue(context.req.param("planId")));
      } catch (error: unknown) {
        return context.json(
          {
            error: {
              code: "PUBLISH_ENQUEUE_REJECTED",
              message: error instanceof Error ? error.message : String(error),
              retryable: true,
            },
          },
          409,
        );
      }
    });

    app.post("/v2/publish/jobs/:jobId/process", async (context) => {
      try {
        return context.json(await publishOutboxService.process(context.req.param("jobId")));
      } catch (error: unknown) {
        return context.json(
          {
            error: {
              code: "PUBLISH_JOB_REJECTED",
              message: error instanceof Error ? error.message : String(error),
              retryable: true,
            },
          },
          409,
        );
      }
    });

    app.post("/v2/publish/jobs/:jobId/reconcile", async (context) => {
      try {
        return context.json(await publishOutboxService.reconcile(context.req.param("jobId")));
      } catch (error: unknown) {
        return context.json(
          {
            error: {
              code: "PUBLISH_RECONCILIATION_REJECTED",
              message: error instanceof Error ? error.message : String(error),
              retryable: true,
            },
          },
          409,
        );
      }
    });

    app.post("/v2/publish/jobs/:jobId/resolve-unknown", async (context) => {
      const body = (await context.req.json().catch(() => null)) as { resolution?: unknown } | null;
      if (!isUnknownPublishResolution(body?.resolution)) {
        return context.json(
          {
            error: {
              code: "INVALID_PUBLISH_UNKNOWN_RESOLUTION",
              message: "resolution must be draft_exists or draft_missing",
              retryable: false,
            },
          },
          400,
        );
      }
      try {
        return context.json(publishOutboxService.resolveUnknown(context.req.param("jobId"), body.resolution));
      } catch (error: unknown) {
        return context.json(
          {
            error: {
              code: "PUBLISH_UNKNOWN_RESOLUTION_REJECTED",
              message: error instanceof Error ? error.message : String(error),
              retryable: false,
            },
          },
          409,
        );
      }
    });
  }

  if (rewriteService) {
    app.post("/v2/editor/rewrite", async (context) => {
      const body = await context.req.json().catch(() => null);
      if (!isRewriteRequest(body)) {
        return context.json(
          {
            error: {
              code: "INVALID_REWRITE_REQUEST",
              message: "A valid selected-paragraph rewrite request is required",
              retryable: false,
            },
          },
          400,
        );
      }
      try {
        return context.json(await rewriteService.startRewrite({
          ...body,
          images: body.images ?? [],
        }), 202);
      } catch (error: unknown) {
        return context.json(
          {
            error: {
              code: "REWRITE_REJECTED",
              message: error instanceof Error ? error.message : String(error),
              retryable: true,
            },
          },
          400,
        );
      }
    });
  }

  if (modelTestService && secretLeaseStore) {
      app.post("/v2/model/test", async (context) => {
        const body = (await context.req.json().catch(() => null)) as
          | { modelProfile?: unknown }
          | null;
        if (!body || !validateTextModelProfile(body.modelProfile)) {
          return context.json(
            {
              error: {
                code: "INVALID_MODEL_TEST",
                message: "A valid modelProfile is required",
                retryable: false,
              },
            },
            400,
          );
        }
        const apiKey = await secretLeaseStore.resolve(body.modelProfile.secretRef);
        if (!apiKey) {
          return context.json(
            {
              error: {
                code: "MODEL_SECRET_UNAVAILABLE",
                message: "The model secret lease is unavailable",
                retryable: false,
              },
            },
            401,
          );
        }
        try {
          return context.json(await modelTestService.test(body.modelProfile, apiKey));
        } catch (error: unknown) {
          return context.json(
            {
              error: {
                code: "MODEL_TEST_FAILED",
                message: error instanceof Error ? error.message : String(error),
                retryable: true,
              },
            },
            502,
          );
        }
      });
  }

  if (writerService) {
    app.post("/v2/runs/article-create", async (context) => {
      const body = (await context.req.json().catch(() => null)) as
        | { articleId?: unknown; prompt?: unknown; images?: unknown; webSearchMode?: unknown; modelProfile?: unknown }
        | null;
      if (
        !body ||
        typeof body.articleId !== "string" ||
        typeof body.prompt !== "string" ||
        body.prompt.trim().length === 0 ||
        !validateTextModelProfile(body.modelProfile) ||
        (body.images !== undefined && !arePromptImageAttachments(body.images)) ||
        (body.webSearchMode !== undefined && !["auto", "required", "off"].includes(body.webSearchMode as string))
      ) {
        return context.json(
          {
            error: {
              code: "INVALID_CREATE_RUN",
              message: "articleId, prompt, and a valid modelProfile are required",
              retryable: false,
            },
          },
          400,
        );
      }
      try {
        const run = await writerService.startCreate({
          articleId: body.articleId,
          prompt: body.prompt,
          images: body.images ?? [],
          webSearchMode: body.webSearchMode === "required" || body.webSearchMode === "off"
            ? body.webSearchMode
            : "auto",
          modelProfile: body.modelProfile,
        });
        return context.json(run, 202);
      } catch (error: unknown) {
        return context.json(
          {
            error: {
              code: "CREATE_RUN_REJECTED",
              message: error instanceof Error ? error.message : String(error),
              retryable: true,
            },
          },
          409,
        );
      }
    });
  }

  if (writerService || rewriteService) {
    app.get("/v2/runs/:runId", (context) => {
      const runId = context.req.param("runId");
      const run = writerService?.getRun(runId) ?? rewriteService?.getRun(runId) ?? null;
      return run
        ? context.json(run)
        : context.json(
            {
              error: { code: "RUN_NOT_FOUND", message: "Run was not found", retryable: false },
            },
            404,
          );
    });

    app.post("/v2/runs/:runId/stop", async (context) => {
      try {
        const runId = context.req.param("runId");
        const run = writerService?.getRun(runId) ?? rewriteService?.getRun(runId) ?? null;
        // Writer and rewrite services intentionally share the durable journal,
        // so getRun() alone cannot tell us which in-memory Pi agent owns the
        // cancellation handle. Dispatch by the persisted operation instead.
        const service = run?.operation === "create_article"
          ? writerService
          : run?.operation === "rewrite_candidate"
            ? rewriteService
            : null;
        if (!service) throw new Error("Run was not found");
        return context.json(await service.stop(runId));
      } catch (error: unknown) {
        return context.json(
          {
            error: {
              code: "RUN_NOT_FOUND",
              message: error instanceof Error ? error.message : String(error),
              retryable: false,
            },
          },
          404,
        );
      }
    });

    app.get("/v2/runs/:runId/events", (context) => {
      const runId = context.req.param("runId");
      const rawAfterSequence = context.req.query("afterSequence") ?? "0";
      const afterSequence = Number.parseInt(rawAfterSequence, 10);
      if (!Number.isInteger(afterSequence) || afterSequence < 0) {
        return context.json(
          {
            error: {
              code: "INVALID_EVENT_CURSOR",
              message: "afterSequence must be a non-negative integer",
              retryable: false,
            },
          },
          400,
        );
      }
      const run = writerService?.getRun(runId) ?? rewriteService?.getRun(runId) ?? null;
      const service = run?.operation === "create_article"
        ? writerService
        : run?.operation === "rewrite_candidate"
          ? rewriteService
          : null;
      if (!service || !run) {
        return context.json(
          { error: { code: "RUN_NOT_FOUND", message: "Run was not found", retryable: false } },
          404,
        );
      }

      // Rust owns the runtime token, so the WebView polls through a Tauri
      // command instead of connecting to this authenticated endpoint itself.
      // SSE remains available for trusted native consumers.
      if (context.req.header("accept")?.includes("application/json")) {
        return context.json({
          events: service.eventsAfter(runId, afterSequence),
        });
      }

      return streamSSE(context, async (stream) => {
        // The journal is the durable event source. Polling it here avoids the
        // replay/subscribe race where a terminal event could be emitted after
        // replay but before a live listener was registered.
        let cursor = afterSequence;
        let aborted = false;
        stream.onAbort(() => {
          aborted = true;
        });
        while (!aborted) {
          const events = service.eventsAfter(runId, cursor);
          for (const event of events) {
            await stream.writeSSE({
              id: String(event.sequence),
              event: event.type,
              data: JSON.stringify(event),
            });
            cursor = event.sequence;
          }
          const latest = service.getRun(runId);
          if (!latest || isTerminalRunStatus(latest.status)) return;
          await new Promise<void>((resolve) => setTimeout(resolve, 250));
        }
      });
    });
  }

  app.notFound((context) =>
    context.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Runtime endpoint not found",
          retryable: false,
        },
      },
      404,
    ),
  );

  return app;
};
