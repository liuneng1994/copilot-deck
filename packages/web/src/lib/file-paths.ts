import { useUIStore } from "../stores/ui-store";

/**
 * Match path-like tokens commonly emitted by agents:
 *  - relative paths with at least one separator: src/foo.ts, packages/x/y.tsx
 *  - leading ./ or ../: ./bar, ../sibling/file.md
 *  - absolute unix paths: /etc/hosts, /tmp/output.log
 *  - optional :line[:col] suffix: src/foo.ts:42 or src/foo.ts:42:5
 *
 * Heuristics intentionally conservative — avoid matching URLs, sentences, etc.
 */
const PATH_RE =
  /(?<![A-Za-z0-9@:/.])((?:\.{1,2}\/|\/)?(?:[\w.-]+\/)+[\w.-]+(?:\.[A-Za-z0-9]{1,8})?)(?::(\d+)(?::(\d+))?)?/g;

const URL_RE = /^https?:\/\//i;

export interface PathSegment {
  type: "text" | "path";
  text: string;
  path?: string;
  line?: number;
  col?: number;
}

/**
 * Split a string into plain text + clickable path segments. Returns the
 * original string as a single text segment when nothing matches.
 */
export function segmentPaths(input: string): PathSegment[] {
  if (!input || URL_RE.test(input)) return [{ type: "text", text: input }];
  const out: PathSegment[] = [];
  let last = 0;
  let m = PATH_RE.exec(input);
  while (m !== null) {
    const start = m.index;
    const matched = m[0];
    const path = m[1];
    if (path && path.length >= 3 && !/^[\d.]+$/.test(path)) {
      const hasSlash = path.includes("/");
      const hasExt = /\.[a-zA-Z]{1,8}$/.test(path);
      if (hasSlash || hasExt) {
        if (start > last) out.push({ type: "text", text: input.slice(last, start) });
        out.push({
          type: "path",
          text: matched,
          path,
          line: m[2] ? Number(m[2]) : undefined,
          col: m[3] ? Number(m[3]) : undefined,
        });
        last = start + matched.length;
      }
    }
    m = PATH_RE.exec(input);
  }
  if (out.length === 0) return [{ type: "text", text: input }];
  if (last < input.length) out.push({ type: "text", text: input.slice(last) });
  return out;
}

/**
 * Open a path in the inspector Files tab and optionally trigger an
 * editor open via the existing /api/open-in-editor endpoint.
 */
export function openPath(path: string, cwd: string, opts: { editor?: boolean } = {}): void {
  const store = useUIStore.getState();
  store.setInspectorTab("files");
  store.setFilePreviewPath(path);
  if (opts.editor) {
    void fetch(
      `/api/open-in-editor?path=${encodeURIComponent(path)}&cwd=${encodeURIComponent(cwd)}`,
      { method: "POST" },
    );
  }
}
