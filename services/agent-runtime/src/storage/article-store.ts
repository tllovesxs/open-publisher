import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ArticlePatchRequestV2,
  ArticleWriteRequestV2,
} from "@open-publisher/contracts";

export interface ArticleFileState {
  schemaVersion: "2";
  articleId: string;
  title: string;
  relativePath: "article.md";
  currentRevisionId: string;
  contentHash: `sha256:${string}`;
  updatedAt: string;
}

export interface StoredArticle extends ArticleFileState {
  markdown: string;
}

interface PendingArticleCommit {
  schemaVersion: "1";
  state: ArticleFileState;
}

export class ArticleConflictError extends Error {
  readonly code = "ARTICLE_CONFLICT";
}

const ARTICLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

const hashMarkdown = (markdown: string): `sha256:${string}` =>
  `sha256:${createHash("sha256").update(markdown, "utf8").digest("hex")}`;

const atomicWrite = async (path: string, content: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  let written = false;
  try {
    const handle = await open(temporaryPath, "wx");
    try {
      await handle.writeFile(content, "utf8");
      // Flush the temporary file before making it visible at its final path.
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, path);
    written = true;
  } finally {
    if (!written) {
      await unlink(temporaryPath).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
    }
  }
};

const assertArticleId = (articleId: string): void => {
  if (!ARTICLE_ID_PATTERN.test(articleId)) {
    throw new Error("articleId contains unsupported path characters");
  }
};

export class ArticleStore {
  /**
   * Article commits use optimistic concurrency, so every read/check/write sequence
   * must be serialized for a given article inside this runtime process. This is not
   * a distributed lock; the desktop starts one Pi runtime per workspace.
   */
  private readonly articleOperationTails = new Map<string, Promise<void>>();

  constructor(readonly rootDirectory: string) {}

  async initialize(): Promise<void> {
    await mkdir(this.rootDirectory, { recursive: true });
    await this.recoverPendingCommits();
  }

  async checkpoint(articleId: string, markdown: string): Promise<void> {
    assertArticleId(articleId);
    await this.withArticleLock(articleId, async () => {
      await atomicWrite(join(this.articleDirectory(articleId), ".working.md"), markdown);
    });
  }

  async read(articleId: string): Promise<StoredArticle | null> {
    assertArticleId(articleId);
    return this.withArticleLock(articleId, () => this.readUnlocked(articleId));
  }

