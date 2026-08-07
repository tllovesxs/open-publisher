import { articleImages, removeArticleImages } from "./rewriteImages";

export const ARTICLE_VISUAL_MATCH_REFRESH_THRESHOLD = 58;

function similarityCharacters(markdown: string) {
  return removeArticleImages(markdown)
    .replace(/```[\s\S]*?```/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function characterBigrams(value: string) {
  const characters = Array.from(value);
  const result = new Set<string>();
  for (let index = 0; index < characters.length - 1; index += 1) {
    result.add(`${characters[index]}${characters[index + 1]}`);
  }
  return result;
}

/**
 * Estimates whether images anchored to the old article still explain the new
 * article. Text overlap carries most weight; document-length stability keeps
 * major expansion/contraction from being reported as a strong match.
 */
export function estimateArticleVisualMatch(before: string, after: string): number | null {
  if (articleImages(before).length === 0) return null;
  const beforeText = similarityCharacters(before);
  const afterText = similarityCharacters(after);
  if (!beforeText || !afterText) return 0;

  const lengthScore = Math.min(beforeText.length, afterText.length) /
    Math.max(beforeText.length, afterText.length);
  const beforeBigrams = characterBigrams(beforeText);
  const afterBigrams = characterBigrams(afterText);
  const union = new Set([...beforeBigrams, ...afterBigrams]);
  let intersection = 0;
  beforeBigrams.forEach((bigram) => {
    if (afterBigrams.has(bigram)) intersection += 1;
  });
  const overlapScore = union.size > 0 ? intersection / union.size : lengthScore;
  return Math.max(0, Math.min(100, Math.round((overlapScore * 0.75 + lengthScore * 0.25) * 100)));
}
