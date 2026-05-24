import type { OutlineNode } from "@agent-view/shared";
import { Maximize2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../../lib/cn";
import { type SupportedLang, highlightToHtml } from "../../../lib/shiki";
import { extractShikiLineHtml } from "../../../lib/shiki-lines";
import { useUIStore } from "../../../stores/ui-store";

const CHUNK_BYTES = 64 * 1024;
const HEX_HEADER_BYTES = 256;

interface FilePreviewProps {
  path: string;
  cwd: string;
}

interface FileResponse {
  size: number;
  offset: number;
  length: number;
  isBinary: boolean;
  isImage: boolean;
  mime: string;
  content?: string;
  truncated: boolean;
  error?: string;
}

interface OutlineResponse {
  language: string | null;
  nodes: OutlineNode[] | null;
  error?: string;
}

interface PreviewState {
  size: number;
  loadedBytes: number;
  isBinary: boolean;
  isImage: boolean;
  mime: string;
  content: string;
  hex: string | null;
}

function langFromPath(p?: string): SupportedLang {
  if (!p) return "text";
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, SupportedLang> = {
    ts: "ts",
    tsx: "tsx",
    js: "js",
    jsx: "jsx",
    mjs: "js",
    cjs: "js",
    json: "json",
    md: "md",
    markdown: "md",
    py: "py",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    yml: "yaml",
    yaml: "yaml",
    go: "go",
    rs: "rust",
    html: "html",
    css: "css",
    toml: "toml",
    sql: "sql",
    xml: "xml",
    ini: "ini",
    dockerfile: "dockerfile",
  };
  return map[ext] ?? "text";
}

function fileUrl(
  route: "/api/file" | "/api/file/raw" | "/api/file/outline",
  path: string,
  cwd: string,
  range?: { offset: number; length: number },
) {
  const params = new URLSearchParams({ path, cwd });
  if (range) {
    params.set("offset", String(range.offset));
    params.set("length", String(range.length));
  }
  return `${route}?${params.toString()}`;
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `${response.status} ${response.statusText}`);
  return body;
}

function extractLinesFromHtml(html: string): string[] {
  return extractShikiLineHtml(html);
}

function bytesToHex(bytes: Uint8Array): string {
  const rows: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const slice = bytes.slice(offset, offset + 16);
    const hex = Array.from(slice, (byte) => byte.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(slice, (byte) =>
      byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".",
    ).join("");
    rows.push(`${offset.toString(16).padStart(8, "0")}  ${hex.padEnd(47, " ")}  ${ascii}`);
  }
  return rows.join("\n") || "(empty file)";
}

async function fetchHexHeader(path: string, cwd: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(fileUrl("/api/file/raw", path, cwd), { signal });
  if (!response.ok) return "Binary header unavailable.";
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytesToHex(bytes.slice(0, HEX_HEADER_BYTES));
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < HEX_HEADER_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const header = new Uint8Array(Math.min(total, HEX_HEADER_BYTES));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.length, header.length - offset);
    header.set(chunk.slice(0, take), offset);
    offset += take;
    if (offset >= header.length) break;
  }
  return bytesToHex(header);
}

