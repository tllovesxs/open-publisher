import {
  Check,
  ChevronDown,
  FilePlus2,
  ImagePlus,
  Link2,
  LoaderCircle,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type {
  DisabledOptionalNodeId,
  WebSearchMode,
  WorkflowAgentInstruction,
} from "../lib/desktopBridge";
import type { MarkdownTemplate, MediaAsset, PlatformId, StudioAgent } from "../types";

export interface CreationRequest {
  topic: string;
  title: string;
  references: string;
  contentType: string;
  tone: string;
  length: string;
  platforms: PlatformId[];
  preset: "fast" | "standard" | "deep";
  disabledNodeIds: DisabledOptionalNodeId[];
  template: MarkdownTemplate | null;
  imageAssets: MediaAsset[];
  imagePlan: ImagePlanPreference;
  agents: StudioAgent[];
  agentInstructions?: WorkflowAgentInstruction[];
  webSearchMode: WebSearchMode;
}

export interface ImagePlanPreference {
  mode: "none" | "auto" | "fixed";
  targetCount: number;
}

export interface CreationLogEntry {
  id: string;
  timestamp: number;
  message: string;
  tone: "info" | "success" | "error";
}

export interface CreationActivity {
  status: "running" | "succeeded" | "failed";
  phase: string;
  startedAt: number;
  elapsedSeconds: number;
  agentLabels: string[];
  logs: CreationLogEntry[];
  error: string | null;
  retryable: boolean;
}

type LengthPreset = "short" | "medium" | "long" | "custom";
type Picker = "template" | "media" | null;

interface CreationDraft {
  topic: string;
  title: string;
  references: string;
  tone: string;
  contentType: string;
  lengthPreset: LengthPreset;
  customLength: string;
  imagePlanMode: ImagePlanPreference["mode"];
  imageCount: number;
  webSearchMode: WebSearchMode;
}

interface CreatePageProps {
  generating: boolean;
  modelLabel: string;
  onCreate: (request: CreationRequest) => void;
  onOpenSettings: () => void;
  templates: MarkdownTemplate[];
  selectedTemplate: MarkdownTemplate | null;
  onTemplateChange: (templateId: string) => void;
  mediaAssets: MediaAsset[];
  selectedMedia: MediaAsset[];
  onMediaChange: (assetIds: string[]) => void;
  agents: StudioAgent[];
}

const CREATION_DRAFT_STORAGE_KEY = "open-publisher-creation-draft-v3";
const lengthOptions: Array<{ id: LengthPreset; label: string; instruction: string }> = [
  { id: "short", label: "短篇", instruction: "约 1,500–2,000 字" },
  { id: "medium", label: "中篇", instruction: "约 3,000–4,000 字" },
  { id: "long", label: "长篇", instruction: "约 5,500–7,000 字" },
  { id: "custom", label: "自定义", instruction: "" },
];

const defaultDraft: CreationDraft = {
  topic: "",
  title: "",
  references: "",
  tone: "专业清晰",
  contentType: "技术文章",
  lengthPreset: "medium",
  customLength: "3000",
  imagePlanMode: "auto",
  imageCount: 2,
  webSearchMode: "auto",
};

function loadDraft(): CreationDraft {
  try {
    const raw = window.localStorage.getItem(CREATION_DRAFT_STORAGE_KEY);
    if (!raw) return defaultDraft;
    const value = JSON.parse(raw) as Partial<CreationDraft>;
    return { ...defaultDraft, ...value };
  } catch {
    return defaultDraft;
  }
}

function formatLength(preset: LengthPreset, customLength: string) {
  if (preset !== "custom") return lengthOptions.find((option) => option.id === preset)?.instruction ?? "";
  const count = Number(customLength);
  return Number.isInteger(count) ? `约 ${count.toLocaleString("zh-CN")} 字` : "";
}

export function CreatePage(props: CreatePageProps) {
  const initial = useRef(loadDraft()).current;
  const [topic, setTopic] = useState(initial.topic);
  const [title, setTitle] = useState(initial.title);
  const [references, setReferences] = useState(initial.references);
  const [tone, setTone] = useState(initial.tone);
  const [contentType, setContentType] = useState(initial.contentType);
  const [lengthPreset, setLengthPreset] = useState<LengthPreset>(initial.lengthPreset);
  const [customLength, setCustomLength] = useState(initial.customLength);
  const [imagePlanMode, setImagePlanMode] = useState<ImagePlanPreference["mode"]>(initial.imagePlanMode);
  const [imageCount, setImageCount] = useState(initial.imageCount);
  const [webSearchMode, setWebSearchMode] = useState<WebSearchMode>(initial.webSearchMode);
  const [picker, setPicker] = useState<Picker>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptId = useId();

  useEffect(() => {
    window.localStorage.setItem(CREATION_DRAFT_STORAGE_KEY, JSON.stringify({
      topic, title, references, tone, contentType, lengthPreset, customLength,
      imagePlanMode, imageCount, webSearchMode,
    } satisfies CreationDraft));
  }, [contentType, customLength, imageCount, imagePlanMode, lengthPreset, references, title, tone, topic, webSearchMode]);

  const creationRequest = (): CreationRequest | null => {
    const normalizedTopic = topic.trim();
    if (!normalizedTopic) {
      setValidation("请输入创作主题。");
      document.getElementById(promptId)?.focus();
      return null;
    }
    const length = formatLength(lengthPreset, customLength);
    if (!length) {
      setValidation("自定义字数请填写 500 到 20,000 之间的整数。");
      return null;
    }
    if (lengthPreset === "custom" && (Number(customLength) < 500 || Number(customLength) > 20_000)) {
      setValidation("自定义字数请填写 500 到 20,000 之间的整数。");
      return null;
    }
    setValidation(null);
    return {
      topic: normalizedTopic,
      title: title.trim(),
      references: references.trim(),
      contentType,
      tone,
      length,
      platforms: [],
      preset: "standard",
      disabledNodeIds: ["research", "outline", "natural-style", "review"],
      template: props.selectedTemplate,
      imageAssets: props.selectedMedia,
      imagePlan: imagePlanMode === "fixed"
        ? { mode: "fixed", targetCount: imageCount }
        : { mode: imagePlanMode, targetCount: 0 },
      webSearchMode,
      agents: props.agents,
    };
  };

  const importReference = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    setReferences((current) => `${current.trim()}\n\n--- ${file.name} ---\n${text.trim()}`.trim());
  };

  const selectedIds = new Set(props.selectedMedia.map((asset) => asset.id));
  const toggleMedia = (asset: MediaAsset) => {
    const next = new Set(selectedIds);
    next.has(asset.id) ? next.delete(asset.id) : next.add(asset.id);
    props.onMediaChange([...next]);
  };

  return <section className="page page--create">
    <header className="page-heading">
      <div><span className="page-kicker">创作工作台</span><h1>开始创作</h1></div>
      <button className="model-chip" onClick={props.onOpenSettings} type="button"><span className="model-chip__dot" /><span>{props.modelLabel}</span><ChevronDown size={14} /></button>
    </header>

    <div className="creation-studio">
      <div className="creation-toolbar">
        <label><span>模板</span><select onChange={(event) => props.onTemplateChange(event.target.value)} value={props.selectedTemplate?.id ?? ""}><option value="">自由结构</option>{props.templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
        <label><span>风格</span><select onChange={(event) => setTone(event.target.value)} value={tone}><option>专业清晰</option><option>自然亲切</option><option>简洁直接</option><option>深入严谨</option></select></label>
        <label><span>篇幅</span><select onChange={(event) => setLengthPreset(event.target.value as LengthPreset)} value={lengthPreset}>{lengthOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <label><span>联网</span><select onChange={(event) => setWebSearchMode(event.target.value as WebSearchMode)} value={webSearchMode}><option value="auto">自动</option><option value="off">关闭</option></select></label>
        <label><span>配图</span><select onChange={(event) => { const value = event.target.value; setImagePlanMode(value === "none" || value === "auto" ? value : "fixed"); if (value !== "none" && value !== "auto") setImageCount(Number(value)); }} value={imagePlanMode === "fixed" ? String(imageCount) : imagePlanMode}><option value="auto">自动</option><option value="1">1 张</option><option value="2">2 张</option><option value="3">3 张</option><option value="none">不添加</option></select></label>
      </div>
      <div className="creation-composer">
        <label className="visually-hidden" htmlFor={promptId}>文章主题</label>
        <textarea autoFocus id={promptId} onChange={(event) => setTopic(event.target.value)} placeholder="写下主题、读者、目标或你希望文章回答的问题" rows={8} value={topic} />
        <div className="creation-composer__footer">
          <button className="text-button" onClick={() => fileInputRef.current?.click()} type="button"><FilePlus2 size={15} />导入资料</button>
          <input accept=".md,.markdown,.txt,text/plain,text/markdown" className="visually-hidden" onChange={(event) => void importReference(event.target.files?.[0])} ref={fileInputRef} type="file" />
          <button className="text-button" onClick={() => setPicker("media")} type="button"><ImagePlus size={15} />素材 {props.selectedMedia.length || ""}</button>
          <span>{props.selectedTemplate?.name ?? "自由结构"}</span>
          <button className="button button--primary" disabled={props.generating} onClick={() => { const request = creationRequest(); if (request) props.onCreate(request); }} type="button">{props.generating ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}{props.generating ? "正在创作" : "开始创作"}</button>
        </div>
      </div>
      {lengthPreset === "custom" && <label className="field creation-custom-length"><span>目标字数</span><input max={20_000} min={500} onChange={(event) => setCustomLength(event.target.value)} type="number" value={customLength} /></label>}
      <div className="creation-sources"><Link2 size={15} /><textarea aria-label="参考资料" onChange={(event) => setReferences(event.target.value)} placeholder="粘贴参考链接、数据、访谈摘录或已有笔记" rows={3} value={references} /></div>
      {validation && <p className="form-error" role="alert">{validation}</p>}
    </div>

    {/*
    {picker && <div className="studio-modal" role="presentation"><button aria-label="关闭素材选择" className="studio-modal__scrim" onClick={() => setPicker(null)} type="button" /><section aria-label="选择图片素材" aria-modal="true" className="creation-picker__dialog" role="dialog"><header><div><span className="page-kicker">图片参考</span><h2>选择素材库图片</h2></div><button aria-label="关闭" className="icon-button" onClick={() => setPicker(null)} type="button"><X size={18} /></button></header><div className="creation-picker__media">{props.mediaAssets.length === 0 ? <p>素材库还没有图片。</p> : props.mediaAssets.map((asset) => <button aria-pressed={selectedIds.has(asset.id)} className={selectedIds.has(asset.id) ? "is-selected" : "" key={asset.id} onClick={() => toggleMedia(asset)} type="button"><img alt="" src={asset.src} /><span><strong>{asset.name}</strong><small>{asset.description || "未填写图片说明"}</small></span>{selectedIds.has(asset.id) && <Check size={16} />}</button>)}</div><footer><button className="button button--primary" onClick={() => setPicker(null)} type="button">完成选择</button></footer></section></div>}
    */}

    {picker && (
      <div className="studio-modal" role="presentation">
        <button
          aria-label="关闭素材选择"
          className="studio-modal__scrim"
          onClick={() => setPicker(null)}
          type="button"
        />
        <section
          aria-label="选择图片素材"
          aria-modal="true"
          className="creation-picker__dialog"
          role="dialog"
        >
          <header>
            <div>
              <span className="page-kicker">图片参考</span>
              <h2>选择素材库图片</h2>
            </div>
            <button aria-label="关闭" className="icon-button" onClick={() => setPicker(null)} type="button">
              <X size={18} />
            </button>
          </header>
          <div className="creation-picker__media">
            {props.mediaAssets.length === 0 ? (
              <p>素材库还没有图片。</p>
            ) : (
              props.mediaAssets.map((asset) => (
                <button
                  aria-pressed={selectedIds.has(asset.id)}
                  className={selectedIds.has(asset.id) ? "is-selected" : ""}
                  key={asset.id}
                  onClick={() => toggleMedia(asset)}
                  type="button"
                >
                  <img alt="" src={asset.src} />
                  <span>
                    <strong>{asset.name}</strong>
                    <small>{asset.description || "未填写图片说明"}</small>
                  </span>
                  {selectedIds.has(asset.id) && <Check size={16} />}
                </button>
              ))
            )}
          </div>
          <footer>
            <button className="button button--primary" onClick={() => setPicker(null)} type="button">完成选择</button>
          </footer>
        </section>
      </div>
    )}
  </section>;
}
