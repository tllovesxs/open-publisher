import {
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import ReactMarkdown, {
  type Components,
  type Options as ReactMarkdownOptions,
  type UrlTransform,
} from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { resolveMarkdownImageSource } from "../lib/mediaReferences";
import type { MediaAsset } from "../types";

interface MarkdownPreviewProps {
  markdown: string;
  compact?: boolean;
  imageBaseUrl?: string;
  mediaAssets?: readonly Pick<MediaAsset, "id" | "src">[];
}

interface MermaidRenderResult {
  svg: string;
  bindFunctions?: (element: Element) => void;
}

type MermaidState =
  | { status: "loading" }
  | { status: "ready"; svg: string }
  | { status: "error"; message: string };

const markdownSanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    // Local article media is resolved by the img component below. Data URLs
    // are accepted here only so that the same resolver can validate them.
    src: [...(defaultSchema.protocols?.src ?? []), "asset", "data"],
  },
};

const markdownRehypePlugins: NonNullable<ReactMarkdownOptions["rehypePlugins"]> = [
  rehypeRaw,
  [rehypeSanitize, markdownSanitizeSchema],
];
const markdownRemarkPlugins: NonNullable<ReactMarkdownOptions["remarkPlugins"]> = [remarkGfm];

let mermaidRenderQueue: Promise<void> = Promise.resolve();

async function renderMermaid(
  id: string,
  source: string,
  darkMode: boolean,
): Promise<MermaidRenderResult> {
  let result: MermaidRenderResult | undefined;
  const task = mermaidRenderQueue.then(async () => {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: darkMode ? "dark" : "neutral",
      flowchart: { htmlLabels: false },
    });
    result = await mermaid.render(id, source);
  });
  mermaidRenderQueue = task.then(() => undefined, () => undefined);
  await task;
  if (!result) throw new Error("Mermaid did not return a diagram");
  return result;
}

function mermaidTitle(source: string): string {
  return source.match(/^\s*accTitle:\s*(.+)$/m)?.[1]?.trim() || "文章图表";
}

function MermaidDiagram({ source }: { source: string }) {
  const reactId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<MermaidState>({ status: "loading" });
  const title = mermaidTitle(source);
  const darkMode = typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";
  const diagramId = useMemo(() => `markdown-mermaid-${reactId.replace(/[^a-z0-9_-]/gi, "")}`, [reactId]);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    void renderMermaid(diagramId, source, darkMode)
      .then(({ svg, bindFunctions }) => {
        if (!active) return;
        setState({ status: "ready", svg });
        window.requestAnimationFrame(() => {
          if (active && containerRef.current) bindFunctions?.(containerRef.current);
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : "图表语法无法解析",
        });
      });
    return () => {
      active = false;
    };
  }, [darkMode, diagramId, source]);

  if (state.status === "loading") {
    return <div className="markdown-mermaid markdown-mermaid--loading" role="status">正在绘制图表</div>;
  }
  if (state.status === "error") {
    return (
      <div className="markdown-mermaid markdown-mermaid--error" role="alert">
        <strong>图表无法渲染</strong>
        <span>{state.message}</span>
        <details>
          <summary>查看 Mermaid 源码</summary>
          <pre><code>{source}</code></pre>
        </details>
      </div>
    );
  }
  return (
    <figure aria-label={title} className="markdown-mermaid" ref={containerRef} role="img">
      <div dangerouslySetInnerHTML={{ __html: state.svg }} />
      <figcaption>{title}</figcaption>
    </figure>
  );
}

function safeExternalUrl(value: string, baseUrl?: string): string | null {
  if (value.startsWith("#")) return value;
  try {
    const url = baseUrl ? new URL(value, baseUrl) : new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function resolvedImageSource(
  source: string,
  mediaAssets: readonly Pick<MediaAsset, "id" | "src">[],
  imageBaseUrl?: string,
): string | null {
  let reference = source;
  if (imageBaseUrl && !source.startsWith("asset://") && !source.startsWith("data:")) {
    try {
      reference = new URL(source, imageBaseUrl).href;
    } catch {
      return null;
    }
  }
  return resolveMarkdownImageSource(reference, mediaAssets);
}

function mermaidSource(children: ReactNode): string | null {
  const child = Array.isArray(children) ? children[0] : children;
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) return null;
  if (!child.props.className?.split(/\s+/).includes("language-mermaid")) return null;
  return String(child.props.children ?? "").replace(/\n$/, "").trim();
}

type MarkdownAnchorProps = ComponentPropsWithoutRef<"a"> & { node?: unknown };
type MarkdownImageProps = ComponentPropsWithoutRef<"img"> & { node?: unknown };
type MarkdownInputProps = ComponentPropsWithoutRef<"input"> & { node?: unknown };
type MarkdownPreProps = ComponentPropsWithoutRef<"pre"> & { node?: unknown };

export function MarkdownPreview({
  markdown,
  compact = false,
  imageBaseUrl,
  mediaAssets = [],
}: MarkdownPreviewProps) {
  const urlTransform = useMemo<UrlTransform>(() => (url, key, node) => {
    if (key === "src" && node.tagName === "img") return url;
    if (key === "href" && node.tagName === "a") return safeExternalUrl(url, imageBaseUrl);
    return null;
  }, [imageBaseUrl]);

  const components = useMemo<Components>(() => ({
    a({ children, href, node: _node, ...props }: MarkdownAnchorProps) {
      const safeHref = typeof href === "string" ? safeExternalUrl(href, imageBaseUrl) : null;
      if (!safeHref) return <>{children}</>;
      const internal = safeHref.startsWith("#");
      return (
        <a
          {...props}
          href={safeHref}
          rel={internal ? undefined : "noreferrer"}
          target={internal ? undefined : "_blank"}
        >
          {children}
        </a>
      );
    },
    img({ alt, node: _node, src, ...props }: MarkdownImageProps) {
      const resolved = typeof src === "string"
        ? resolvedImageSource(src, mediaAssets, imageBaseUrl)
        : null;
      if (!resolved) return null;
      return <img {...props} alt={alt ?? ""} loading="lazy" src={resolved} />;
    },
    input({ node: _node, ...props }: MarkdownInputProps) {
      return <input {...props} disabled />;
    },
    pre({ children, node: _node, ...props }: MarkdownPreProps) {
      const source = mermaidSource(children);
      return source ? <MermaidDiagram source={source} /> : <pre {...props}>{children}</pre>;
    },
  }), [imageBaseUrl, mediaAssets]);

  return (
    <article className={`markdown-preview${compact ? " markdown-preview--compact" : ""}`}>
      <ReactMarkdown
        components={components}
        rehypePlugins={markdownRehypePlugins}
        remarkPlugins={markdownRemarkPlugins}
        remarkRehypeOptions={{ footnoteLabel: "脚注" }}
        urlTransform={urlTransform}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