  async list(): Promise<ArticleFileState[]> {
    const entries = await readdir(this.rootDirectory, { withFileTypes: true });
    const articles = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) =>
          this.withArticleDirectoryLock(entry.name, async () => {
            const directory = join(this.rootDirectory, entry.name);
            await this.recoverArticleDirectory(directory);
            const metadata = await readFile(join(directory, "article.json"), "utf8").catch(
              (error: unknown) => {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
                throw error;
              },
            );
            return metadata === null ? null : (JSON.parse(metadata) as ArticleFileState);
          }),
        ),
    );
    return articles
      .filter((article): article is ArticleFileState => article !== null)
      .sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || left.articleId.localeCompare(right.articleId),
      );
  }

  async commit(request: ArticleWriteRequestV2): Promise<StoredArticle> {
    assertArticleId(request.articleId);
    return this.withArticleLock(request.articleId, () => this.commitUnlocked(request));
  }

  async applyPatch(request: ArticlePatchRequestV2): Promise<StoredArticle> {
    assertArticleId(request.articleId);
    return this.withArticleLock(request.articleId, async () => {
      const current = await this.readUnlocked(request.articleId);
      if (!current) {
        throw new ArticleConflictError("Article does not exist");
      }
      this.assertBase(current, request.baseRevisionId, request.baseContentHash);

      const spans = request.operations.map((operation) => {
        const firstIndex = current.markdown.indexOf(operation.expectedText);
        const secondIndex = current.markdown.indexOf(
          operation.expectedText,
          firstIndex + operation.expectedText.length,
        );
        if (firstIndex < 0 || secondIndex >= 0) {
          throw new ArticleConflictError(
            `Selection ${operation.selectionId} is missing or no longer unique`,
          );
        }
        return {
          start: firstIndex,
          end: firstIndex + operation.expectedText.length,
          replacement: operation.replacementText,
        };
      });

      const ascending = [...spans].sort((left, right) => left.start - right.start);
      for (let index = 1; index < ascending.length; index += 1) {
        const previous = ascending[index - 1];
        const currentSpan = ascending[index];
        if (previous && currentSpan && currentSpan.start < previous.end) {
          throw new ArticleConflictError("Patch selections overlap");
        }
      }

      let markdown = current.markdown;
      for (const span of [...spans].sort((left, right) => right.start - left.start)) {
        markdown = `${markdown.slice(0, span.start)}${span.replacement}${markdown.slice(span.end)}`;
      }

      return this.commitUnlocked({
        schemaVersion: "2",
        articleId: request.articleId,
        baseRevisionId: current.currentRevisionId,
        baseContentHash: current.contentHash,
        title: current.title,
        markdown,
        reason: request.reason,
      });
    });
  }

  private async readUnlocked(articleId: string): Promise<StoredArticle | null> {
    const directory = this.articleDirectory(articleId);
    try {
      await this.recoverArticleDirectory(directory);
      const [metadata, markdown] = await Promise.all([
        readFile(join(directory, "article.json"), "utf8"),
        readFile(join(directory, "article.md"), "utf8"),
      ]);
      return { ...(JSON.parse(metadata) as ArticleFileState), markdown };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  private async commitUnlocked(request: ArticleWriteRequestV2): Promise<StoredArticle> {
    const current = await this.readUnlocked(request.articleId);
    this.assertBase(current, request.baseRevisionId, request.baseContentHash);

    const revisionId = `revision:${randomUUID()}`;
    const updatedAt = new Date().toISOString();
    const contentHash = hashMarkdown(request.markdown);
    const state: ArticleFileState = {
      schemaVersion: "2",
      articleId: request.articleId,
      title: request.title,
      relativePath: "article.md",
      currentRevisionId: revisionId,
      contentHash,
      updatedAt,
    };
    const directory = this.articleDirectory(request.articleId);
    const revisionFileName = encodeURIComponent(revisionId);
    const revisionMetadata = {
      ...state,
      parentRevisionId: current?.currentRevisionId ?? null,
      reason: request.reason,
    };

    await mkdir(join(directory, "revisions"), { recursive: true });
    await atomicWrite(join(directory, "revisions", `${revisionFileName}.md`), request.markdown);
    await atomicWrite(
      join(directory, "revisions", `${revisionFileName}.json`),
      `${JSON.stringify(revisionMetadata, null, 2)}\n`,
    );
    await atomicWrite(
      join(directory, ".pending-commit.json"),
      `${JSON.stringify({ schemaVersion: "1", state } satisfies PendingArticleCommit, null, 2)}\n`,
    );
    await this.recoverArticleDirectory(directory);

    // This is best-effort cleanup after the canonical commit has completed. A
    // failed cleanup must not turn a durable article save into an apparent error.
    await unlink(join(directory, ".working.md")).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return;
      }
    });

    return { ...state, markdown: request.markdown };
  }

  private async recoverPendingCommits(): Promise<void> {
    const entries = await readdir(this.rootDirectory, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) =>
          this.withArticleDirectoryLock(entry.name, () =>
            this.recoverArticleDirectory(join(this.rootDirectory, entry.name)),
          ),
        ),
    );
  }

  /**
   * Complete an interrupted canonical update. Revisions are immutable and are
   * persisted before this journal is created, so the journal is enough to make
   * article.md and article.json converge to the same revision after a restart.
   */
  private async recoverArticleDirectory(directory: string): Promise<void> {
    const journalPath = join(directory, ".pending-commit.json");
    const journal = await readFile(journalPath, "utf8").catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    });
    if (journal === null) return;

    const pending = JSON.parse(journal) as PendingArticleCommit;
    const state = pending.state;
    if (
      pending.schemaVersion !== "1" ||
      state?.schemaVersion !== "2" ||
      typeof state.articleId !== "string" ||
      typeof state.currentRevisionId !== "string" ||
      typeof state.contentHash !== "string"
    ) {
      throw new Error(`Invalid pending article commit journal in ${directory}`);
    }

    const revisionPath = join(
      directory,
      "revisions",
      `${encodeURIComponent(state.currentRevisionId)}.md`,
    );
    const markdown = await readFile(revisionPath, "utf8");
    if (hashMarkdown(markdown) !== state.contentHash) {
      throw new Error(`Pending article revision checksum does not match in ${directory}`);
    }

    await atomicWrite(join(directory, "article.md"), markdown);
    await atomicWrite(join(directory, "article.json"), `${JSON.stringify(state, null, 2)}\n`);
    await unlink(journalPath);
  }

  private async withArticleLock<T>(articleId: string, operation: () => Promise<T>): Promise<T> {
    return this.withArticleDirectoryLock(encodeURIComponent(articleId), operation);
  }

  private async withArticleDirectoryLock<T>(
    articleDirectoryName: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.articleOperationTails.get(articleDirectoryName) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.articleOperationTails.set(articleDirectoryName, tail);
    void tail.then(() => {
      if (this.articleOperationTails.get(articleDirectoryName) === tail) {
        this.articleOperationTails.delete(articleDirectoryName);
      }
    });

    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release?.();
    }
  }

  private articleDirectory(articleId: string): string {
    return join(this.rootDirectory, encodeURIComponent(articleId));
  }

  private assertBase(
    current: StoredArticle | null,
    expectedRevisionId: string | null,
    expectedContentHash: string | null,
  ): void {
    if (!current) {
      if (expectedRevisionId !== null || expectedContentHash !== null) {
        throw new ArticleConflictError("Article creation cannot use an existing base revision");
      }
      return;
    }
    if (
      current.currentRevisionId !== expectedRevisionId ||
      current.contentHash !== expectedContentHash
    ) {
      throw new ArticleConflictError("Article changed after this operation started");
    }
  }
}
