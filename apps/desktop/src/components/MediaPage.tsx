import {
  ArrowDownAZ,
  Check,
  ChevronDown,
  FileImage,
  ImagePlus,
  Info,
  Search,
  Sparkles,
  Tag,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import {
  type DragEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { mediaMarkdownReference } from "../lib/mediaReferences";
import type { MediaAsset } from "../types";
import "./MediaPage.css";

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

type SourceFilter = "all" | "uploaded" | "generated" | "needs_description";
type SortOrder = "recent" | "name" | "source";

interface MediaDetailsDraft {
  alt: string;
  visualDescription: string;
  usageHint: string;
  tags: string;
}

const filters: Array<{ id: SourceFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "uploaded", label: "本地上传" },
  { id: "generated", label: "AI 生成" },
  { id: "needs_description", label: "缺少说明" },
];

function detailsDraftFor(asset: MediaAsset): MediaDetailsDraft {
  return {
    alt: asset.alt || asset.name,
    visualDescription: asset.visualDescription || asset.description || "",
    usageHint: asset.usageHint || "",
    tags: (asset.tags ?? []).join(", "),
  };
}

function descriptionFor(asset: MediaAsset) {
  return asset.visualDescription?.trim() || asset.description?.trim() || "还没有添加图片说明";
}

function tagsFor(value: string) {
  return value
    .split(/[，,]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 24);
}

function assetMatchesFilter(asset: MediaAsset, filter: SourceFilter) {
  if (filter === "uploaded") return asset.source === "uploaded";
  if (filter === "generated") return asset.source === "generated";
  if (filter === "needs_description") return !asset.visualDescription?.trim() && !asset.description?.trim();
  return true;
}

function compareAssets(first: MediaAsset, second: MediaAsset, sort: SortOrder) {
  if (sort === "name") return first.name.localeCompare(second.name, "zh-Hans-CN");
  if (sort === "source") {
    const bySource = first.source.localeCompare(second.source);
    return bySource || first.name.localeCompare(second.name, "zh-Hans-CN");
  }
  return 0;
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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [sort, setSort] = useState<SortOrder>("recent");
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const [detailsDraft, setDetailsDraft] = useState<MediaDetailsDraft | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const selected = useMemo(() => new Set(selectedAssetIds), [selectedAssetIds]);
  const activeAsset = assets.find((asset) => asset.id === activeAssetId) ?? null;

  const visibleAssets = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return assets
      .filter((asset) => assetMatchesFilter(asset, filter))
      .filter((asset) => {
        if (!normalizedQuery) return true;
        return [
          asset.name,
          asset.alt,
          asset.description,
          asset.visualDescription,
          asset.usageHint,
          asset.tags?.join(" "),
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      })
      .sort((first, second) => compareAssets(first, second, sort));
  }, [assets, filter, query, sort]);

  useEffect(() => {
    if (!activeAsset) {
      setDetailsDraft(null);
      return;
    }
    setDetailsDraft(detailsDraftFor(activeAsset));
  }, [activeAsset?.id]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && activeAssetId) setActiveAssetId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeAssetId]);

  const toggle = (assetId: string) => {
    const next = new Set(selected);
    if (next.has(assetId)) next.delete(assetId);
    else next.add(assetId);
    onSelectionChange([...next]);
  };

  const clearSelection = () => onSelectionChange([]);

  const openDetails = (asset: MediaAsset) => {
    setActiveAssetId(asset.id);
    setDetailsDraft(detailsDraftFor(asset));
  };

  const uploadFiles = async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
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
      for (const file of imageFiles) onAdd(await onUpload(file));
      if (imageFiles.length !== files.length) {
        setUploadError("已忽略非图片文件。");
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "图片导入失败，请重试。");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const startDrag = (event: DragEvent<HTMLElement>, asset: MediaAsset) => {
    const markdown = `![${asset.alt || asset.name}](${mediaMarkdownReference(asset)})`;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-open-publisher-markdown-image", markdown);
    event.dataTransfer.setData("text/plain", markdown);
  };

  const onPageDragOver = (event: DragEvent<HTMLElement>) => {
    if (![...event.dataTransfer.types].includes("Files")) return;
    event.preventDefault();
    setDropActive(true);
  };

  const onPageDrop = (event: DragEvent<HTMLElement>) => {
    if (![...event.dataTransfer.types].includes("Files")) return;
    event.preventDefault();
    setDropActive(false);
    void uploadFiles([...event.dataTransfer.files]);
  };

  const saveDetails = () => {
    if (!activeAsset || !detailsDraft) return;
    onUpdate({
      ...activeAsset,
      alt: detailsDraft.alt.trim() || activeAsset.name,
      description: detailsDraft.visualDescription.trim(),
      visualDescription: detailsDraft.visualDescription.trim(),
      usageHint: detailsDraft.usageHint.trim(),
      tags: tagsFor(detailsDraft.tags),
      descriptionSource: "manual",
    });
    setActiveAssetId(null);
  };

  return (
    <section
      className={`page page--studio media-library${dropActive ? " is-drop-active" : ""}`}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDropActive(false);
      }}
      onDragOver={onPageDragOver}
      onDrop={onPageDrop}
    >
      <header className="media-library__heading">
        <div>
          <span className="page-kicker">文章图片资产</span>
          <h1>素材库</h1>
          <p>浏览、标注和选择图片。拖入文章可直接插入，图片说明会提供给配图工作流。</p>
        </div>
        <div className="media-library__heading-actions">
          <button className="button button--primary" disabled={uploading} onClick={() => inputRef.current?.click()} type="button">
            <Upload aria-hidden="true" size={16} />
            {uploading ? "导入中" : "上传图片"}
          </button>
          <input
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
            className="visually-hidden"
            disabled={uploading}
            multiple
            onChange={(event) => void uploadFiles([...Array.from(event.target.files ?? [])])}
            ref={inputRef}
            type="file"
          />
        </div>
      </header>

      <section className="media-library__controls" aria-label="筛选图片素材">
        <label className="media-library__search">
          <Search aria-hidden="true" size={17} />
          <span className="visually-hidden">搜索图片、说明或标签</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索图片、说明或标签"
            type="search"
            value={query}
          />
        </label>
        <div className="media-library__filters" role="group" aria-label="图片来源筛选">
          {filters.map((item) => (
            <button
              aria-pressed={filter === item.id}
              className={filter === item.id ? "is-active" : ""}
              key={item.id}
              onClick={() => setFilter(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="media-library__sort">
          <ArrowDownAZ aria-hidden="true" size={16} />
          <span className="visually-hidden">图片排序</span>
          <select aria-label="图片排序" onChange={(event) => setSort(event.target.value as SortOrder)} value={sort}>
            <option value="recent">最近添加</option>
            <option value="name">名称</option>
            <option value="source">来源</option>
          </select>
          <ChevronDown aria-hidden="true" size={15} />
        </label>
      </section>

      {selected.size > 0 && (
        <section className="media-library__selection" aria-label="已选图片操作">
          <span><strong>已选 {selected.size}</strong> 张图片</span>
          <div>
            <button className="button button--quiet" disabled={!hasSelectedArticle} onClick={onInsertInArticle} type="button">
              <ImagePlus aria-hidden="true" size={16} />
              插入当前文章
            </button>
            <button className="button button--primary" onClick={onStartCreating} type="button">
              <WandSparkles aria-hidden="true" size={16} />
              带入创作
            </button>
            <button className="media-library__clear" onClick={clearSelection} type="button">取消选择</button>
          </div>
        </section>
      )}

      <div className="media-library__summary" aria-live="polite">
        <span>{visibleAssets.length} 张素材{query.trim() || filter !== "all" ? "符合当前筛选" : ""}</span>
        <span>拖拽素材到文章编辑器即可插入</span>
      </div>

      {uploadError && <p className="media-library__error" role="alert">{uploadError}</p>}

      <div className="media-library__grid" aria-label="图片素材" role="list">
        {visibleAssets.map((asset) => {
          const tags = asset.tags ?? [];
          const isSelected = selected.has(asset.id);
          return (
            <article
              aria-selected={isSelected}
              className={`media-library__card${isSelected ? " is-selected" : ""}`}
              draggable
              key={asset.id}
              onDragStart={(event) => startDrag(event, asset)}
              role="listitem"
            >
              <div className="media-library__image-frame">
                <button
                  aria-label={`查看${asset.name}`}
                  className="media-library__preview"
                  draggable={false}
                  onClick={() => openDetails(asset)}
                  type="button"
                >
                  <img alt={asset.alt || asset.name} loading="lazy" src={asset.src} />
                </button>
                <span className="media-library__source-badge">{asset.source === "generated" ? "AI 生成" : "本地上传"}</span>
                <button
                  aria-label={`选择${asset.name}`}
                  aria-pressed={isSelected}
                  className="media-library__select"
                  draggable={false}
                  onClick={() => toggle(asset.id)}
                  type="button"
                >
                  {isSelected ? <Check aria-hidden="true" size={17} /> : <span aria-hidden="true" />}
                </button>
                <button
                  aria-label={`查看${asset.name}的详细信息`}
                  className="media-library__info"
                  draggable={false}
                  onClick={() => openDetails(asset)}
                  title="查看详情"
                  type="button"
                >
                  <Info aria-hidden="true" size={16} />
                </button>
              </div>
              <div className="media-library__card-copy">
                <strong title={asset.name}>{asset.name}</strong>
                <p title={descriptionFor(asset)}>{descriptionFor(asset)}</p>
                <div className="media-library__card-footer">
                  <span>{asset.createdAt}</span>
                  {tags.length > 0 && (
                    <span className="media-library__tag-count"><Tag aria-hidden="true" size={12} />{tags.length}</span>
                  )}
                </div>
              </div>
            </article>
          );
        })}
        {visibleAssets.length === 0 && (
          <div className="media-library__empty">
            <span className="media-library__empty-icon"><Sparkles aria-hidden="true" size={22} /></span>
            <strong>{assets.length === 0 ? "还没有图片素材" : "没有符合条件的素材"}</strong>
            <p>{assets.length === 0 ? "上传图片，或在文章编辑器中生成配图。" : "试试调整关键词或筛选条件。"}</p>
            {assets.length === 0 && (
              <button className="button button--primary" onClick={() => inputRef.current?.click()} type="button">
                <Upload aria-hidden="true" size={16} />
                上传第一张图片
              </button>
            )}
          </div>
        )}
      </div>

      {dropActive && (
        <div className="media-library__drop-zone" aria-live="polite">
          <Upload aria-hidden="true" size={28} />
          <strong>松开以导入图片</strong>
          <span>支持 PNG、JPEG、WebP、GIF 和 AVIF</span>
        </div>
      )}

      {activeAsset && detailsDraft && (
        <div className="media-details" role="presentation">
          <button aria-label="关闭图片详情" className="media-details__scrim" onClick={() => setActiveAssetId(null)} type="button" />
          <aside aria-label={`${activeAsset.name}的详情`} aria-modal="true" className="media-details__drawer" role="dialog">
            <header>
              <div>
                <span className="page-kicker">素材详情</span>
                <h2>{activeAsset.name}</h2>
              </div>
              <button aria-label="关闭图片详情" className="media-details__close" onClick={() => setActiveAssetId(null)} type="button">
                <X aria-hidden="true" size={19} />
              </button>
            </header>
            <div className="media-details__body">
              <div className="media-details__image"><img alt={detailsDraft.alt || activeAsset.name} src={activeAsset.src} /></div>
              <dl className="media-details__meta">
                <div><dt>来源</dt><dd>{activeAsset.source === "generated" ? "AI 生成" : "本地上传"}</dd></div>
                <div><dt>添加时间</dt><dd>{activeAsset.createdAt}</dd></div>
              </dl>
              <label className="media-details__field">
                <span>替代文本</span>
                <input aria-label="替代文本" maxLength={160} onChange={(event) => setDetailsDraft({ ...detailsDraft, alt: event.target.value })} value={detailsDraft.alt} />
              </label>
              <label className="media-details__field">
                <span>图片内容描述</span>
                <textarea aria-label="图片内容描述" maxLength={600} onChange={(event) => setDetailsDraft({ ...detailsDraft, visualDescription: event.target.value })} placeholder="例如：三个模块通过事件总线传递任务状态。" rows={4} value={detailsDraft.visualDescription} />
                <small>描述图片客观呈现的内容，供模型匹配文章段落。</small>
              </label>
              <label className="media-details__field">
                <span>使用场景</span>
                <textarea aria-label="使用场景" maxLength={600} onChange={(event) => setDetailsDraft({ ...detailsDraft, usageHint: event.target.value })} placeholder="例如：放在介绍工作流节点关系的小节之后。" rows={3} value={detailsDraft.usageHint} />
              </label>
              <label className="media-details__field">
                <span>标签</span>
                <input aria-label="标签" maxLength={240} onChange={(event) => setDetailsDraft({ ...detailsDraft, tags: event.target.value })} placeholder="流程图, 架构, 教程" value={detailsDraft.tags} />
              </label>
              {activeAsset.generationPrompt && (
                <details className="media-details__prompt">
                  <summary>生图提示词</summary>
                  <p>{activeAsset.generationPrompt}</p>
                </details>
              )}
            </div>
            <footer>
              <button className="button button--quiet" onClick={() => toggle(activeAsset.id)} type="button">
                {selected.has(activeAsset.id) ? <Check aria-hidden="true" size={16} /> : <ImagePlus aria-hidden="true" size={16} />}
                {selected.has(activeAsset.id) ? "已选中" : "选择此图片"}
              </button>
              <button className="button button--primary" onClick={saveDetails} type="button">保存说明</button>
            </footer>
          </aside>
        </div>
      )}
    </section>
  );
}