function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString()} B`;
}

function Skeleton() {
  return (
    <div className="space-y-2 px-3 py-3" aria-label="Loading preview">
      <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
      <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
      <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
    </div>
  );
}

function CodePreview({ content, path }: { content: string; path: string }) {
  const lang = useMemo(() => langFromPath(path), [path]);
  const plainLines = useMemo(() => content.split(/\r?\n/), [content]);
  const [htmlLines, setHtmlLines] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtmlLines(null);
    highlightToHtml(content, lang)
      .then((html) => {
        if (cancelled) return;
        const lines = extractLinesFromHtml(html);
        setHtmlLines(lines.length === plainLines.length ? lines : null);
      })
      .catch(() => {
        if (!cancelled) setHtmlLines(null);
      });
    return () => {
      cancelled = true;
    };
  }, [content, lang, plainLines.length]);

  return (
    <div className="min-w-full font-mono text-[12px] leading-5 text-foreground">
      {plainLines.map((line, index) => {
        const lineNumber = index + 1;
        const highlighted = htmlLines?.[index];
        return (
          <div
            id={`L${lineNumber}`}
            key={lineNumber}
            className="flex min-h-5 scroll-mt-3 hover:bg-muted/30"
          >
            <span
              className="sticky left-0 select-none border-r border-border/60 bg-background/95 px-2 text-right text-muted-foreground"
              style={{ minWidth: `${Math.max(3, String(plainLines.length).length) + 2}ch` }}
            >
              {lineNumber}
            </span>
            {highlighted !== undefined ? (
              <span
                className="flex-1 whitespace-pre px-3"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki produces sanitized highlight HTML
                dangerouslySetInnerHTML={{ __html: highlighted || "&nbsp;" }}
              />
            ) : (
              <span className="flex-1 whitespace-pre px-3">{line || "\u00a0"}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BinaryPreview({ state }: { state: PreviewState }) {
  return (
    <div className="space-y-2 p-3 font-mono text-[12px] text-foreground">
      <div className="font-sans text-[11px] text-muted-foreground">
        Binary file · {formatBytes(state.size)} · {state.mime}
      </div>
      <pre className="m-0 overflow-auto rounded border border-border bg-background p-3">
        {state.hex ?? "Loading binary header…"}
      </pre>
    </div>
  );
}

function OutlineRail({ nodes }: { nodes: OutlineNode[] }) {
  if (nodes.length === 0) return null;
  return (
    <aside className="w-48 shrink-0 overflow-auto border-l border-border bg-panel/30 p-2 text-[11px]">
      <div className="mb-2 font-medium text-muted-foreground">Outline</div>
      <OutlineList nodes={nodes} />
    </aside>
  );
}

function OutlineList({ nodes, depth = 0 }: { nodes: OutlineNode[]; depth?: number }) {
  return (
    <ul className="space-y-0.5">
      {nodes.map((node) => (
        <li key={`${node.name}-${node.startLine}-${depth}`}>
          <button
            type="button"
            className="block w-full truncate rounded px-1 py-0.5 text-left text-muted-foreground hover:bg-muted hover:text-foreground"
            style={{ paddingLeft: `${depth * 0.75 + 0.25}rem` }}
            title={`${node.name} (${node.startLine})`}
            onClick={() =>
              document
                .getElementById(`L${node.startLine}`)
                ?.scrollIntoView({ block: "start", behavior: "smooth" })
            }
          >
            <span aria-hidden="true">• </span>
            {node.name} <span className="text-muted-foreground/70">({node.startLine})</span>
          </button>
          {node.children && node.children.length > 0 ? (
            <OutlineList nodes={node.children} depth={depth + 1} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function FilePreview({ path, cwd }: FilePreviewProps) {
  const generation = useUIStore((s) => s.filesOverview[cwd]?.generation ?? 0);
  const [state, setState] = useState<PreviewState | null>(null);
  const [outline, setOutline] = useState<OutlineNode[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  // ESC closes the maximized overlay.
  useEffect(() => {
    if (!maximized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMaximized(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximized]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `generation` is a refresh signal from git/file-watcher
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    setState(null);
    setOutline(null);
    setError(null);
    setLoading(true);

    const loadPreview = async () => {
      try {
        const response = await fetchJson<FileResponse>(
          fileUrl("/api/file", path, cwd, { offset: 0, length: CHUNK_BYTES }),
          controller.signal,
        );
        let hex: string | null = null;
        if (response.isBinary && !response.isImage) {
          hex = await fetchHexHeader(path, cwd, controller.signal);
        }
        if (controller.signal.aborted) return;
        setState({
          size: response.size,
          loadedBytes: response.offset + response.length,
          isBinary: response.isBinary,
          isImage: response.isImage,
          mime: response.mime,
          content: response.content ?? "",
          hex,
        });
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    const loadOutline = async () => {
      try {
        const response = await fetchJson<OutlineResponse>(
          fileUrl("/api/file/outline", path, cwd),
          controller.signal,
        );
        if (!controller.signal.aborted) setOutline(response.nodes);
      } catch {
        if (!controller.signal.aborted) setOutline(null);
      }
    };

    void loadPreview();
    void loadOutline();

    return () => controller.abort();
  }, [path, cwd, generation]);

  const loadMore = async () => {
    if (!state || state.isBinary || state.isImage || loadingMore) return;
    const controller = new AbortController();
    setLoadingMore(true);
    setError(null);
    try {
      const response = await fetchJson<FileResponse>(
        fileUrl("/api/file", path, cwd, { offset: state.loadedBytes, length: CHUNK_BYTES }),
        controller.signal,
      );
      setState((current) =>
        current
          ? {
              ...current,
              size: response.size,
              loadedBytes: response.offset + response.length,
              content: current.content + (response.content ?? ""),
            }
          : current,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) return <Skeleton />;

  if (error && !state) {
    const isMissing = /ENOENT|no such file|not found/i.test(error);
    return (
      <div className="px-3 py-3 text-[12px]">
        {isMissing ? (
          <div className="space-y-1">
            <div className="font-medium text-foreground">File no longer exists on disk</div>
            <div className="text-[11px] text-muted-foreground">
              <span className="font-mono">{path}</span> was removed (likely by
              <span className="font-mono"> git stash</span>,
              <span className="font-mono"> git checkout</span>, or an external delete). The
              agent-touch record is kept for history; switch to "vs HEAD" diff above to see what was
              removed.
            </div>
          </div>
        ) : (
          <div className="text-destructive">Error loading preview: {error}</div>
        )}
      </div>
    );
  }

  if (!state) return null;

  const rawUrl = fileUrl("/api/file/raw", path, cwd);
  const canLoadMore = !state.isBinary && !state.isImage && state.loadedBytes < state.size;
  const showOutline = !state.isBinary && !state.isImage && outline && outline.length > 0;

  const body = (
    <>
      <div
        className={cn("flex min-h-0 border-b border-border", maximized ? "flex-1" : "max-h-[50vh]")}
      >
        <div className="min-w-0 flex-1 overflow-auto bg-background">
          {state.isImage ? (
            <div className="flex min-h-48 items-center justify-center p-3">
              <img
                src={rawUrl}
                alt={path}
                className={cn(
                  "rounded border border-border object-contain",
                  maximized ? "max-h-[85vh] max-w-full" : "max-h-[45vh] max-w-full",
                )}
              />
            </div>
          ) : state.isBinary ? (
            <BinaryPreview state={state} />
          ) : (
            <CodePreview content={state.content} path={path} />
          )}
        </div>
        {showOutline && outlineOpen ? <OutlineRail nodes={outline ?? []} /> : null}
      </div>
      <div className="flex items-center gap-3 px-3 py-2 text-[11px] text-muted-foreground">
        <span>
          Loaded {formatBytes(state.loadedBytes)} / {formatBytes(state.size)}
        </span>
        {error ? (
          <span className="text-destructive">
            {error} · size {formatBytes(state.size)}
          </span>
        ) : null}
        {showOutline ? (
          <button
            type="button"
            onClick={() => setOutlineOpen((v) => !v)}
            className="rounded border border-border px-2 py-1 text-foreground hover:bg-muted"
          >
            {outlineOpen ? "Hide outline" : "Show outline"}
          </button>
        ) : null}
        {canLoadMore ? (
          <button
            type="button"
            className="ml-auto rounded border border-border px-2 py-1 text-foreground hover:bg-muted disabled:opacity-60"
            disabled={loadingMore}
            onClick={loadMore}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        ) : null}
      </div>
    </>
  );

  if (maximized) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-stretch justify-center bg-background/90 p-4 backdrop-blur-sm"
        // biome-ignore lint/a11y/useSemanticElements: native <dialog> requires imperative API; using role=dialog for compat
        role="dialog"
        aria-modal="true"
        aria-label={`Preview ${path}`}
      >
        <div className="flex w-full max-w-[1400px] flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-[12px]">
            <span className="truncate font-mono text-foreground" title={path}>
              {path}
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {formatBytes(state.size)}
            </span>
            <button
              type="button"
              onClick={() => setMaximized(false)}
              className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Close fullscreen preview"
              title="Close (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col text-[12px]">{body}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col text-[12px]">
      <div className="flex items-center justify-end border-b border-border bg-panel/40 px-2 py-1">
        <button
          type="button"
          onClick={() => setMaximized(true)}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Maximize for easier reading"
        >
          <Maximize2 className="h-3 w-3" />
          Maximize
        </button>
      </div>
      {body}
    </div>
  );
}
