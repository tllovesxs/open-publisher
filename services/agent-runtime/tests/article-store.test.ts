import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ArticleConflictError,
  ArticleStore,
  replaceFileWithRetry,
} from "../src/storage/article-store.js";

describe("ArticleStore", () => {
  it("retries transient Windows replacement failures without changing the source path", async () => {
    const attempts: Array<[string, string]> = [];
    const waits: number[] = [];
    const rename = async (source: string, destination: string): Promise<void> => {
      attempts.push([source, destination]);
      if (attempts.length < 3) {
        throw Object.assign(new Error("temporarily locked"), { code: "EPERM" });
      }
    };

    await replaceFileWithRetry("draft.tmp", "draft.md", rename, async (milliseconds) => {
      waits.push(milliseconds);
    });

    expect(attempts).toEqual([
      ["draft.tmp", "draft.md"],
      ["draft.tmp", "draft.md"],
      ["draft.tmp", "draft.md"],
    ]);
    expect(waits).toEqual([25, 50]);
  });

  it("does not retry non-transient replacement failures", async () => {
    const rename = vi.fn(async () => {
      throw Object.assign(new Error("invalid path"), { code: "EINVAL" });
    });

    await expect(
      replaceFileWithRetry("draft.tmp", "draft.md", rename, async () => undefined),
    ).rejects.toMatchObject({ code: "EINVAL" });
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it("checkpoints without replacing canonical Markdown", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-articles-"));
    const store = new ArticleStore(root);
    await store.initialize();
    await store.checkpoint("article:one", "# Partial");

    expect(await store.read("article:one")).toBeNull();
    await expect(
      readFile(join(root, encodeURIComponent("article:one"), ".working.md"), "utf8"),
    ).resolves.toBe("# Partial");
  });

  it("commits immutable revisions and rejects a stale base", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-articles-"));
    const store = new ArticleStore(root);
    await store.initialize();
    const first = await store.commit({
      schemaVersion: "2",
      articleId: "article:one",
      baseRevisionId: null,
      baseContentHash: null,
      title: "First",
      markdown: "# First\n\nOriginal body.",
      reason: "create",
    });

    await expect(
      store.commit({
        schemaVersion: "2",
        articleId: "article:one",
        baseRevisionId: "revision:stale",
        baseContentHash: first.contentHash,
        title: "Wrong",
        markdown: "# Wrong",
        reason: "stale write",
      }),
    ).rejects.toBeInstanceOf(ArticleConflictError);

    await expect(
      readFile(
        join(
          root,
          encodeURIComponent("article:one"),
          "revisions",
          `${encodeURIComponent(first.currentRevisionId)}.md`,
        ),
        "utf8",
      ),
    ).resolves.toBe(first.markdown);
  });

  it("serializes concurrent commits with the same base so only one can win", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-articles-"));
    const store = new ArticleStore(root);
    await store.initialize();
    const first = await store.commit({
      schemaVersion: "2",
      articleId: "article:concurrent",
      baseRevisionId: null,
      baseContentHash: null,
      title: "Original",
      markdown: "# Original",
      reason: "create",
    });

    const writes = await Promise.allSettled([
      store.commit({
        schemaVersion: "2",
        articleId: first.articleId,
        baseRevisionId: first.currentRevisionId,
        baseContentHash: first.contentHash,
        title: "Writer A",
        markdown: "# Writer A",
        reason: "concurrent write",
      }),
      store.commit({
        schemaVersion: "2",
        articleId: first.articleId,
        baseRevisionId: first.currentRevisionId,
        baseContentHash: first.contentHash,
        title: "Writer B",
        markdown: "# Writer B",
        reason: "concurrent write",
      }),
    ]);

    expect(writes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = writes.find((result) => result.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toBeInstanceOf(ArticleConflictError);
    }

    const stored = await store.read(first.articleId);
    expect(["# Writer A", "# Writer B"]).toContain(stored?.markdown);
  });

  it("serializes an applyPatch against a concurrent commit using the same base", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-articles-"));
    const store = new ArticleStore(root);
    await store.initialize();
    const first = await store.commit({
      schemaVersion: "2",
      articleId: "article:patch-race",
      baseRevisionId: null,
      baseContentHash: null,
      title: "Race",
      markdown: "# Race\n\nReplace me.",
      reason: "create",
    });

    const writes = await Promise.allSettled([
      store.applyPatch({
        schemaVersion: "2",
        articleId: first.articleId,
        baseRevisionId: first.currentRevisionId,
        baseContentHash: first.contentHash,
        operations: [
          { selectionId: "selection:race", expectedText: "Replace me.", replacementText: "Patched." },
        ],
        reason: "patch race",
      }),
      store.commit({
        schemaVersion: "2",
        articleId: first.articleId,
        baseRevisionId: first.currentRevisionId,
        baseContentHash: first.contentHash,
        title: "Committed",
        markdown: "# Committed",
        reason: "commit race",
      }),
    ]);

    expect(writes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(writes.filter((result) => result.status === "rejected")[0]).toMatchObject({
      reason: expect.any(ArticleConflictError),
    });
  });

  it("recovers a journaled commit whose canonical Markdown and metadata were interrupted", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-articles-"));
    const articleId = "article:recovery";
    const directory = join(root, encodeURIComponent(articleId));
    const revisionId = "revision:recovered";
    const markdown = "# Recovered\n\nThe durable revision wins.";
    const contentHash = `sha256:${createHash("sha256").update(markdown, "utf8").digest("hex")}`;
    const state = {
      schemaVersion: "2" as const,
      articleId,
      title: "Recovered",
      relativePath: "article.md" as const,
      currentRevisionId: revisionId,
      contentHash,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    await mkdir(join(directory, "revisions"), { recursive: true });
    await writeFile(join(directory, "revisions", `${encodeURIComponent(revisionId)}.md`), markdown);
    await writeFile(join(directory, "article.md"), "# Torn canonical body");
    await writeFile(
      join(directory, "article.json"),
      `${JSON.stringify({ ...state, currentRevisionId: "revision:stale" })}\n`,
    );
    await writeFile(
      join(directory, ".pending-commit.json"),
      `${JSON.stringify({ schemaVersion: "1", state })}\n`,
    );

    const store = new ArticleStore(root);
    await store.initialize();

    await expect(store.read(articleId)).resolves.toEqual({ ...state, markdown });
    await expect(readFile(join(directory, "article.md"), "utf8")).resolves.toBe(markdown);
    await expect(readFile(join(directory, ".pending-commit.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("lists committed article metadata newest first without draft Markdown", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-articles-"));
    const store = new ArticleStore(root);
    await store.initialize();
    await store.commit({
      schemaVersion: "2",
      articleId: "article:first",
      baseRevisionId: null,
      baseContentHash: null,
      title: "First",
      markdown: "# First",
      reason: "create",
    });
    await store.commit({
      schemaVersion: "2",
      articleId: "article:second",
      baseRevisionId: null,
      baseContentHash: null,
      title: "Second",
      markdown: "# Second",
      reason: "create",
    });

    const articles = await store.list();

    expect(articles.map((article) => article.articleId)).toEqual([
      "article:second",
      "article:first",
    ]);
    expect(articles[0]).not.toHaveProperty("markdown");
  });

  it("applies multiple non-overlapping selections without changing other text", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-articles-"));
    const store = new ArticleStore(root);
    await store.initialize();
    const first = await store.commit({
      schemaVersion: "2",
      articleId: "article:patch",
      baseRevisionId: null,
      baseContentHash: null,
      title: "Patch",
      markdown: "# Patch\n\nAlpha paragraph.\n\nKeep this.\n\nOmega paragraph.",
      reason: "create",
    });

    const patched = await store.applyPatch({
      schemaVersion: "2",
      articleId: "article:patch",
      baseRevisionId: first.currentRevisionId,
      baseContentHash: first.contentHash,
      operations: [
        { selectionId: "selection:1", expectedText: "Alpha paragraph.", replacementText: "New alpha." },
        { selectionId: "selection:2", expectedText: "Omega paragraph.", replacementText: "New omega." },
      ],
      reason: "edit two selections",
    });

    expect(patched.markdown).toBe("# Patch\n\nNew alpha.\n\nKeep this.\n\nNew omega.");
  });

  it("lists immutable history and restores an old revision by appending a new head", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-history-"));
    const store = new ArticleStore(root);
    await store.initialize();
    const first = await store.commit({
      schemaVersion: "2",
      articleId: "article:history",
      baseRevisionId: null,
      baseContentHash: null,
      title: "First",
      markdown: "# First\n\nOriginal body.",
      reason: "writer-create",
    });
    const second = await store.commit({
      schemaVersion: "2",
      articleId: first.articleId,
      baseRevisionId: first.currentRevisionId,
      baseContentHash: first.contentHash,
      title: "Second",
      markdown: "# Second\n\nEdited body.",
      reason: "ai-rewrite",
    });

    expect(await store.listRevisions(first.articleId)).toMatchObject([
      { revisionId: second.currentRevisionId, revisionNumber: 2, reason: "ai-rewrite", isCurrent: true },
      { revisionId: first.currentRevisionId, revisionNumber: 1, reason: "writer-create", isCurrent: false },
    ]);
    await expect(store.readRevision(first.articleId, first.currentRevisionId)).resolves.toMatchObject({
      markdown: first.markdown,
      revisionNumber: 1,
    });

    const restored = await store.restoreRevision(first.articleId, first.currentRevisionId);

    expect(restored).toMatchObject({
      markdown: first.markdown,
      revisionNumber: 3,
      reason: `restore:${first.currentRevisionId}`,
      isCurrent: true,
    });
    expect(restored?.revisionId).not.toBe(first.currentRevisionId);
    await expect(store.listRevisions(first.articleId)).resolves.toHaveLength(3);
    await expect(store.read(first.articleId)).resolves.toMatchObject({ markdown: first.markdown });
  });
});
