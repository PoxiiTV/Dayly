import type { ReactNode } from "react";
import clsx from "clsx";

/**
 * Small XSS-safe Markdown preview: headings, emphasis, lists, quotes, code and http(s) links.
 * Anything else is rendered as escaped text.
 */
export function MarkdownPreview({ source }: { source: string }) {
  const text = source.replace(/\r\n/g, "\n");
  if (!text.trim()) {
    return <p className="text-sm text-muted">Nada que previsualizar todavía.</p>;
  }
  const blocks = splitBlocks(text);
  return (
    <div className="text-sm leading-relaxed text-text space-y-3 break-words">
      {blocks.map((block, i) => <Block key={i} block={block} />)}
    </div>
  );
}

type Block =
  | { type: "h"; level: 1 | 2 | 3; text: string }
  | { type: "quote"; text: string }
  | { type: "code"; text: string }
  | { type: "tasklist"; items: { done: boolean; text: string }[] }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "p"; text: string };

function splitBlocks(src: string): Block[] {
  const lines = src.split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      out.push({ type: "code", text: body.join("\n") });
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      out.push({ type: "h", level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      i += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      out.push({ type: "quote", text: body.join(" ") });
      continue;
    }
    if (/^\s*[-*+]\s+\[[ xX]\]/.test(line)) {
      const items: { done: boolean; text: string }[] = [];
      while (i < lines.length && /^\s*[-*+]\s+\[[ xX]\]/.test(lines[i])) {
        const m = /^\s*[-*+]\s+\[([ xX])\]\s?(.*)$/.exec(lines[i]);
        if (!m) break;
        items.push({ done: m[1] !== " ", text: m[2] });
        i += 1;
      }
      out.push({ type: "tasklist", items });
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i]) && !/^\s*[-*+]\s+\[[ xX]\]/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i += 1;
      }
      out.push({ type: "ul", items });
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      out.push({ type: "ol", items });
      continue;
    }
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|```|>\s?|\s*[-*+]\s+|\s*\d+\.\s+)/.test(lines[i])) {
      body.push(lines[i]);
      i += 1;
    }
    out.push({ type: "p", text: body.join(" ") });
  }
  return out;
}

function Block({ block }: { block: Block }) {
  if (block.type === "h") {
    const cls = block.level === 1 ? "text-lg font-bold" : block.level === 2 ? "text-base font-semibold" : "text-sm font-semibold";
    return <p className={cls}>{inline(block.text)}</p>;
  }
  if (block.type === "quote") {
    return <blockquote className="border-l-2 border-accent/40 pl-3 text-muted italic">{inline(block.text)}</blockquote>;
  }
  if (block.type === "code") {
    return <pre className="rounded-lg bg-bg border border-border p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap">{block.text}</pre>;
  }
  if (block.type === "tasklist") {
    return (
      <ul className="space-y-1.5">
        {block.items.map((item, i) => (
          <li key={i} className={clsx("flex items-start gap-2", item.done && "text-muted")}>
            <span className={clsx("mt-0.5 w-4 h-4 rounded border grid place-items-center shrink-0", item.done ? "bg-ok/20 border-ok" : "border-border")}>
              {item.done ? "✓" : ""}
            </span>
            <span className={item.done ? "line-through" : undefined}>{inline(item.text)}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (block.type === "ul") {
    return <ul className="list-disc pl-5 space-y-1">{block.items.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>;
  }
  if (block.type === "ol") {
    return <ol className="list-decimal pl-5 space-y-1">{block.items.map((item, i) => <li key={i}>{inline(item)}</li>)}</ol>;
  }
  if (block.type === "p") {
    return <p>{inline(block.text)}</p>;
  }
  const _never: never = block;
  return _never;
}

function inline(src: string): ReactNode[] {
  const tokens = tokenize(src);
  return tokens.map((t, i) => {
    if (t.type === "code") return <code key={i} className="px-1 py-0.5 rounded bg-bg border border-border font-mono text-[0.85em]">{t.value}</code>;
    if (t.type === "strong") return <strong key={i}>{t.value}</strong>;
    if (t.type === "em") return <em key={i}>{t.value}</em>;
    if (t.type === "link") {
      return (
        <a key={i} href={t.href} target="_blank" rel="noopener noreferrer" className="text-accent-strong underline">
          {t.value}
        </a>
      );
    }
    return <span key={i}>{t.value}</span>;
  });
}

type InlineTok =
  | { type: "text" | "code" | "strong" | "em"; value: string }
  | { type: "link"; value: string; href: string };

function tokenize(src: string): InlineTok[] {
  const out: InlineTok[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push({ type: "text", value: src.slice(last, m.index) });
    const raw = m[0];
    if (raw.startsWith("`")) out.push({ type: "code", value: raw.slice(1, -1) });
    else if (raw.startsWith("**") || raw.startsWith("__")) out.push({ type: "strong", value: raw.slice(2, -2) });
    else if (raw.startsWith("*") || raw.startsWith("_")) out.push({ type: "em", value: raw.slice(1, -1) });
    else {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(raw);
      if (link && isSafeUrl(link[2])) out.push({ type: "link", value: link[1], href: link[2] });
      else out.push({ type: "text", value: raw });
    }
    last = m.index + raw.length;
  }
  if (last < src.length) out.push({ type: "text", value: src.slice(last) });
  return out;
}

function isSafeUrl(href: string): boolean {
  try {
    const u = new URL(href);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
