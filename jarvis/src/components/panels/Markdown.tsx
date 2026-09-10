"use client";

import React from "react";

// Lightweight, dependency-free markdown renderer for scraped content.
// Builds React nodes with a small tokenizer — no dangerouslySetInnerHTML —
// so scraped pages can never inject scripts into the panel.

// ─── Inline formatting (bold / italic / code / links) ────────────────

const INLINE_RE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s)]+)/g;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;
  let n = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyPrefix}-i${n++}`;
    if (tok.startsWith("`")) {
      nodes.push(
        <code key={k} className="px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 font-mono text-[0.92em]">
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("**")) {
      nodes.push(<strong key={k} className="text-white/90 font-semibold">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("*")) {
      nodes.push(<em key={k} className="text-white/80 italic">{tok.slice(1, -1)}</em>);
    } else if (tok.startsWith("[")) {
      const lm = tok.match(/\[([^\]]+)\]\(([^)\s]+)\)/);
      nodes.push(
        <a key={k} href={lm?.[2]} target="_blank" rel="noopener noreferrer"
           className="text-cyan-400 hover:text-cyan-300 underline decoration-cyan-500/40 underline-offset-2 break-all">
          {lm?.[1] || tok}
        </a>
      );
    } else {
      nodes.push(
        <a key={k} href={tok} target="_blank" rel="noopener noreferrer"
           className="text-cyan-400 hover:text-cyan-300 underline decoration-cyan-500/40 underline-offset-2 break-all">
          {tok.length > 60 ? tok.slice(0, 57) + "…" : tok}
        </a>
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// ─── Block-level parsing ─────────────────────────────────────────────

interface TableData {
  header: string[];
  rows: string[][];
}

function parseTable(lines: string[], start: number): { table: TableData; end: number } | null {
  // Needs: | a | b | then a |---|---| separator, then rows.
  if (start + 1 >= lines.length) return null;
  const splitRow = (l: string) =>
    l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  if (!/^\s*\|?[-:\s|]+\|?\s*$/.test(lines[start + 1]) || !lines[start + 1].includes("-")) return null;
  const header = splitRow(lines[start]);
  const rows: string[][] = [];
  let i = start + 2;
  while (i < lines.length && lines[i].includes("|") && lines[i].trim().startsWith("|")) {
    rows.push(splitRow(lines[i]));
    i++;
  }
  return { table: { header, rows }, end: i };
}

function MarkdownBlocks({ md }: { md: string }) {
  const lines = md.split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i++;
      }
      i++; // closing fence
      blocks.push(
        <div key={key++} className="my-2 rounded-xl bg-black/40 border border-white/10 overflow-hidden">
          {lang && (
            <div className="px-3 py-1 text-[9px] font-mono uppercase tracking-widest text-cyan-500/60 border-b border-white/5">
              {lang}
            </div>
          )}
          <pre className="p-3 overflow-auto text-[11px] leading-relaxed text-cyan-100/80 font-mono whitespace-pre">
            {buf.join("\n")}
          </pre>
        </div>
      );
      continue;
    }

    // Table
    if (line.trim().startsWith("|") && line.includes("|", 1)) {
      const parsed = parseTable(lines, i);
      if (parsed) {
        const { table, end } = parsed;
        blocks.push(
          <div key={key++} className="my-2 rounded-xl border border-white/10 overflow-auto max-w-full">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-white/5 border-b border-white/10">
                  {table.header.map((h, j) => (
                    <th key={j} className="px-3 py-2 text-left font-semibold text-cyan-300/90 whitespace-nowrap">
                      {renderInline(h, `th${key}-${j}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, r) => (
                  <tr key={r} className="border-b border-white/5 last:border-b-0 hover:bg-white/[0.03]">
                    {row.map((c, j) => (
                      <td key={j} className="px-3 py-1.5 text-white/70 align-top">
                        {renderInline(c, `td${key}-${r}-${j}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        i = end;
        continue;
      }
    }

    // Headings
    const hm = line.match(/^(#{1,6})\s+(.*)$/);
    if (hm) {
      const level = hm[1].length;
      const content = renderInline(hm[2], `h${key}`);
      const sizes = [
        "text-lg font-bold text-white",
        "text-base font-bold text-white/95",
        "text-sm font-semibold text-cyan-100",
        "text-sm font-semibold text-cyan-100/90",
        "text-xs font-semibold text-cyan-100/80",
        "text-xs font-semibold text-white/60",
      ];
      blocks.push(
        <div key={key++} className={`${sizes[level - 1]} mt-3 mb-1.5 ${level <= 2 ? "pb-1 border-b border-white/5" : ""}`}>
          {content}
        </div>
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="my-3 border-white/10" />);
      i++;
      continue;
    }

    // Blockquote
    if (line.trim().startsWith(">")) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote key={key++} className="my-2 pl-3 border-l-2 border-cyan-500/40 text-white/60 italic text-xs leading-relaxed">
          {renderInline(buf.join(" "), `q${key}`)}
        </blockquote>
      );
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++} className="my-1.5 space-y-1">
          {items.map((it, j) => (
            <li key={j} className="flex gap-2 text-xs text-white/75 leading-relaxed">
              <span className="text-cyan-500/60 mt-0.5 shrink-0">▸</span>
              <span>{renderInline(it, `ul${key}-${j}`)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={key++} className="my-1.5 space-y-1">
          {items.map((it, j) => (
            <li key={j} className="flex gap-2 text-xs text-white/75 leading-relaxed">
              <span className="text-cyan-400/70 font-mono text-[10px] mt-0.5 shrink-0">{j + 1}.</span>
              <span>{renderInline(it, `ol${key}-${j}`)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Paragraph (consume consecutive non-special lines)
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith("```") &&
      !lines[i].trim().startsWith("|") &&
      !lines[i].trim().startsWith(">") &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    if (buf.length > 0) {
      blocks.push(
        <p key={key++} className="my-1.5 text-xs text-white/75 leading-relaxed">
          {renderInline(buf.join(" "), `p${key}`)}
        </p>
      );
    }
  }

  return <div className="markdown-blocks">{blocks}</div>;
}

export default function Markdown({ content, className = "" }: { content: string; className?: string }) {
  if (!content?.trim()) {
    return <p className="text-xs text-white/30 italic">No readable content.</p>;
  }
  return (
    <div className={className}>
      <MarkdownBlocks md={content} />
    </div>
  );
}
