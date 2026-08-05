import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArticleConflictError, ArticleStore } from "../src/storage/article-store.js";

describe("ArticleStore", () => {
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
});
