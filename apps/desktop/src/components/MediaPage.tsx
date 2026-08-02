import { Check, ImagePlus, Sparkles, Upload, WandSparkles } from "lucide-react";
import { useRef, useState } from "react";
import { mediaMarkdownReference } from "../lib/mediaReferences";
import type { MediaAsset } from "../types";

interface MediaPageProps {
  assets: MediaAsset[];
  selectedAssetIds: string[];
  hasSelectedArticle: boolean;
  onAdd: (asset: MediaAsset) => void;
  onUpdate: (asset: MediaAsset) => void;
  onUpload?: (file: File) => Promise<MediaAsset>;
  onInsertInArticle: () => void;
  onSelectionChange: (assetIds: string[]) => void;
  onStartCreating: () => void;
}

export function MediaPage({
  assets,
  selectedAssetIds,
  hasSelectedArticle,
  onAdd,
  onUpdate,
  onUpload,
  onInsertInArticle,
  onSelectionChange,
  onStartCreating,
}: MediaPageProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const selected = new Set(selectedAssetIds);

  const toggle = (assetId: string) => {
    const next = new Set(selected);
    if (next.has(assetId)) next.delete(assetId);
    else next.add(assetId);
    onSelectionChange([...next]);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setUploadError("请选择 PNG、JPEG、WebP、GIF 或 AVIF 图片。");
      return;
    }
    if (!onUpload) {
      setUploadError("图片导入服务尚未连接。");
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      onAdd(await onUpload(file));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "图片导入失败，请重试。");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const startDrag = (event: React.DragEvent<HTMLElement>, asset: MediaAsset) => {
    const markdown = `![${asset.alt || asset.name}](${mediaMarkdownReference(asset)})`;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-open-publisher-markdown-image", markdown);
    event.dataTransfer.setData("text/plain", markdown);
  };

  return (
    <section className="page page--studio">
      <header className="page-heading page-heading--actions">
        <div>
          <span className="page-kicker">文章图片资产</span>
          <h1>素材库</h1>
          <p>选中图片后，可以直接插入正在编辑的文章；也可以带回创作页。内容描述和使用场景会帮助不具备视觉能力的模型判断合适位置。</p>
        </div>
        <div className="page-heading__actions">
          <button className="button button--quiet" disabled={uploading} onClick={() => inputRef.current?.click()} type="button"><Upload aria-hidden="true" size={16} />{uploading ? "导入中" : "上传图片"}</button>
          <input accept="image/png,image/jpeg,image/webp,image/gif,image/avif" className="visually-hidden" disabled={uploading} onChange={(event) => void upload(event.target.files?.[0])} ref={inputRef} type="file" />
        </div>
      </header>

      <section className="media-action-bar" aria-label="图片使用方式">
        <div>
          <strong>已选 {selected.size} 张图片</strong>
          <span>图片字节只保存在本机；工作流只会读取图片说明与插入计划。</span>
        </div>
        <div>
          <button className="button button--quiet" disabled={selected.size === 0 || !hasSelectedArticle} onClick={onInsertInArticle} type="button"><ImagePlus aria-hidden="true" size={16} />插入当前文章</button>
          <button className="button button--primary" disabled={selected.size === 0} onClick={onStartCreating} type="button"><WandSparkles aria-hidden="true" size={16} />带入创作</button>
        </div>
      </section>
      {uploadError && <p className="media-upload-error" role="alert">{uploadError}</p>}

      <div className="media-grid" aria-label="图片素材">
        {assets.map((asset) => (
          <article className={`media-card${selected.has(asset.id) ? " is-selected" : ""}`} draggable onDragStart={(event) => startDrag(event, asset)} key={asset.id}>
            <button aria-label={`选择${asset.name}`} className="media-card__image" onClick={() => toggle(asset.id)} type="button">
              <img alt={asset.alt} src={asset.src} />
              {selected.has(asset.id) && <span className="media-card__selected"><Check aria-hidden="true" size={16} /></span>}
            </button>
            <div className="media-card__meta">
              <strong>{asset.name}</strong>
              <span>{asset.source === "generated" ? "AI 生成" : "本地上传"} · {asset.createdAt}</span>
              <label className="media-card__description">
                <span>图片内容描述</span>
                <textarea
                  aria-label={`${asset.name}的图片内容描述`}
                  maxLength={600}
                  onChange={(event) => onUpdate({ ...asset, visualDescription: event.target.value, descriptionSource: "manual" })}
                  onDragStart={(event) => event.stopPropagation()}
                  placeholder="例如：三个模块通过事件总线传递任务状态。"
                  rows={2}
                  value={asset.visualDescription || ""}
                />
              </label>
              <label className="media-card__description">
                <span>使用场景</span>
                <textarea
                  aria-label={`${asset.name}的使用场景`}
                  maxLength={600}
                  onChange={(event) => onUpdate({ ...asset, usageHint: event.target.value })}
                  onDragStart={(event) => event.stopPropagation()}
                  placeholder="例如：放在介绍工作流节点关系的小节之后。"
                  rows={2}
                  value={asset.usageHint || ""}
                />
              </label>
              <label className="media-card__description">
                <span>标签（用逗号分隔）</span>
                <input
                  aria-label={`${asset.name}的标签`}
                  maxLength={240}
                  onChange={(event) => onUpdate({ ...asset, tags: event.target.value.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 24) })}
                  onDragStart={(event) => event.stopPropagation()}
                  placeholder="流程图, 架构, 教程"
                  value={(asset.tags ?? []).join(", ")}
                />
              </label>
              {asset.generationPrompt && <small>生图提示词：{asset.generationPrompt}</small>}
              <small>拖入文章即可插入</small>
            </div>
          </article>
        ))}
        {assets.length === 0 && (
          <div className="media-empty"><Sparkles aria-hidden="true" size={22} /><strong>还没有图片素材</strong><span>上传一张图片，或在文章编辑器中生成配图。</span></div>
        )}
      </div>
    </section>
  );
}
