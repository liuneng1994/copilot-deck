import { diffLines } from "diff";
import { ExternalLink, Eye, FileText, Pencil } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { highlightToHtml } from "../../lib/shiki";
import { type SessionState, type ToolCallState, useUIStore } from "../../stores/ui-store";

type Touch = "read" | "write" | "exec" | "other";

interface FileTouch {
  path: string;
  /** Aggregate "strongest" touch type for the badge. */
  touch: Touch;
  /** Last tool call that touched it. */
  lastCallId: string;
  lastTs: number;
  /** Distinct tool call ids that touched the file. */
  callCount: number;
  /** Total added lines across all diff blocks for this file. */
  added: number;
  /** Total removed lines across all diff blocks for this file. */
  removed: number;
}

function pickPath(input: unknown, fields: string[]): string | undefined {
  if (input == null || typeof input !== "object") return undefined;
  for (const f of fields) {
    const v = (input as Record<string, unknown>)[f];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function touchForCall(call: ToolCallState): Touch {
  const k = (call.kind || "").toLowerCase();
  if (k.includes("edit") || k.includes("write") || k.includes("create") || k.includes("delete")) {
    return "write";
  }
  if (k.includes("read") || k.includes("view") || k.includes("search") || k.includes("list")) {
    return "read";
  }
  if (
    k.includes("execute") ||
    k.includes("terminal") ||
    k.includes("shell") ||
    k.includes("bash")
  ) {
    return "exec";
  }
  return "other";
}

function countLines(text: string): number {
  if (text === "") return 0;
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

function diffStatsForBlock(block: { oldText?: string; newText?: string }): {
  added: number;
  removed: number;
} {
  const oldT = block.oldText ?? "";
  const newT = block.newText ?? "";
  if (!oldT && !newT) return { added: 0, removed: 0 };
  if (!oldT) return { added: countLines(newT), removed: 0 };
  if (!newT) return { added: 0, removed: countLines(oldT) };
  let added = 0;
  let removed = 0;
  for (const p of diffLines(oldT, newT)) {
    const lines = p.value.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    if (p.added) added += lines.length;
    else if (p.removed) removed += lines.length;
  }
  return { added, removed };
}

function aggregateFiles(calls: ToolCallState[]): FileTouch[] {
  const map = new Map<string, FileTouch>();
  for (const c of calls) {
    const seen = new Set<string>();
    const perPathStats = new Map<string, { added: number; removed: number }>();
    if (Array.isArray(c.locations)) {
      for (const loc of c.locations) {
        if (typeof loc.path === "string") seen.add(loc.path);
      }
    }
    for (const b of c.content) {
      if (b.kind === "diff" && b.path) {
        seen.add(b.path);
        const stats = diffStatsForBlock({ oldText: b.oldText, newText: b.newText });
        const prev = perPathStats.get(b.path) ?? { added: 0, removed: 0 };
        perPathStats.set(b.path, {
          added: prev.added + stats.added,
          removed: prev.removed + stats.removed,
        });
      }
    }
    const rawPath = pickPath(c.rawInput, ["path", "file_path", "filename", "file"]);
    if (rawPath) seen.add(rawPath);

    // Fall back to rawInput {content, old_content} for write/edit tools that
    // don't ship explicit diff content blocks (e.g. simple create calls).
    if (rawPath && !perPathStats.has(rawPath)) {
      const k = (c.kind || "").toLowerCase();
      const looksWrite =
        k.includes("write") ||
        k.includes("edit") ||
        k.includes("create") ||
        k.includes("patch") ||
        k.includes("modify");
      if (looksWrite) {
        const raw = c.rawInput as Record<string, unknown> | null;
        const newC = raw && typeof raw === "object" ? raw : null;
        const newText =
          (typeof newC?.content === "string" && newC.content) ||
          (typeof newC?.new_content === "string" && newC.new_content) ||
          (typeof newC?.newContent === "string" && newC.newContent) ||
          "";
        const oldText =
          (typeof newC?.old_content === "string" && newC.old_content) ||
          (typeof newC?.oldContent === "string" && newC.oldContent) ||
          "";
        if (newText || oldText) {
          const stats = diffStatsForBlock({ oldText, newText });
          perPathStats.set(rawPath, stats);
        }
      }
    }

    if (seen.size === 0) continue;
    const t = touchForCall(c);
    for (const p of seen) {
      const stats = perPathStats.get(p) ?? { added: 0, removed: 0 };
      const prev = map.get(p);
      if (!prev) {
        map.set(p, {
          path: p,
          touch: t,
          lastCallId: c.id,
          lastTs: c.ts,
          callCount: 1,
          added: stats.added,
          removed: stats.removed,
        });
      } else {
        // Prefer write > exec > read > other for display badge.
        const rank = (x: Touch) => ({ write: 3, exec: 2, read: 1, other: 0 })[x];
        const newTouch = rank(t) > rank(prev.touch) ? t : prev.touch;
        const newer = c.ts > prev.lastTs;
        map.set(p, {
          path: p,
          touch: newTouch,
          lastCallId: newer ? c.id : prev.lastCallId,
          lastTs: newer ? c.ts : prev.lastTs,
          callCount: prev.callCount + 1,
          added: prev.added + stats.added,
          removed: prev.removed + stats.removed,
        });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.lastTs - a.lastTs);
}

const touchStyle: Record<Touch, string> = {
  write: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  read: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  exec: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  other: "bg-muted text-muted-foreground border-border",
};

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}
function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i + 1);
}

function langFromPath(p: string): string {
  const ext = p.slice(p.lastIndexOf(".") + 1).toLowerCase();
  const map: Record<string, string> = {
    ts: "ts",
    tsx: "tsx",
    js: "js",
    jsx: "jsx",
    json: "json",
    md: "md",
    py: "py",
    sh: "bash",
    bash: "bash",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    rs: "rust",
    go: "go",
    java: "java",
    rb: "ruby",
    css: "css",
    html: "html",
    sql: "sql",
  };
  return map[ext] ?? "txt";
}

function openInEditor(p: string, cwd: string) {
  void fetch(`/api/open-in-editor?path=${encodeURIComponent(p)}&cwd=${encodeURIComponent(cwd)}`, {
    method: "POST",
  });
}

function FilePreview({ path, cwd }: { path: string; cwd: string }) {
  const [state, setState] = useState<
    | { loading: true }
    | { loading: false; html: string; size: number; truncated: boolean }
    | { loading: false; error: string }
  >({ loading: true });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    fetch(`/api/file?path=${encodeURIComponent(path)}&cwd=${encodeURIComponent(cwd)}`)
      .then(async (r) => {
        const j = (await r.json()) as
          | { content: string; size: number; truncated: boolean }
          | { error: string };
        if (cancelled) return;
        if ("error" in j) {
          setState({ loading: false, error: j.error });
          return;
        }
        const html = await highlightToHtml(j.content, langFromPath(path));
        if (cancelled) return;
        setState({ loading: false, html, size: j.size, truncated: j.truncated });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [path, cwd]);

  if (state.loading) {
    return <div className="px-2 py-3 text-[11px] text-muted-foreground">Loading…</div>;
  }
  if ("error" in state) {
    return <div className="px-2 py-3 text-[11px] text-rose-400">Error: {state.error}</div>;
  }
  return (
    <div className="overflow-hidden rounded border border-border bg-[#0d1117]">
      <div className="flex items-center justify-between border-b border-border px-2 py-1 text-[10px] text-muted-foreground">
        <span className="font-mono">{path}</span>
        <span>
          {state.size.toLocaleString()} B{state.truncated ? " · truncated" : ""}
        </span>
      </div>
      <div
        className="max-h-[60vh] overflow-auto text-[11px] [&_pre]:!m-0 [&_pre]:!bg-transparent [&_pre]:p-2"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki produces sanitized highlight HTML
        dangerouslySetInnerHTML={{ __html: state.html }}
      />
    </div>
  );
}

interface Props {
  session: SessionState;
  toolCalls: Record<string, ToolCallState>;
}

export function FilesTab({ session, toolCalls }: Props) {
  const calls = useMemo(
    () =>
      session.toolCallIds.map((id) => toolCalls[id]).filter((c): c is ToolCallState => Boolean(c)),
    [session.toolCallIds, toolCalls],
  );
  const files = useMemo(() => aggregateFiles(calls), [calls]);
  const externalPath = useUIStore((s) => s.filePreviewPath);
  const setExternal = useUIStore((s) => s.setFilePreviewPath);
  const [selected, setSelected] = useState<string | null>(null);

  // External requests (clickable paths in messages / tool-call locations) override the
  // in-list selection. Sync once and clear the external pointer so subsequent in-tab
  // clicks behave normally.
  useEffect(() => {
    if (externalPath) {
      setSelected(externalPath);
      setExternal(null);
    }
  }, [externalPath, setExternal]);

  // Show external-only files (clicked from messages) at the top of the list even when
  // no tool call touched them yet.
  const allFiles = useMemo(() => {
    if (!selected || files.some((f) => f.path === selected)) return files;
    return [
      {
        path: selected,
        touch: "other" as Touch,
        lastCallId: "",
        lastTs: Date.now(),
        callCount: 0,
        added: 0,
        removed: 0,
      },
      ...files,
    ];
  }, [files, selected]);

  const totals = useMemo(() => {
    let added = 0;
    let removed = 0;
    let changedFiles = 0;
    for (const f of allFiles) {
      added += f.added;
      removed += f.removed;
      if (f.added > 0 || f.removed > 0) changedFiles += 1;
    }
    return { added, removed, changedFiles, total: allFiles.length };
  }, [allFiles]);

  if (allFiles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
        Files touched by the agent will appear here.
      </div>
    );
  }

  return (
    <div className="space-y-2 px-1 py-1">
      <div className="flex items-center justify-between rounded border border-border bg-panel-elevated px-2 py-1 text-[10px] text-muted-foreground">
        <span>
          {totals.total} file{totals.total === 1 ? "" : "s"}
          {totals.changedFiles > 0 && (
            <span className="text-foreground/80">
              {" · "}
              {totals.changedFiles} changed
            </span>
          )}
        </span>
        {(totals.added > 0 || totals.removed > 0) && (
          <span className="font-mono">
            <span className="text-emerald-400">+{totals.added}</span>{" "}
            <span className="text-rose-400">−{totals.removed}</span>
          </span>
        )}
      </div>
      <ul className="space-y-0.5">
        {allFiles.map((f) => (
          <li
            key={f.path}
            className={`group relative flex items-stretch rounded ${selected === f.path ? "bg-muted/70" : "hover:bg-muted/50"}`}
          >
            <button
              type="button"
              onClick={() => setSelected((s) => (s === f.path ? null : f.path))}
              className="flex flex-1 cursor-pointer items-start gap-1.5 px-2 py-1 text-left text-[11px]"
              title={f.path}
            >
              <span
                className={`mt-[2px] inline-flex h-3.5 items-center justify-center rounded border px-1 text-[9px] font-medium uppercase ${touchStyle[f.touch]}`}
              >
                {f.touch === "write" ? (
                  <Pencil className="h-2.5 w-2.5" />
                ) : f.touch === "read" ? (
                  <Eye className="h-2.5 w-2.5" />
                ) : (
                  <FileText className="h-2.5 w-2.5" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono">
                  <span className="text-muted-foreground">{dirname(f.path)}</span>
                  <span className="font-medium">{basename(f.path)}</span>
                </span>
                <span className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>
                    {f.callCount > 0
                      ? `${f.touch} · ${f.callCount} call${f.callCount > 1 ? "s" : ""}`
                      : "opened from message"}
                  </span>
                  {(f.added > 0 || f.removed > 0) && (
                    <span className="font-mono">
                      <span className="text-emerald-400">+{f.added}</span>{" "}
                      <span className="text-rose-400">−{f.removed}</span>
                    </span>
                  )}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openInEditor(f.path, session.cwd);
              }}
              className="invisible mr-1 self-center rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground group-hover:visible"
              title="Open in editor"
            >
              <ExternalLink className="h-3 w-3" />
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <div className="px-1">
          <FilePreview path={selected} cwd={session.cwd} />
        </div>
      )}
    </div>
  );
}
