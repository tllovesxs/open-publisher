const ARTICLE_IMAGE_PATTERN_SOURCE =
  String.raw`!\[[^\]\r\n]*\]\((?:\\.|[^)\r\n])*\)|!\[[^\]\r\n]*\]\[[^\]\r\n]*\]|<img\b[^>]*>`;

const articleImagePattern = () => new RegExp(ARTICLE_IMAGE_PATTERN_SOURCE, "gi");

interface ImageOccurrence {
  markup: string;
  index: number;
}

export interface ReconciledRewriteImages {
  markdown: string;
  preservedCount: number;
  discardedCandidateCount: number;
}

function imageOccurrences(markdown: string): ImageOccurrence[] {
  return Array.from(markdown.matchAll(articleImagePattern()), (match) => ({
    markup: match[0],
    index: match.index,
  }));
}

export function articleImages(markdown: string): string[] {
  return imageOccurrences(markdown).map((image) => image.markup);
}

export function removeArticleImages(markdown: string): string {
  return markdown
    .replace(articleImagePattern(), "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd() + "\n";
}

function paragraphBoundaries(markdown: string): number[] {
  const boundaries = new Set<number>([0, markdown.length]);
  for (const match of markdown.matchAll(/\n[ \t]*\n/g)) {
    boundaries.add((match.index ?? 0) + match[0].length);
  }
  return [...boundaries].sort((left, right) => left - right);
}

function nearestBoundary(boundaries: readonly number[], target: number): number {
  return boundaries.reduce((nearest, candidate) => (
    Math.abs(candidate - target) < Math.abs(nearest - target) ? candidate : nearest
  ), boundaries[0] ?? 0);
}

function insertImage(markdown: string, position: number, markup: string): string {
  const before = markdown.slice(0, position).replace(/[ \t]+$/g, "");
  const after = markdown.slice(position).replace(/^[ \t]+/g, "");
  const leading = before.length === 0 || before.endsWith("\n\n")
    ? ""
    : before.endsWith("\n") ? "\n" : "\n\n";
  const trailing = after.length === 0 || after.startsWith("\n\n")
    ? ""
    : after.startsWith("\n") ? "\n" : "\n\n";
  return `${before}${leading}${markup}${trailing}${after}`;
}

/**
 * Text rewrites never own image lifecycle. Candidate image markup is removed
 * and every original image is reinserted verbatim near its original relative
 * position. This keeps local asset references safe without blocking editing.
 */
export function reconcileRewriteImages(
  source: string,
  replacement: string,
): ReconciledRewriteImages {
  const sourceImages = imageOccurrences(source);
  const candidateImages = imageOccurrences(replacement);
  let markdown = replacement
    .replace(articleImagePattern(), "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  if (sourceImages.length === 0) {
    return {
      markdown,
      preservedCount: 0,
      discardedCandidateCount: candidateImages.length,
    };
  }

  const sourceTextLength = Math.max(1, source.replace(articleImagePattern(), "").length);
  const boundaries = paragraphBoundaries(markdown);
  const placements = sourceImages.map((image, ordinal) => {
    const textBeforeImage = source.slice(0, image.index).replace(articleImagePattern(), "").length;
    const proportionalTarget = Math.round((textBeforeImage / sourceTextLength) * markdown.length);
    return {
      markup: image.markup,
      ordinal,
      position: nearestBoundary(boundaries, proportionalTarget),
    };
  });

  placements
    .sort((left, right) => right.position - left.position || right.ordinal - left.ordinal)
    .forEach((placement) => {
      markdown = insertImage(markdown, placement.position, placement.markup);
    });

  return {
    markdown,
    preservedCount: sourceImages.length,
    discardedCandidateCount: candidateImages.length,
  };
}
