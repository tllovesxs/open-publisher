import { describe, expect, it } from "vitest";
import {
  githubRepositoryMarkdownUrl,
  isRepositoryMarkdownPath,
  rawRepositoryMarkdownUrl,
} from "./announcementPaths";

describe("announcement repository paths", () => {
  it("accepts Markdown documents located under docs", () => {
    expect(isRepositoryMarkdownPath("docs/release-notes.md")).toBe(true);
    expect(isRepositoryMarkdownPath("docs/announcements/2026/夏季更新.md")).toBe(true);
  });

  it.each([
    "../docs/release-notes.md",
    "docs/../private.md",
    "/docs/release-notes.md",
    "C:/docs/release-notes.md",
    "docs\\release-notes.md",
    "https://example.test/docs/release-notes.md",
    "docs/release-notes.md?raw=1",
    "docs/release-notes.md#details",
    "docs/release-notes.txt",
    "docs//release-notes.md",
  ])("rejects unsafe or unsupported repository path %s", (path) => {
    expect(isRepositoryMarkdownPath(path)).toBe(false);
    expect(rawRepositoryMarkdownUrl(path)).toBeNull();
  });

  it("builds encoded raw and GitHub document URLs from a safe path", () => {
    const path = "docs/announcements/2026/夏季 更新.md";

    expect(rawRepositoryMarkdownUrl(path)).toBe(
      "https://raw.githubusercontent.com/tllovesxs/open-publisher/main/docs/announcements/2026/%E5%A4%8F%E5%AD%A3%20%E6%9B%B4%E6%96%B0.md",
    );
    expect(githubRepositoryMarkdownUrl(path)).toBe(
      "https://github.com/tllovesxs/open-publisher/blob/main/docs/announcements/2026/%E5%A4%8F%E5%AD%A3%20%E6%9B%B4%E6%96%B0.md",
    );
  });

  it("falls back to the repository homepage for an unsafe GitHub document path", () => {
    expect(githubRepositoryMarkdownUrl("docs/../private.md")).toBe(
      "https://github.com/tllovesxs/open-publisher",
    );
  });
});
