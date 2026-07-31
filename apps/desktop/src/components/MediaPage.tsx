import { Check, ImagePlus, Sparkles, Upload, WandSparkles } from "lucide-react";
import { useRef } from "react";
import type { MediaAsset } from "../types";

interface MediaPageProps {
  assets: MediaAsset[];
  selectedAssetIds: string[];
  hasSelectedArticle: boolean;
  onAdd: (asset: MediaAsset) => void;
  onInsertInArticle: () => void;
  onSelectionChange: (assetIds: string[]) => void;
  onStartCreating: () => void;
}

export function MediaPage({
  assets,
  selectedAssetIds,
  hasSelectedArticle,
  onAdd,
  onInsertInArticle,
  onSelectionChange,
  onStartCreating,
}: MediaPageProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = new Set(selectedAssetIds);

  const toggle = (assetId: string) => {
    const next = new Set(selected);
    if (next.has(assetId)) next.delete(assetId);
    else next.add(assetId);
    onSelectionChange([...next]);
  };

  const upload = (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      onAdd({
        id: `upload-${Date.now()}`,
        name: file.name.replace(/\.[^.]+$/, ""),
        alt: file.name.replace(/\.[^.]+$/, ""),
        src: reader.result,
        source: "uploaded",
        createdAt: "刚刚上传",
      });
    };
    reader.readAsDataURL(file);
  };

  return (
    <section className="page page--studio">
      <header className="page-heading page-heading--actions">
        <div>
          <span className="page-kicker">文章图片资产</span>
          <h1>素材库</h1>
          <p>选中图片后，可以直接插入正在编辑的文章，或交给 AI 判断正文中的合适位置。</p>
        </div>
        <div className="page-heading__actions">
          <button className="button button--quiet" onClick={() => inputRef.current?.click()} type="button"><Upload aria-hidden="true" size={16} />上传图片</button>
          <input accept="image/*" className="visually-hidden" onChange={(event) => upload(event.target.files?.[0])} ref={inputRef} type="file" />
        </div>
      </header>

      <section className="media-action-bar" aria-label="图片使用方式">
        <div>
          <strong>已选 {selected.size} 张图片</strong>
          <span>图片只保存在本地，生成时会作为视觉参考传入工作流。</span>
        </div>
        <div>
          <button className="button button--quiet" disabled={selected.size === 0 || !hasSelectedArticle} onClick={onInsertInArticle} type="button"><ImagePlus aria-hidden="true" size={16} />插入当前文章</button>
          <button className="button button--primary" disabled={selected.size === 0} onClick={onStartCreating} type="button"><WandSparkles aria-hidden="true" size={16} />让 AI 编排图片</button>
        </div>
      </section>

      <div className="media-grid" aria-label="图片素材">
        {assets.map((asset) => (
          <article className={`media-card${selected.has(asset.id) ? " is-selected" : ""}`} key={asset.id}>
            <button aria-label={`选择${asset.name}`} className="media-card__image" onClick={() => toggle(asset.id)} type="button">
              <img alt={asset.alt} src={asset.src} />
              {selected.has(asset.id) && <span className="media-card__selected"><Check aria-hidden="true" size={16} /></span>}
            </button>
            <div className="media-card__meta">
              <strong>{asset.name}</strong>
              <span>{asset.source === "builtin" ? "内置素材" : asset.source === "generated" ? "AI 生成" : "本地上传"} · {asset.createdAt}</span>
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
