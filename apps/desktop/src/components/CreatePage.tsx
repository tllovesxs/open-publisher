import {
  Check,
  ChevronDown,
  FilePlus2,
  Link2,
  LoaderCircle,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { DisabledOptionalNodeId, WorkflowAgentInstruction } from "../lib/desktopBridge";
import type { MarkdownTemplate, MediaAsset, PlatformId, StudioAgent } from "../types";

export interface CreationRequest {
  topic: string;
  title: string;
  references: string;
  contentType: string;
  tone: string;
  length: string;
  /** Platform selection belongs to the publishing step, not brief creation. */
  platforms: PlatformId[];
  preset: "fast" | "standard" | "deep";
  disabledNodeIds: DisabledOptionalNodeId[];
  template: MarkdownTemplate | null;
  imageAssets: MediaAsset[];
  imagePlan: ImagePlanPreference;
  agents: StudioAgent[];
  agentInstructions?: WorkflowAgentInstruction[];
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

interface CreationDraft {
  topic: string;
  title: string;
  references: string;
  contentType: string;
  tone: string;
  lengthPreset: LengthPreset;
  customLength: string;
  disabledNodeIds: DisabledOptionalNodeId[];
  imagePlanMode: ImagePlanPreference["mode"];
  imageCount: number;
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

const CREATION_DRAFT_STORAGE_KEY = "open-publisher-creation-draft-v2";
const optionalNodes: Array<{ id: DisabledOptionalNodeId; label: string }> = [
  { id: "research", label: "资料整理" },
  { id: "outline", label: "大纲规划" },
  { id: "natural-style", label: "自然表达" },
  { id: "review", label: "内容审阅" },
  { id: "visual", label: "配图规划" },
];

const lengthOptions = [
  { id: "short", label: "短篇（约 1,500–2,000 字）", instruction: "短篇（约 1,500–2,000 字）" },
  { id: "medium", label: "中篇（约 3,000–4,000 字）", instruction: "中篇（约 3,000–4,000 字）" },
  { id: "long", label: "长篇（约 5,500–7,000 字）", instruction: "长篇（约 5,500–7,000 字）" },
  { id: "custom", label: "自定义字数", instruction: "" },
] as const;

type LengthPreset = (typeof lengthOptions)[number]["id"];
type Picker = "template" | "media" | null;

const defaultDraft: CreationDraft = {
  topic: "",
  title: "",
  references: "",
  contentType: "技术文章",
  tone: "专业清晰",
  lengthPreset: "medium",
  customLength: "3000",
  disabledNodeIds: [],
  imagePlanMode: "auto",
  imageCount: 2,
};

function loadDraft(): CreationDraft {
  try {
    const value = window.localStorage.getItem(CREATION_DRAFT_STORAGE_KEY);
    if (!value) return defaultDraft;
    const parsed = JSON.parse(value) as Partial<CreationDraft>;
    return {
      ...defaultDraft,
      ...parsed,
      disabledNodeIds: Array.isArray(parsed.disabledNodeIds)
        ? parsed.disabledNodeIds.filter((id): id is DisabledOptionalNodeId => optionalNodes.some((node) => node.id === id))
        : [],
    };
  } catch {
    return defaultDraft;
  }
}

export function CreatePage({
  generating,
  modelLabel,
  onCreate,
  onOpenSettings,
  templates,
  selectedTemplate,
  onTemplateChange,
  mediaAssets,
  selectedMedia,
  onMediaChange,
  agents,
}: CreatePageProps) {
  const [initialDraft] = useState(loadDraft);
  const [topic, setTopic] = useState(initialDraft.topic);
  const [title, setTitle] = useState(initialDraft.title);
  const [references, setReferences] = useState(initialDraft.references);
  const [contentType, setContentType] = useState(initialDraft.contentType);
  const [tone, setTone] = useState(initialDraft.tone);
  const [lengthPreset, setLengthPreset] = useState<LengthPreset>(initialDraft.lengthPreset);
  const [customLength, setCustomLength] = useState(initialDraft.customLength);
  const [disabledNodes, setDisabledNodes] = useState<Set<DisabledOptionalNodeId>>(
    () => new Set(initialDraft.disabledNodeIds),
  );
  const [imagePlanMode, setImagePlanMode] = useState<ImagePlanPreference["mode"]>(initialDraft.imagePlanMode);
  const [imageCount, setImageCount] = useState(initialDraft.imageCount);
  const [validation, setValidation] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const topicId = useId();
  const customLengthId = useId();

  useEffect(() => {
    const draft: CreationDraft = {
      topic,
      title,
      references,
      contentType,
      tone,
      lengthPreset,
      customLength,
      disabledNodeIds: [...disabledNodes],
      imagePlanMode,
      imageCount,
    };
    window.localStorage.setItem(CREATION_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }, [contentType, customLength, disabledNodes, imageCount, imagePlanMode, lengthPreset, references, title, tone, topic]);

  const toggleNode = (nodeId: DisabledOptionalNodeId) => {
    if (nodeId === "visual" && imagePlanMode !== "none") return;
    setDisabledNodes((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const changeImagePlan = (value: string) => {
    if (value === "none" || value === "auto") setImagePlanMode(value);
    else {
      setImagePlanMode("fixed");
      setImageCount(Number(value));
    }
    setDisabledNodes((current) => {
      const next = new Set(current);
      if (value === "none") next.add("visual");
      else next.delete("visual");
      return next;
    });
  };

  const importReference = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const block = `\n\n--- ${file.name} ---\n${text.trim()}`;
    setReferences((current) => `${current.trim()}${block}`.trim());
  };

  const submit = () => {
    const normalizedTopic = topic.trim();
    if (!normalizedTopic) {
      setValidation("请输入文章主题。");
      document.getElementById(topicId)?.focus();
      return;
    }
    const selectedLength = lengthOptions.find((option) => option.id === lengthPreset);
    let length: string = selectedLength?.instruction ?? "";
    if (lengthPreset === "custom") {
      const target = Number(customLength);
      if (!Number.isInteger(target) || target < 500 || target > 20_000) {
        setValidation("自定义字数请填写 500 到 20,000 之间的整数。");
        document.getElementById(customLengthId)?.focus();
        return;
      }
      length = `自定义（约 ${target.toLocaleString("zh-CN")} 字）`;
    }
    setValidation(null);
    onCreate({
      topic: normalizedTopic,
      title: title.trim(),
      references: references.trim(),
      contentType,
      tone,
      length,
      platforms: [],
      preset: "deep",
      disabledNodeIds: [...disabledNodes],
      template: selectedTemplate,
      imageAssets: selectedMedia,
      imagePlan: imagePlanMode === "fixed"
        ? { mode: "fixed", targetCount: imageCount }
        : { mode: imagePlanMode, targetCount: 0 },
      agents,
    });
  };

  const selectedIds = new Set(selectedMedia.map((asset) => asset.id));
  const toggleMedia = (asset: MediaAsset) => {
    const next = new Set(selectedIds);
    if (next.has(asset.id)) next.delete(asset.id);
    else next.add(asset.id);
    onMediaChange([...next]);
  };

  return (
    <section className="page page--create">
      <header className="page-heading">
        <div>
          <span className="page-kicker">新文章</span>
          <h1>从一个主题开始</h1>
        </div>
        <button className="model-chip" onClick={onOpenSettings} type="button">
          <span className="model-chip__dot" aria-hidden="true" />
          <span>{modelLabel}</span>
          <ChevronDown aria-hidden="true" size={14} />
        </button>
      </header>

      <div className="create-layout">
        <div className="create-form">
          <div className="field">
            <label htmlFor={topicId}>文章主题</label>
            <textarea autoFocus id={topicId} onChange={(event) => setTopic(event.target.value)} placeholder="例如：Tauri v2 与 Python Sidecar 的进程边界" rows={4} value={topic} />
          </div>
          <div className="field">
            <label htmlFor="creation-title">标题 <span>可选</span></label>
            <input id="creation-title" onChange={(event) => setTitle(event.target.value)} placeholder="留空则由 AI 生成" value={title} />
          </div>
          <div className="field">
            <div className="field__head">
              <label htmlFor="creation-references">参考资料</label>
              <button className="text-button" onClick={() => fileInputRef.current?.click()} type="button"><FilePlus2 aria-hidden="true" size={15} />导入文本</button>
              <input accept=".md,.markdown,.txt,text/plain,text/markdown" className="visually-hidden" onChange={(event) => void importReference(event.target.files?.[0])} ref={fileInputRef} type="file" />
            </div>
            <div className="textarea-with-icon">
              <Link2 aria-hidden="true" size={16} />
              <textarea id="creation-references" onChange={(event) => setReferences(event.target.value)} placeholder="粘贴参考链接、摘录或已有笔记" rows={7} value={references} />
            </div>
          </div>
          <div className="form-grid form-grid--three">
            <label className="field"><span>内容类型</span><select onChange={(event) => setContentType(event.target.value)} value={contentType}><option>技术文章</option><option>教程</option><option>观点文章</option><option>资讯解读</option></select></label>
            <label className="field"><span>表达风格</span><select onChange={(event) => setTone(event.target.value)} value={tone}><option>专业清晰</option><option>自然亲切</option><option>简洁直接</option><option>深入严谨</option></select></label>
            <label className="field"><span>文章篇幅</span><select onChange={(event) => setLengthPreset(event.target.value as LengthPreset)} value={lengthPreset}>{lengthOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
          </div>
          {lengthPreset === "custom" && <div className="field field--custom-length"><label htmlFor={customLengthId}>自定义约多少字</label><input aria-describedby={`${customLengthId}-hint`} id={customLengthId} inputMode="numeric" max={20_000} min={500} onChange={(event) => setCustomLength(event.target.value)} step={100} type="number" value={customLength} /><small id={`${customLengthId}-hint`}>支持 500–20,000 字，模型会按接近该长度的正文生成。</small></div>}
        </div>

        <aside className="create-options" aria-label="创作选项">
          <section className="option-section">
            <div className="option-section__head"><strong>Markdown 模板</strong><button className="text-button" onClick={() => setPicker("template")} type="button">选择</button></div>
            <button className="creation-reference-card" onClick={() => setPicker("template")} type="button"><span><strong>{selectedTemplate?.name ?? "不使用固定模板"}</strong><small>{selectedTemplate?.description ?? "由工作流根据主题自由组织结构"}</small></span><ChevronDown aria-hidden="true" size={15} /></button>
          </section>
          <section className="option-section">
            <div className="option-section__head"><strong>正文配图</strong><small>{imagePlanMode === "auto" ? "按成稿字数" : imagePlanMode === "none" ? "不插入" : `${imageCount} 张`}</small></div>
            <label className="field field--compact"><span className="visually-hidden">配图数量</span><select aria-label="配图数量" onChange={(event) => changeImagePlan(event.target.value)} value={imagePlanMode === "fixed" ? String(imageCount) : imagePlanMode}><option value="auto">自动（按文章长度）</option>{[1, 2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} 张</option>)}<option value="none">不添加配图</option></select></label>
            <small className="option-section__hint">优先使用已选素材；不足部分会由已配置的生图模型补齐，并自动插入正文。</small>
          </section>
          <section className="option-section">
            <div className="option-section__head"><strong>图片参考</strong><button className="text-button" onClick={() => setPicker("media")} type="button">选择</button></div>
            <button className="creation-reference-card" onClick={() => setPicker("media")} type="button"><span><strong>{selectedMedia.length ? `已选择 ${selectedMedia.length} 张图片` : "尚未选择图片"}</strong><small>{selectedMedia.length ? "视觉 Agent 会按文章结构安排位置" : "可在此直接选择素材，或让 AI 自动生成"}</small></span><ChevronDown aria-hidden="true" size={15} /></button>
          </section>
          <details className="advanced-options"><summary>高级流程<ChevronDown aria-hidden="true" size={15} /></summary><div>{optionalNodes.map((node) => <label key={node.id}><input checked={!disabledNodes.has(node.id)} disabled={node.id === "visual" && imagePlanMode !== "none"} onChange={() => toggleNode(node.id)} type="checkbox" /><span>{node.label}{node.id === "visual" && imagePlanMode !== "none" ? "（配图已启用）" : ""}</span></label>)}</div></details>
          {validation && <p className="form-error" role="alert">{validation}</p>}
          <button className="button button--primary create-submit" disabled={generating} onClick={submit} type="button">{generating ? <LoaderCircle aria-hidden="true" className="spin" size={17} /> : <Sparkles aria-hidden="true" size={17} />}{generating ? "正在创建文章" : "开始创作"}</button>
        </aside>
      </div>

      {picker && <div className="studio-modal creation-picker" role="presentation"><button aria-label="关闭选择框" className="studio-modal__scrim" onClick={() => setPicker(null)} type="button" /><section aria-label={picker === "template" ? "选择 Markdown 模板" : "选择图片素材"} aria-modal="true" className="creation-picker__dialog" role="dialog"><header><div><span className="page-kicker">{picker === "template" ? "文章结构" : "图片参考"}</span><h2>{picker === "template" ? "选择 Markdown 模板" : "选择素材库图片"}</h2></div><button aria-label="关闭" className="icon-button" onClick={() => setPicker(null)} type="button"><X size={18} /></button></header>{picker === "template" ? <div className="creation-picker__grid">{templates.map((template) => <button aria-pressed={selectedTemplate?.id === template.id} className={selectedTemplate?.id === template.id ? "is-selected" : ""} key={template.id} onClick={() => { onTemplateChange(template.id); setPicker(null); }} type="button"><strong>{template.name}</strong><span>{template.description}</span><small>{template.category}</small>{selectedTemplate?.id === template.id && <Check aria-hidden="true" size={16} />}</button>)}</div> : <div className="creation-picker__media">{mediaAssets.length === 0 ? <p>素材库还没有图片。你可以稍后在文章编辑器中拖入、粘贴或选择文件。</p> : mediaAssets.map((asset) => <button aria-pressed={selectedIds.has(asset.id)} className={selectedIds.has(asset.id) ? "is-selected" : ""} key={asset.id} onClick={() => toggleMedia(asset)} type="button"><img alt="" src={asset.src} /><span><strong>{asset.name}</strong><small>{asset.description || "未填写图片说明"}</small></span>{selectedIds.has(asset.id) && <Check aria-hidden="true" size={16} />}</button>)}</div>}<footer><button className="button button--primary" onClick={() => setPicker(null)} type="button">完成选择</button></footer></section></div>}
    </section>
  );
}
