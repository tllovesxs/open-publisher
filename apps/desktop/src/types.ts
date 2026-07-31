export type NavKey =
  | "create"
  | "articles"
  // Legacy route retained for local draft data; it is intentionally not exposed in v0.1 navigation.
  | "publish"
  | "agents"
  | "templates"
  | "media"
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

export interface StudioSkill {
  id: string;
  name: string;
  description: string;
  /** Instruction text appended to an agent's working context. Never executable code. */
  instructions: string;
  /** Human-readable origin shown in the Skill library. */
  source: string;
  isBuiltIn: boolean;
}

export interface StudioAgent {
  id: string;
  name: string;
  role: string;
  description: string;
  prompt: string;
  skillIds: string[];
  enabled: boolean;
  runtimeNodeId?: string;
}

export interface MarkdownTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  markdown: string;
  isBuiltIn: boolean;
}

export interface MediaAsset {
  id: string;
  name: string;
  alt: string;
  /** Optional author-written context for text-only visual planning. */
  description: string;
  src: string;
  source: "uploaded" | "generated";
  createdAt: string;
}
