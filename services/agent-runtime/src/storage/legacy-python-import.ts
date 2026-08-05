import { createHash } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";
import type { ArticleFileState, ArticleStore } from "./article-store.js";

const ARTICLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

interface LegacyArticleRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface LegacyRevisionRow {
  id: string;
  article_id: string;
  number: number;
  markdown: string;
  parent_revision_id: string | null;
  created_at: string;
}

export interface LegacyPythonImportOptions {
  /** The Python runtime database, normally app-data/agent-runtime/open-publisher.db. */
  readonly legacyDatabasePath: string;
  /** The Pi ArticleStore, normally rooted at the configured articles directory. */
  readonly articleStore: ArticleStore;
}

export interface LegacyPythonImportResult {
  readonly importedArticleIds: readonly string[];
  readonly skippedArticleIds: readonly string[];
  readonly sourceMissing: boolean;
}

interface LegacyPythonImportMarker {
  readonly schemaVersion: 1;
  readonly legacyDatabasePath: string;
  readonly outcome: "imported" | "source-missing";
  readonly checkedAt: string;
}

export interface LegacyPythonImportOnceOptions extends LegacyPythonImportOptions {
  /** A Pi-runtime-owned file recording that the legacy source was checked. */
  readonly markerPath: string;
  /** Bypass a prior marker, for example after restoring an old Python database. */
  readonly retry?: boolean;
}

export type LegacyPythonImportOnceResult =
  | {
      readonly outcome: "already-checked";
      readonly marker: LegacyPythonImportMarker;
    }
  | {
      readonly outcome: "imported" | "source-missing";
      readonly result: LegacyPythonImportResult;
    };

const hashMarkdown = (markdown: string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(markdown, "utf8").digest("hex")}`;

const normalizeTimestamp = (value: string): string => {
  const hasTimezone = /(?:Z|[+-]\d\d:\d\d)$/i.test(value);
  const parsed = new Date(hasTimezone ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Legacy database contains an invalid timestamp: ${value}`);
  }
  return parsed.toISOString();
};

const atomicWrite = async (path: string, content: string): Promise<void> => {
  const temporaryPath = `${path}.legacy-import-tmp`;
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, path);
};

