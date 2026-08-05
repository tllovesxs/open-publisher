import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, it } from "vitest";
import { ArticleStore } from "../src/storage/article-store.js";
import {
  importLegacyPythonArticles,
  importLegacyPythonArticlesOnce,
} from "../src/storage/legacy-python-import.js";

describe("importLegacyPythonArticles", () => {
  it("imports all legacy revisions once and leaves existing Pi data untouched", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-legacy-import-"));
    const sourcePath = join(root, "open-publisher.db");
    const source = new Database(sourcePath, { create: true });
    source.exec(`
      CREATE TABLE articles (id TEXT PRIMARY KEY, title TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE article_revisions (id TEXT PRIMARY KEY, article_id TEXT, number INTEGER, markdown TEXT, parent_revision_id TEXT, created_at TEXT);
    `);
    source.query("INSERT INTO articles VALUES (?, ?, ?, ?)").run(
      "legacy-article", "Legacy title", "2026-08-01 01:02:03.000000", "2026-08-02 03:04:05.000000",
    );
    source.query("INSERT INTO article_revisions VALUES (?, ?, ?, ?, ?, ?)").run(
      "legacy-revision-1", "legacy-article", 1, "# First", null, "2026-08-01 01:02:03.000000",
    );
    source.query("INSERT INTO article_revisions VALUES (?, ?, ?, ?, ?, ?)").run(
      "legacy-revision-2", "legacy-article", 2, "# Second", "legacy-revision-1", "2026-08-02 03:04:05.000000",
    );
    source.close();

    const articleRoot = join(root, "articles");
    const store = new ArticleStore(articleRoot);
    const firstImport = await importLegacyPythonArticles({ legacyDatabasePath: sourcePath, articleStore: store });
    const secondImport = await importLegacyPythonArticles({ legacyDatabasePath: sourcePath, articleStore: store });

    expect(firstImport).toEqual({ importedArticleIds: ["legacy-article"], skippedArticleIds: [], sourceMissing: false });
    expect(secondImport).toEqual({ importedArticleIds: [], skippedArticleIds: ["legacy-article"], sourceMissing: false });
    await expect(store.read("legacy-article")).resolves.toMatchObject({
      currentRevisionId: "revision:legacy-revision-2",
      title: "Legacy title",
      markdown: "# Second",
      updatedAt: "2026-08-02T03:04:05.000Z",
    });
    await expect(readFile(join(articleRoot, "legacy-article", "revisions", "revision%3Alegacy-revision-1.md"), "utf8")).resolves.toBe("# First");
    await expect(readFile(join(articleRoot, "legacy-article", "revisions", "revision%3Alegacy-revision-2.json"), "utf8")).resolves.toContain('"parentRevisionId": "revision:legacy-revision-1"');
  });

  it("does nothing when the old Python database is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-legacy-import-"));
    const result = await importLegacyPythonArticles({
      legacyDatabasePath: join(root, "missing.db"),
      articleStore: new ArticleStore(join(root, "articles")),
    });

    expect(result).toEqual({ importedArticleIds: [], skippedArticleIds: [], sourceMissing: true });
    await expect(access(join(root, "articles"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("records a missing legacy source once and does not rescan it on later starts", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-publisher-legacy-import-"));
    const sourcePath = join(root, "retired-python.db");
    const markerPath = join(root, "pi-runtime", "legacy-python-article-import.json");
    const options = {
      legacyDatabasePath: sourcePath,
      articleStore: new ArticleStore(join(root, "articles")),
      markerPath,
    };

    const firstStart = await importLegacyPythonArticlesOnce(options);
    expect(firstStart).toMatchObject({ outcome: "source-missing", result: { sourceMissing: true } });
    await expect(readFile(markerPath, "utf8")).resolves.toContain('"outcome": "source-missing"');

    // A database appearing later is intentionally ignored until an operator
    // explicitly requests the retry path; normal restarts must stay cheap.
    const source = new Database(sourcePath, { create: true });
    const laterStart = await importLegacyPythonArticlesOnce(options);
    expect(laterStart).toMatchObject({
      outcome: "already-checked",
      marker: { outcome: "source-missing", legacyDatabasePath: sourcePath },
    });

    source.exec(`
      CREATE TABLE articles (id TEXT PRIMARY KEY, title TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE article_revisions (id TEXT PRIMARY KEY, article_id TEXT, number INTEGER, markdown TEXT, parent_revision_id TEXT, created_at TEXT);
    `);
    source.query("INSERT INTO articles VALUES (?, ?, ?, ?)").run(
      "restored-article", "Restored", "2026-08-01 01:02:03.000000", "2026-08-01 01:02:03.000000",
    );
    source.query("INSERT INTO article_revisions VALUES (?, ?, ?, ?, ?, ?)").run(
      "restored-revision", "restored-article", 1, "# Restored", null, "2026-08-01 01:02:03.000000",
    );
    source.close();
    const retry = await importLegacyPythonArticlesOnce({ ...options, retry: true });
    expect(retry).toMatchObject({
      outcome: "imported",
      result: { importedArticleIds: ["restored-article"], sourceMissing: false },
    });
  });
});
