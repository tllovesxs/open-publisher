import {
  BookOpenText,
  CircleAlert,
  ExternalLink,
  LoaderCircle,
  Megaphone,
  Pin,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { externalLinkClickHandler } from "../lib/externalLinks";
import { MarkdownPreview } from "./MarkdownPreview";

type NoticeKind = "announcement" | "tutorial";
type SourceState = "embedded" | "loading" | "remote" | "fallback";
type BodyState = "idle" | "loading" | "ready" | "error";

interface NoticeItem {
  id: string;
  type: NoticeKind;
  pinned: boolean;
  title: string;
  summary: string;
  date: string;
  badge: string;
  tags: string[];
  path: string;
  body?: string;
}

interface NoticeManifest {
  version: number;
  updatedAt: string;
  repository: string;
  items: NoticeItem[];
}

const REPOSITORY_URL = "https://github.com/tllovesxs/open-publisher";
const RAW_BASE_URL = "https://raw.githubusercontent.com/tllovesxs/open-publisher/main/";
const MANIFEST_URL = `${RAW_BASE_URL}docs/announcements.json`;
const PUBLISHING_GUIDE_PATH = "docs/integrations/wechatsync-publishing-guide.md";
const MAX_NOTICE_BODY_LENGTH = 80_000;

const embeddedManifest: NoticeManifest = {
  version: 1,
  updatedAt: "2026-08-07",
  repository: REPOSITORY_URL,
  items: [
    {
      id: "wechatsync-publishing-guide",
      type: "tutorial",
      pinned: false,
      title: "如何添加文章同步发布功能",
      summary: "安装文章同步助手、复制 Token，并把稿流连接到浏览器中的已登录平台。",
      date: "2026-08-07",
      badge: "发布教程",
      tags: ["发布", "WechatSync", "Token"],
      path: PUBLISHING_GUIDE_PATH,
      body: `# 稿流发布使用教程

使用文章同步助手连接稿流后，可以把文章同步到微信公众号、知乎、CSDN 等平台的草稿箱。

## 1. 下载插件

打开[文章同步助手官网](https://www.wechatsync.com/?utm_source=extension_about)，下载并安装浏览器插件。

## 2. 打开插件设置

安装完成后，点击浏览器工具栏里的「文章同步助手」，再点击右上角的「设置」。

![点击文章同步助手右上角的设置](./images/wechatsync-open-settings.png)

## 3. 复制连接信息

在设置中找到「同步桥接」：

1. 打开「CLI / MCP 连接」开关。
2. 复制下方显示的 \`Token\`。
3. 服务器地址保持为 \`ws://localhost:9527\`。

![打开 CLI MCP 连接并复制 Token](./images/wechatsync-cli-mcp-settings.png)

> 截图中的 Token 已隐藏，请复制自己插件中显示的 Token。

## 4. 填入稿流

打开稿流，进入「设置 → 平台账号 → 发布连接」，填写：

- 服务器地址：\`ws://localhost:9527\`
- Token：刚才从插件中复制的 Token

点击「保存并测试」。显示「已连接」后，再点击「刷新状态」，稿流就会显示浏览器中已经登录的平台。

## 5. 同步文章

1. 在稿流的「文章」页面选择文章，点击「发布」。
2. 勾选需要同步的平台。
3. 点击「同步到草稿」。
4. 打开对应平台的草稿箱，检查内容后手动完成最终发布。

如果一直显示「等待插件」，请确认插件中的「CLI / MCP 连接」开关已经打开，然后重新打开插件并在稿流中刷新状态。`,
    },
  ],
};

function safeText(value: unknown, limit: number, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").trim().slice(0, limit) || fallback;
}

function isRepositoryNoticePath(path: string) {
  return path === PUBLISHING_GUIDE_PATH;
}

function rawDocumentUrl(path: string) {
  if (!isRepositoryNoticePath(path)) return null;
  return `${RAW_BASE_URL}${path.split("/").map(encodeURIComponent).join("/")}`;
}

function githubDocumentUrl(path: string) {
  if (!isRepositoryNoticePath(path)) return REPOSITORY_URL;
  return `${REPOSITORY_URL}/blob/main/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function normalizeManifest(value: unknown): NoticeManifest | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<NoticeManifest>;
  if (!Array.isArray(candidate.items)) return null;
  const items = candidate.items
    .map((raw, index): NoticeItem | null => {
      if (!raw || typeof raw !== "object") return null;
      const item = raw as Partial<NoticeItem>;
      const path = safeText(item.path, 220);
      const id = safeText(item.id, 80, `notice-${index + 1}`);
      const title = safeText(item.title, 180, "未命名公告");
      if (!isRepositoryNoticePath(path)) return null;
      return {
        id,
        type: item.type === "tutorial" ? "tutorial" : "announcement",
        pinned: item.pinned === true,
        title,
        summary: safeText(item.summary, 500),
        date: safeText(item.date, 32, safeText(candidate.updatedAt, 32)),
        badge: safeText(item.badge, 48),
        tags: Array.isArray(item.tags)
          ? item.tags.map((tag) => safeText(tag, 48)).filter(Boolean).slice(0, 8)
          : [],
        path,
      };
    })
    .filter((item): item is NoticeItem => Boolean(item))
    .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index)
    .sort((left, right) => {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return right.date.localeCompare(left.date) || left.title.localeCompare(right.title, "zh-Hans-CN");
    });
  if (items.length === 0) return null;
  return {
    version: typeof candidate.version === "number" ? candidate.version : 1,
    updatedAt: safeText(candidate.updatedAt, 32, embeddedManifest.updatedAt),
    repository: safeText(candidate.repository, 320, REPOSITORY_URL),
    items,
  };
}

function cacheEmbeddedBodies() {
  return Object.fromEntries(
    embeddedManifest.items
      .filter((item) => item.body)
      .map((item) => [item.id, item.body as string]),
  );
}

function kindLabel(item: NoticeItem) {
  if (item.pinned) return "置顶公告";
  return item.type === "tutorial" ? "教程" : item.badge || "公告";
}

function sourceLabel(source: SourceState) {
  if (source === "loading") return "正在同步教程";
  if (source === "remote") return "已从 GitHub 同步";
  if (source === "fallback") return "使用内置教程";
  return "内置教程";
}

export function AnnouncementsPage() {
  const [manifest, setManifest] = useState<NoticeManifest>(embeddedManifest);
  const [sourceState, setSourceState] = useState<SourceState>("embedded");
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState(embeddedManifest.items[0]!.id);
  const [body, setBody] = useState(embeddedManifest.items[0]!.body ?? "");
  const [bodyState, setBodyState] = useState<BodyState>("ready");
  const [bodyError, setBodyError] = useState<string | null>(null);
  const manifestRequestId = useRef(0);
  const bodyRequestId = useRef(0);
  const bodyCache = useRef<Record<string, string>>(cacheEmbeddedBodies());
  const mounted = useRef(true);

  const items = manifest.items;
  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? items[0] ?? null,
    [items, selectedId],
  );


  const refreshManifest = useCallback(async () => {
    const requestId = ++manifestRequestId.current;
    setSourceState("loading");
    setSourceError(null);
    try {
      const response = await fetch(MANIFEST_URL, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`仓库返回 HTTP ${response.status}`);
      const normalized = normalizeManifest(await response.json());
      if (!normalized) {
        if (!mounted.current || manifestRequestId.current !== requestId) return;
        bodyCache.current = cacheEmbeddedBodies();
        setManifest(embeddedManifest);
        setSourceState("embedded");
        setSelectedId(embeddedManifest.items[0]!.id);
        return;
      }
      if (!mounted.current || manifestRequestId.current !== requestId) return;
      bodyCache.current = {};
      setManifest(normalized);
      setSourceState("remote");
      setSelectedId((current) => normalized.items.some((item) => item.id === current)
        ? current
        : normalized.items[0]!.id);
    } catch (error) {
      if (!mounted.current || manifestRequestId.current !== requestId) return;
      bodyCache.current = cacheEmbeddedBodies();
      setManifest(embeddedManifest);
      setSourceState("fallback");
      setSourceError(error instanceof Error ? error.message.slice(0, 160) : "无法连接到公告仓库");
      setSelectedId((current) => embeddedManifest.items.some((item) => item.id === current)
        ? current
        : embeddedManifest.items[0]!.id);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refreshManifest();
    return () => {
      mounted.current = false;
      manifestRequestId.current += 1;
      bodyRequestId.current += 1;
    };
  }, [refreshManifest]);

  useEffect(() => {
    if (!selected) return;
    const cached = bodyCache.current[selected.id];
    if (cached !== undefined) {
      setBody(cached);
      setBodyState("ready");
      setBodyError(null);
      return;
    }
    const url = rawDocumentUrl(selected.path);
    if (!url) {
      setBody("");
      setBodyState("error");
      setBodyError("公告正文路径不受支持。");
      return;
    }
    const requestId = ++bodyRequestId.current;
    setBody("");
    setBodyState("loading");
    setBodyError(null);
    void fetch(url, { headers: { Accept: "text/markdown, text/plain" } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`仓库返回 HTTP ${response.status}`);
        return response.text();
      })
      .then((content) => {
        if (!mounted.current || bodyRequestId.current !== requestId) return;
        const normalized = content.replace(/\r\n?/g, "\n").slice(0, MAX_NOTICE_BODY_LENGTH);
        if (!normalized.trim()) throw new Error("公告正文为空");
        bodyCache.current[selected.id] = normalized;
        setBody(normalized);
        setBodyState("ready");
      })
      .catch((error: unknown) => {
        if (!mounted.current || bodyRequestId.current !== requestId) return;
        setBody("");
        setBodyState("error");
        setBodyError(error instanceof Error ? error.message.slice(0, 160) : "公告正文无法读取");
      });
  }, [selected]);

  return (
    <section className="page page--announcements">
      <header className="page-heading page-heading--announcements">
        <div>
          <span className="page-kicker">发布连接</span>
          <h1>发布教程</h1>
          <p>按照教程连接浏览器中的文章同步助手，读取已登录的发布平台。</p>
        </div>
        <div className="announcement-page-actions">
          <span aria-live="polite" className={`announcement-source is-${sourceState}`}>
            {sourceState === "loading" ? <LoaderCircle aria-hidden="true" className="spin" size={14} /> : <Megaphone aria-hidden="true" size={14} />}
            {sourceLabel(sourceState)}
          </span>
          <button className="button button--quiet" disabled={sourceState === "loading"} onClick={() => void refreshManifest()} type="button">
            <RefreshCw aria-hidden="true" className={sourceState === "loading" ? "spin" : undefined} size={16} />
            刷新教程
          </button>
        </div>
      </header>

      <div className="announcement-layout">
        <aside aria-label="公告列表" className="announcement-list">
          <NoticeSection items={items} label="教程" onSelect={setSelectedId} selectedId={selected?.id ?? ""} />
        </aside>

        <article aria-busy={bodyState === "loading"} className="announcement-document">
          {selected ? (
            <>
              <header className="announcement-document__header">
                <div>
                  <span className={`announcement-badge${selected.pinned ? " is-pinned" : ""}`}>
                    {selected.pinned && <Pin aria-hidden="true" size={12} />}
                    {kindLabel(selected)}
                  </span>
                  <h2>{selected.title}</h2>
                  <p>{selected.date}{selected.summary ? ` · ${selected.summary}` : ""}</p>
                  {selected.tags.length > 0 && (
                    <div aria-label="公告标签" className="announcement-tags">
                      {selected.tags.map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                  )}
                </div>
                <a
                  className="text-button"
                  href={githubDocumentUrl(selected.path)}
                  onClick={externalLinkClickHandler(githubDocumentUrl(selected.path))}
                  rel="noreferrer"
                  target="_blank"
                >
                  在 GitHub 查看 <ExternalLink aria-hidden="true" size={14} />
                </a>
              </header>

              <div className="announcement-document__body">
                {bodyState === "loading" && (
                  <div className="announcement-document__loading" role="status">
                    <LoaderCircle aria-hidden="true" className="spin" size={20} />
                    正在读取公告正文
                  </div>
                )}
                {bodyState === "ready" && (
                  <MarkdownPreview imageBaseUrl={rawDocumentUrl(selected.path) ?? undefined} markdown={body} />
                )}
                {bodyState === "error" && (
                  <div className="announcement-document__error" role="alert">
                    <CircleAlert aria-hidden="true" size={20} />
                    <div><strong>公告正文暂时无法读取</strong><span>{bodyError ?? "请稍后刷新，或在 GitHub 查看原文。"}</span></div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="announcement-document__empty">
              <BookOpenText aria-hidden="true" size={24} />
              <strong>暂无公告</strong>
              <span>刷新后会从项目仓库重新读取公告索引。</span>
            </div>
          )}
        </article>
      </div>
      {sourceError && <p className="announcement-sync-note" role="status">本次同步未完成：{sourceError}</p>}
    </section>
  );
}

function NoticeSection({
  items,
  label,
  selectedId,
  onSelect,
}: {
  items: NoticeItem[];
  label: string;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="announcement-list__section">
      <h2>{label}</h2>
      {items.length === 0 ? <p className="announcement-list__empty">暂无{label}</p> : items.map((item) => {
        const selected = item.id === selectedId;
        return (
          <button
            aria-pressed={selected}
            className={`announcement-list__item${selected ? " is-active" : ""}${item.pinned ? " is-pinned" : ""}`}
            key={item.id}
            onClick={() => onSelect(item.id)}
            type="button"
          >
            <span className="announcement-list__meta"><strong>{kindLabel(item)}</strong><time>{item.date}</time></span>
            <span className="announcement-list__title">{item.title}</span>
            {item.summary && <span className="announcement-list__summary">{item.summary}</span>}
          </button>
        );
      })}
    </section>
  );
}