const sourceExists = async (path: string): Promise<boolean> => {
  try {
    await access(path);
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};

const readCompletionMarker = async (
  markerPath: string,
  legacyDatabasePath: string,
): Promise<LegacyPythonImportMarker | null> => {
  try {
    const parsed: unknown = JSON.parse(await readFile(markerPath, "utf8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as Record<string, unknown>).schemaVersion !== 1 ||
      (parsed as Record<string, unknown>).legacyDatabasePath !== legacyDatabasePath ||
      ((parsed as Record<string, unknown>).outcome !== "imported" &&
        (parsed as Record<string, unknown>).outcome !== "source-missing") ||
      typeof (parsed as Record<string, unknown>).checkedAt !== "string"
    ) {
      return null;
    }
    return parsed as LegacyPythonImportMarker;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    // A malformed or unreadable marker must not suppress a recoverable import.
    return null;
  }
};

const writeCompletionMarker = async (
  markerPath: string,
  legacyDatabasePath: string,
  outcome: LegacyPythonImportMarker["outcome"],
): Promise<void> => {
  await mkdir(dirname(markerPath), { recursive: true });
  const marker: LegacyPythonImportMarker = {
    schemaVersion: 1,
    legacyDatabasePath,
    outcome,
    checkedAt: new Date().toISOString(),
  };
  await atomicWrite(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
};

const assertIdentifier = (kind: string, id: string): void => {
  if (!ARTICLE_ID_PATTERN.test(id)) {
    throw new Error(`Legacy ${kind} id cannot be represented by the Pi article store: ${id}`);
  }
};

/**
 * Copies only the Python article domain into Pi's file-backed ArticleStore.
 * The source database is opened read-only. An existing article.json is a
 * completion marker, so reruns never overwrite newer Pi-side article data.
 */
export const importLegacyPythonArticles = async (
  options: LegacyPythonImportOptions,
): Promise<LegacyPythonImportResult> => {
  if (!(await sourceExists(options.legacyDatabasePath))) {
    return { importedArticleIds: [], skippedArticleIds: [], sourceMissing: true };
  }

  await options.articleStore.initialize();
  const database = new Database(options.legacyDatabasePath, { readonly: true, strict: true });
  try {
    const hasArticleTables = database
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('articles', 'article_revisions')",
      )
      .all();
    if (hasArticleTables.length !== 2) {
      throw new Error("Legacy database does not contain the articles and article_revisions tables");
    }

    const articles = database
      .query<LegacyArticleRow, []>(
        "SELECT id, title, created_at, updated_at FROM articles ORDER BY created_at ASC, id ASC",
      )
      .all();
    const revisions = database
      .query<LegacyRevisionRow, []>(
        `SELECT id, article_id, number, markdown, parent_revision_id, created_at
         FROM article_revisions ORDER BY article_id ASC, number ASC, created_at ASC, id ASC`,
      )
      .all();
    const revisionsByArticle = new Map<string, LegacyRevisionRow[]>();
    for (const revision of revisions) {
      const existing = revisionsByArticle.get(revision.article_id) ?? [];
      existing.push(revision);
      revisionsByArticle.set(revision.article_id, existing);
    }

    const importedArticleIds: string[] = [];
    const skippedArticleIds: string[] = [];
    for (const article of articles) {
      assertIdentifier("article", article.id);
      const articleRevisions = revisionsByArticle.get(article.id) ?? [];
      if (articleRevisions.length === 0) {
        // Python never exposed an article without a revision. Do not create an
        // unreadable Pi article from an incomplete legacy record.
        skippedArticleIds.push(article.id);
        continue;
      }
      for (const revision of articleRevisions) assertIdentifier("revision", revision.id);

      if (await options.articleStore.read(article.id)) {
        skippedArticleIds.push(article.id);
        continue;
      }

      const directory = join(options.articleStore.rootDirectory, encodeURIComponent(article.id));
      const revisionDirectory = join(directory, "revisions");
      if (await sourceExists(join(directory, ".working.md"))) {
        // A Pi draft is user data too. It has no article.json yet, so detect it
        // explicitly instead of replacing it with an imported canonical article.
        skippedArticleIds.push(article.id);
        continue;
      }
      await mkdir(revisionDirectory, { recursive: true });
      for (const revision of articleRevisions) {
        const revisionId = `revision:${revision.id}`;
        const revisionState = {
          schemaVersion: "2" as const,
          articleId: article.id,
          title: article.title,
          relativePath: "article.md" as const,
          currentRevisionId: revisionId,
          contentHash: hashMarkdown(revision.markdown),
          updatedAt: normalizeTimestamp(revision.created_at),
          parentRevisionId: revision.parent_revision_id ? `revision:${revision.parent_revision_id}` : null,
          reason: "legacy-python-import",
          legacyRevisionNumber: revision.number,
          legacyCreatedAt: revision.created_at,
        };
        const filename = encodeURIComponent(revisionId);
        await atomicWrite(join(revisionDirectory, `${filename}.md`), revision.markdown);
        await atomicWrite(join(revisionDirectory, `${filename}.json`), `${JSON.stringify(revisionState, null, 2)}\n`);
      }

      const current = articleRevisions.at(-1)!;
      const state: ArticleFileState = {
        schemaVersion: "2",
        articleId: article.id,
        title: article.title,
        relativePath: "article.md",
        currentRevisionId: `revision:${current.id}`,
        contentHash: hashMarkdown(current.markdown),
        updatedAt: normalizeTimestamp(article.updated_at),
      };
      await atomicWrite(join(directory, "article.md"), current.markdown);
      // Write the completion marker last. This makes an interrupted import retryable.
      await atomicWrite(join(directory, "article.json"), `${JSON.stringify(state, null, 2)}\n`);
      importedArticleIds.push(article.id);
    }

    return { importedArticleIds, skippedArticleIds, sourceMissing: false };
  } finally {
    database.close();
  }
};

/**
 * Imports the retired Python article store at most once during normal startup.
 * A missing source is also a terminal outcome: the Python runtime is retired,
 * so repeatedly probing its database on every Pi restart is wasted work. Set
 * retry when an operator intentionally restores a legacy database.
 */
export const importLegacyPythonArticlesOnce = async (
  options: LegacyPythonImportOnceOptions,
): Promise<LegacyPythonImportOnceResult> => {
  if (!options.retry) {
    const marker = await readCompletionMarker(options.markerPath, options.legacyDatabasePath);
    if (marker) return { outcome: "already-checked", marker };
  }

  const result = await importLegacyPythonArticles(options);
  const outcome = result.sourceMissing ? "source-missing" : "imported";
  // Do not create the marker until a complete import/check succeeds. If the
  // importer throws, the next launch can safely retry from its per-article
  // completion markers.
  await writeCompletionMarker(options.markerPath, options.legacyDatabasePath, outcome);
  return { outcome, result };
};
