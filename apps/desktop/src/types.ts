export type NavKey =
  | "create"
  | "articles"
  | "publish"
  | "settings";

export type PlatformId = "wechat" | "csdn" | "toutiao";

export type ArticleStatus = "draft" | "review" | "ready" | "published";

export interface Article {
  id: string;
  title: string;
  deck: string;
  markdown: string;
  status: ArticleStatus;
  updatedAt: string;
  wordCount: number;
  channels: PlatformId[];
  collection: string;
  revisionId?: string;
  revisionNumber?: number;
}

export interface PlatformDefinition {
  id: PlatformId;
  name: string;
  shortName: string;
  limit: string;
  status: "connected" | "needs_attention" | "not_connected";
}
