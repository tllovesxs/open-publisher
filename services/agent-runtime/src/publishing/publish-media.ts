export interface PublishMediaSourceInput {
  readonly assetId: string;
  readonly source: string;
}

const LOCAL_MEDIA_REFERENCE = /asset:\/\/([a-z0-9:_-]{1,256})/gi;
const DATA_IMAGE = /^(data:image\/(?:png|jpe?g|gif|webp|avif);base64,)([a-z0-9+/=\s]+)$/i;

const normalizeSource = (source: string): string => {
  const dataImage = source.match(DATA_IMAGE);
  return dataImage
    ? `${dataImage[1]}${dataImage[2]!.replace(/\s/g, "")}`
    : source;
};

/** Resolves private editor URLs only in an immutable publish variant. */
export const resolvePublishMediaReferences = (
  markdown: string,
  mediaSources: readonly PublishMediaSourceInput[],
): string => {
  const sources = new Map<string, string>();
  for (const media of mediaSources) {
    if (sources.has(media.assetId)) {
      throw new Error(`发布图片素材重复：${media.assetId}`);
    }
    sources.set(media.assetId, normalizeSource(media.source));
  }

  const missing = new Set<string>();
  const resolved = markdown.replace(LOCAL_MEDIA_REFERENCE, (_reference, assetId: string) => {
    const source = sources.get(assetId);
    if (!source) {
      missing.add(assetId);
      return `asset://${assetId}`;
    }
    return source;
  });
  if (missing.size > 0) {
    const names = [...missing];
    throw new Error(
      `文章中的图片素材无法读取：${names.slice(0, 3).join("、")}${names.length > 3 ? " 等" : ""}`,
    );
  }
  return resolved;
};
