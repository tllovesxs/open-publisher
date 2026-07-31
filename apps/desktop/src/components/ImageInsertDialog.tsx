import { Check, FolderOpen, ImagePlus, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { mediaMarkdownReference } from "../lib/mediaReferences";
import type { MediaAsset } from "../types";
import type { ImageInsertion } from "./MarkdownWorkbench";

interface ImageInsertDialogProps {
  open: boolean;
  assets: MediaAsset[];
  onClose: () => void;
  onInsert: (image: ImageInsertion) => void;
  onImportFile: (file: File) => Promise<ImageInsertion>;
}

export function ImageInsertDialog({
  open,
  assets,
  onClose,
  onInsert,
  onImportFile,
}: ImageInsertDialogProps) {
  const [source, setSource] = useState<"library" | "file">("library");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      onInsert(await onImportFile(file));
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "图片导入失败，请重试。");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="studio-modal image-insert-dialog" role="presentation">
      <button aria-label="关闭图片插入窗口" className="studio-modal__scrim" onClick={onClose} type="button" />
      <section aria-label="插入图片" aria-modal="true" className="image-insert-dialog__panel" role="dialog">
        <header>
          <div>
            <span className="page-kicker">文章编辑器</span>
            <h2>插入图片</h2>
          </div>
          <button aria-label="关闭" className="icon-button" onClick={onClose} type="button"><X size={18} /></button>
        </header>
        <div className="image-insert-dialog__sources" role="tablist" aria-label="图片来源">
          <button aria-selected={source === "library"} className={source === "library" ? "is-active" : ""} onClick={() => setSource("library")} role="tab" type="button"><FolderOpen size={16} />素材库</button>
          <button aria-selected={source === "file"} className={source === "file" ? "is-active" : ""} onClick={() => setSource("file")} role="tab" type="button"><Upload size={16} />本地文件</button>
        </div>
        {source === "library" ? (
          <div className="image-insert-dialog__library" role="tabpanel">
            {assets.length === 0 ? <p>素材库暂无图片。选择“本地文件”导入后会自动加入素材库。</p> : assets.map((asset) => <button key={asset.id} onClick={() => { onInsert({ alt: asset.alt || asset.name, src: mediaMarkdownReference(asset) }); onClose(); }} type="button"><img alt="" src={asset.src} /><span><strong>{asset.name}</strong><small>{asset.description || "未填写图片说明"}</small></span><ImagePlus aria-hidden="true" size={16} /></button>)}
          </div>
        ) : (
          <div className="image-insert-dialog__file" role="tabpanel">
            <Upload aria-hidden="true" size={24} />
            <strong>从本地选择图片</strong>
            <p>支持 PNG、JPEG、WebP、GIF 和 AVIF，单张最多 15 MB。导入后会同时保存到本机素材库。</p>
            <button className="button button--primary" disabled={uploading} onClick={() => inputRef.current?.click()} type="button">{uploading ? "正在导入" : "选择文件"}</button>
            <input accept="image/png,image/jpeg,image/webp,image/gif,image/avif" className="visually-hidden" onChange={(event) => void importFile(event.target.files?.[0])} ref={inputRef} type="file" />
            {error && <p className="form-error" role="alert">{error}</p>}
          </div>
        )}
        <footer><span><Check aria-hidden="true" size={14} />图片会插入到当前光标位置</span></footer>
      </section>
    </div>
  );
}
