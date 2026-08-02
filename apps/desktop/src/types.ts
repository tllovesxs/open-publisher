export type NavKey =
  | "create"
  | "articles"
  // Legacy route retained for local draft data; it is intentionally not exposed in v0.1 navigation.
  | "publish"
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

export interface TemplateStyleProfile {
  tone: string;
  audience: string;
  perspective: string;
  sentenceStyle: string;
  pacing: string;
  density: string;
}

export interface TemplateStructureProfile {
  openingPattern: string;
  sectionPattern: string;
  conclusionPattern: string;
  headingDepth: string;
  paragraphPattern: string;
}

export interface TemplateLayoutProfile {
  useLists: boolean;
  useTables: boolean;
  useBlockquotes: boolean;
  useCodeBlocks: boolean;
  imagePlacement: string;
  emphasisRules: string;
}

export type TemplateFixedBlockPosition =
  | "before_title"
  | "after_intro"
  | "before_closing"
  | "after_article";

export interface TemplateFixedBlock {
  id: string;
  label: string;
  enabled: boolean;
  content: string;
  position: TemplateFixedBlockPosition;
}

export interface MarkdownTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  markdown: string;
  styleProfile: TemplateStyleProfile;
  structureProfile: TemplateStructureProfile;
  layoutProfile: TemplateLayoutProfile;
  fixedBlocks: TemplateFixedBlock[];
  variables: string[];
  usageInstructions: string;
  isBuiltIn: boolean;
}

export interface MediaAsset {
  id: string;
  name: string;
  alt: string;
  /** Legacy field retained for one-version migration. New UI writes usageHint. */
  description: string;
  /** What the image visibly contains, independent of its original prompt. */
  visualDescription?: string;
  /** Where or why the image should be used in an article. */
  usageHint?: string;
  /** Prompt used when the image was generated, when available. */
  generationPrompt?: string;
  tags?: string[];
  descriptionSource?: "manual" | "generation_prompt" | "vision";
  src: string;
  source: "uploaded" | "generated";
  createdAt: string;
}
