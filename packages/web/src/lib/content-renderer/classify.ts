import type { ContentItem } from "./types";

/**
 * Three-pass classifier.
 *
 * (1) Fenced code blocks build safe ranges and contribute specialised items
 *     (mermaid / html / svg / json / csv / tsv / code).
 * (2) GFM tables and (3) `$$…$$` math blocks are detected only in regions
 *     outside any fence so we don't false-positive on examples.
 * (4) Gaps fill in as `text` items.
 *
 * Each item carries a stable id keyed on (source offset, kind) so the artifact
 * store can dedupe across the React re-renders that happen while streaming.
 */

const FENCE_RE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^\n`~]*)\n([\s\S]*?)^[ \t]{0,3}\1[ \t]*$/gm;

/**
 * GFM table: a header row, an alignment row (with at least one `---`),
 * and zero or more body rows. Both pipe-leading and pipe-trailing tables
 * are accepted; the renderer trims them.
 */
const TABLE_RE =
  /(^|\n)([ \t]{0,3}\|[^\n]+\|[ \t]*\n[ \t]{0,3}\|?[ \t]*:?-{2,}[-: |]*\|?[ \t]*(?:\n[ \t]{0,3}\|?[^\n]*\|?[ \t]*)+)/g;

const MATH_BLOCK_RE = /\$\$([\s\S]+?)\$\$/g;

interface FenceMatch {
  offset: number;
  lang: string;
  body: string;
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

function parseMdTable(block: string): { header: string[]; rows: string[][] } | null {
  const lines = block.replace(/^\n+|\n+$/g, "").split(/\n/);
  if (lines.length < 2) return null;
  const split = (line: string): string[] => {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    return s.split("|").map((c) => c.trim());
  };
  const header = split(lines[0] ?? "");
  const sep = (lines[1] ?? "").trim();
  if (!/^\|?[ \t]*:?-{2,}[-: |]*\|?$/.test(sep)) return null;
  const rows = lines
    .slice(2)
    .map(split)
    .filter((r) => r.some((c) => c.length > 0));
  return { header, rows };
}

interface FencedRange {
  start: number;
  end: number;
}

/** True when `offset` lies inside any range — used to skip detection inside fenced code. */
function inAnyRange(ranges: FencedRange[], offset: number): boolean {
  for (const r of ranges) if (offset >= r.start && offset < r.end) return true;
  return false;
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

interface RawSpan {
  start: number;
  end: number;
  build: (text: string) => ContentItem | null;
}

function fenceSpan(_text: string, f: FenceMatch, end: number): RawSpan {
  const id = idFor(f.lang || "code", f.offset);
  const body = f.body.replace(/\n$/, "");
  return {
    start: f.offset,
    end,
    build: (): ContentItem | null => {
      if (f.lang === "mermaid") return { kind: "mermaid", id, src: body };
      if (f.lang === "html") return { kind: "html", id, src: body };
      if (f.lang === "svg") return { kind: "svg", id, src: body };
      if (f.lang === "json" || f.lang === "jsonc") {
        return { kind: "json", id, raw: body, value: parseJsonSafe(body), lines: lineCount(body) };
      }
      if (f.lang === "csv") {
        const p = parseDsv(body, ",");
        if (p && p.rows.length > 0) return { kind: "csv", id, header: p.header, rows: p.rows };
      }
      if (f.lang === "tsv") {
        const p = parseDsv(body, "\t");
        if (p && p.rows.length > 0) return { kind: "csv", id, header: p.header, rows: p.rows };
      }
      return {
        kind: "code",
        id,
        lang: f.lang || undefined,
        text: body,
        lines: lineCount(body),
      };
    },
  };
}

/**
 * Produce a flat list of items for a chunk of agent-generated text.
 *
 * Three-pass scan: (1) fenced code blocks build safe ranges and contribute
 * specialised items; (2) GFM tables and (3) `$$…$$` math blocks are detected
 * only in regions outside any fence so we don't false-positive on examples.
 * All spans are sorted by source offset and the gaps fill in as `text` items.
 */
export function classify(text: string): ContentItem[] {
  if (!text) return [];

  const spans: RawSpan[] = [];
  const fenceRanges: FencedRange[] = [];

  FENCE_RE.lastIndex = 0;
  let fm: RegExpExecArray | null = FENCE_RE.exec(text);
  while (fm !== null) {
    const offset = fm.index;
    const lang = (fm[2] || "").trim().toLowerCase();
    const body = fm[3] ?? "";
    const end = FENCE_RE.lastIndex;
    spans.push(fenceSpan(text, { offset, lang, body }, end));
    fenceRanges.push({ start: offset, end });
    fm = FENCE_RE.exec(text);
  }

  TABLE_RE.lastIndex = 0;
  let tm: RegExpExecArray | null = TABLE_RE.exec(text);
  while (tm !== null) {
    const lead = tm[1] ?? "";
    const block = tm[2] ?? "";
    const start = tm.index + lead.length;
    const end = start + block.length;
    if (!inAnyRange(fenceRanges, start)) {
      const parsed = parseMdTable(block);
      if (parsed && parsed.rows.length > 0) {
        const id = idFor("table", start);
        spans.push({
          start,
          end,
          build: () => ({ kind: "table", id, header: parsed.header, rows: parsed.rows }),
        });
      }
    }
    tm = TABLE_RE.exec(text);
  }

  MATH_BLOCK_RE.lastIndex = 0;
  let mm: RegExpExecArray | null = MATH_BLOCK_RE.exec(text);
  while (mm !== null) {
    const start = mm.index;
    const end = MATH_BLOCK_RE.lastIndex;
    if (!inAnyRange(fenceRanges, start)) {
      const tex = (mm[1] ?? "").trim();
      const id = idFor("math", start);
      spans.push({ start, end, build: () => ({ kind: "math", id, tex, display: true }) });
    }
    mm = MATH_BLOCK_RE.exec(text);
  }

  spans.sort((a, b) => a.start - b.start);

  const items: ContentItem[] = [];
  let cursor = 0;
  for (const sp of spans) {
    if (sp.start < cursor) continue;
    if (sp.start > cursor) {
      const chunk = text.slice(cursor, sp.start);
      if (chunk.trim()) items.push({ kind: "text", id: idFor("text", cursor), text: chunk });
    }
    const built = sp.build(text);
    if (built) items.push(built);
    cursor = sp.end;
  }
  if (cursor < text.length) {
    const chunk = text.slice(cursor);
    if (chunk.trim()) items.push({ kind: "text", id: idFor("text", cursor), text: chunk });
  }
  return items;
}
