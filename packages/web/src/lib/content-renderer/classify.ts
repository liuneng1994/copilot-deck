import type { ContentItem } from "./types";

/**
 * Minimal v1 classifier.
 *
 * Walks the message text token-by-token using a single regex-based fenced-block
 * scanner. Full mdast traversal is overkill for the skeleton — later commits
 * (rr-inline / rr-tools) will plug into this same surface to add markdown-table,
 * math, link-card detection, etc.
 *
 * Each returned item carries a stable id keyed on (source offset, kind) so the
 * artifact store can dedupe across the React re-renders that happen while a
 * message streams.
 */

const FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^\n`~]*)\n([\s\S]*?)^[ \t]{0,3}\1[ \t]*$/gm;

interface FenceMatch {
  offset: number;
  lang: string;
  body: string;
}

function* scanFences(text: string): Generator<FenceMatch> {
  FENCE_RE.lastIndex = 0;
  let m: RegExpExecArray | null = FENCE_RE.exec(text);
  while (m !== null) {
    const offset = m.index;
    const lang = (m[2] || "").trim().toLowerCase();
    const body = m[3] ?? "";
    yield { offset, lang, body };
    m = FENCE_RE.exec(text);
  }
}

function lineCount(s: string): number {
  if (!s) return 0;
  let n = 1;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

function idFor(kind: string, offset: number): string {
  return `${kind}-${offset}`;
}

function parseJsonSafe(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function parseDsv(body: string, sep: string): { header: string[]; rows: string[][] } | null {
  const lines = body.replace(/\s+$/g, "").split(/\r?\n/);
  if (lines.length < 1) return null;
  const split = (line: string): string[] => line.split(sep).map((c) => c.trim());
  const header = split(lines[0] ?? "");
  if (header.length < 2) return null;
  const rows = lines.slice(1).map(split);
  return { header, rows };
}

/**
 * Produce a flat list of items for a chunk of agent-generated text.
 *
 * v1 only emits items for fenced code blocks of known kinds (mermaid, html,
 * svg, json, csv) and a single trailing "text" item carrying the remainder.
 * The markdown-table walker, math, and shell detection arrive in rr-inline.
 */
export function classify(text: string): ContentItem[] {
  if (!text) return [];
  const items: ContentItem[] = [];
  let cursor = 0;

  for (const f of scanFences(text)) {
    if (f.offset > cursor) {
      const chunk = text.slice(cursor, f.offset);
      if (chunk.trim()) items.push({ kind: "text", id: idFor("text", cursor), text: chunk });
    }
    const id = idFor(f.lang || "code", f.offset);
    const body = f.body.replace(/\n$/, "");

    if (f.lang === "mermaid") {
      items.push({ kind: "mermaid", id, src: body });
    } else if (f.lang === "html") {
      items.push({ kind: "html", id, src: body });
    } else if (f.lang === "svg") {
      items.push({ kind: "svg", id, src: body });
    } else if (f.lang === "json" || f.lang === "jsonc") {
      const value = parseJsonSafe(body);
      items.push({ kind: "json", id, raw: body, value, lines: lineCount(body) });
    } else if (f.lang === "csv") {
      const parsed = parseDsv(body, ",");
      if (parsed && parsed.rows.length > 0) {
        items.push({ kind: "csv", id, header: parsed.header, rows: parsed.rows });
      } else {
        items.push({ kind: "code", id, lang: f.lang, text: body, lines: lineCount(body) });
      }
    } else if (f.lang === "tsv") {
      const parsed = parseDsv(body, "\t");
      if (parsed && parsed.rows.length > 0) {
        items.push({ kind: "csv", id, header: parsed.header, rows: parsed.rows });
      } else {
        items.push({ kind: "code", id, lang: f.lang, text: body, lines: lineCount(body) });
      }
    } else {
      items.push({
        kind: "code",
        id,
        lang: f.lang || undefined,
        text: body,
        lines: lineCount(body),
      });
    }
    const end = FENCE_RE.lastIndex;
    cursor = end;
  }

  if (cursor < text.length) {
    const chunk = text.slice(cursor);
    if (chunk.trim()) items.push({ kind: "text", id: idFor("text", cursor), text: chunk });
  }

  return items;
}
