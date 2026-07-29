import { Fragment, type ReactNode } from "react";

interface MarkdownPreviewProps {
  markdown: string;
  compact?: boolean;
}

function inlineMarkup(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
    }
    return <Fragment key={`${part}-${index}`}>{part}</Fragment>;
  });
}

export function MarkdownPreview({ markdown, compact = false }: MarkdownPreviewProps) {
  const lines = markdown.split("\n");
  const output: ReactNode[] = [];
  let unordered: string[] = [];
  let ordered: string[] = [];
  let inCode = false;
  let codeLines: string[] = [];

  const flushLists = () => {
    if (unordered.length) {
      output.push(
        <ul key={`ul-${output.length}`}>
          {unordered.map((item, index) => (
            <li key={`${item}-${index}`}>{inlineMarkup(item)}</li>
          ))}
        </ul>,
      );
      unordered = [];
    }
    if (ordered.length) {
      output.push(
        <ol key={`ol-${output.length}`}>
          {ordered.map((item, index) => (
            <li key={`${item}-${index}`}>{inlineMarkup(item)}</li>
          ))}
        </ol>,
      );
      ordered = [];
    }
  };

  lines.forEach((line, lineIndex) => {
    if (line.trim().startsWith("```")) {
      flushLists();
      if (inCode) {
        output.push(
          <pre key={`code-${lineIndex}`}>
            <code>{codeLines.join("\n")}</code>
          </pre>,
        );
        codeLines = [];
      }
      inCode = !inCode;
      return;
    }

    if (inCode) {
      codeLines.push(line);
      return;
    }

    const bullet = line.match(/^\s*[-*]\s+(.+)/);
    if (bullet) {
      ordered = [];
      unordered.push(bullet[1]);
      return;
    }

    const numbered = line.match(/^\s*\d+\.\s+(.+)/);
    if (numbered) {
      unordered = [];
      ordered.push(numbered[1]);
      return;
    }

    flushLists();
    if (!line.trim()) return;

    if (line.startsWith("### ")) {
      output.push(<h3 key={lineIndex}>{inlineMarkup(line.slice(4))}</h3>);
    } else if (line.startsWith("## ")) {
      output.push(<h2 key={lineIndex}>{inlineMarkup(line.slice(3))}</h2>);
    } else if (line.startsWith("# ")) {
      output.push(<h1 key={lineIndex}>{inlineMarkup(line.slice(2))}</h1>);
    } else if (line.startsWith("> ")) {
      output.push(<blockquote key={lineIndex}>{inlineMarkup(line.slice(2))}</blockquote>);
    } else {
      output.push(<p key={lineIndex}>{inlineMarkup(line)}</p>);
    }
  });

  flushLists();
  if (inCode && codeLines.length) {
    output.push(
      <pre key="code-unclosed">
        <code>{codeLines.join("\n")}</code>
      </pre>,
    );
  }

  return (
    <article className={`markdown-preview${compact ? " markdown-preview--compact" : ""}`}>
      {output}
    </article>
  );
}
