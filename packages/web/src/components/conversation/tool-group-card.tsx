import { AlertCircle, ChevronDown, ChevronRight, Loader2, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import type { ToolCallState } from "../../stores/ui-store";
import { ToolCallCard } from "./tool-call-card";

/**
 * A folded "operations group" — visual replacement for runs of adjacent
 * tool calls in the same agent turn. Default collapsed; expanding renders
 * the individual ToolCallCard list inline.
 *
 * Failed and permission-required calls are intentionally NOT routed into
 * groups (see `conversation.tsx` reducer) so the user never has to expand
 * a chip to discover a problem.
 */
export function ToolGroupCard({ calls }: { calls: ToolCallState[] }) {
  const [open, setOpen] = useState(false);

  const meta = useMemo(() => summarize(calls), [calls]);

  return (
    <div
      className={cn(
        "my-1 overflow-hidden rounded-lg border bg-panel-elevated/60 text-xs transition-colors",
        meta.anyRunning
          ? "border-primary/40"
          : meta.anyFailed
            ? "border-destructive/40"
            : "border-border",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/40"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        {meta.anyRunning ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
        ) : meta.anyFailed ? (
          <AlertCircle className="h-3 w-3 shrink-0 text-destructive" />
        ) : (
          <Wrench className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className="font-medium text-foreground">{calls.length} operations</span>
        {meta.kindBreakdown.length > 0 && (
          <span className="truncate text-[11px] text-muted-foreground">
            · {meta.kindBreakdown.join(" · ")}
          </span>
        )}
        {meta.fileHint && (
          <span className="ml-2 truncate font-mono text-[11px] text-muted-foreground">
            {meta.fileHint}
          </span>
        )}
        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
          {formatDuration(meta.totalMs)}
        </span>
      </button>
      {open && (
        <div className="space-y-1 border-t border-border bg-panel/40 p-2">
          {calls.map((c) => (
            <ToolCallCard key={c.id} call={c} />
          ))}
        </div>
      )}
    </div>
  );
}

interface GroupSummary {
  anyRunning: boolean;
  anyFailed: boolean;
  totalMs: number;
  kindBreakdown: string[];
  fileHint?: string;
}

function summarize(calls: ToolCallState[]): GroupSummary {
  let anyRunning = false;
  let anyFailed = false;
  let totalMs = 0;
  const kindCounts = new Map<string, number>();
  const files = new Set<string>();
  const now = Date.now();
  for (const c of calls) {
    if (c.status === "in_progress" || c.status === "pending") anyRunning = true;
    if (c.status === "failed") anyFailed = true;
    const end = c.finishedAt ?? now;
    totalMs += Math.max(0, end - c.startedAt);
    const k = classifyKind(c);
    kindCounts.set(k, (kindCounts.get(k) ?? 0) + 1);
    if (Array.isArray(c.locations)) {
      for (const loc of c.locations) {
        if (loc?.path) files.add(loc.path);
      }
    }
  }
  const kindBreakdown = [...kindCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n} ${k}`);
  let fileHint: string | undefined;
  const fileArr = [...files];
  if (fileArr.length === 1) fileHint = shortPath(fileArr[0]);
  else if (fileArr.length > 1) fileHint = `${shortPath(fileArr[0])} (+${fileArr.length - 1} more)`;
  return { anyRunning, anyFailed, totalMs, kindBreakdown, fileHint };
}

function classifyKind(c: ToolCallState): string {
  const k = (c.kind || "").toLowerCase();
  const title = (c.title || "").toLowerCase();
  if (k.includes("edit") || title.includes("edit") || title.includes("write")) return "edit";
  if (k.includes("read") || title.includes("read") || title.includes("view")) return "read";
  if (k.includes("search") || k.includes("grep") || title.includes("grep")) return "search";
  if (
    k.includes("execute") ||
    k.includes("shell") ||
    k.includes("bash") ||
    k.includes("terminal")
  ) {
    return "shell";
  }
  if (k.includes("fetch") || k.includes("http")) return "fetch";
  return "tool";
}

function shortPath(p: string): string {
  if (p.length <= 40) return p;
  const parts = p.split("/");
  if (parts.length <= 2) return p;
  return `…/${parts.slice(-2).join("/")}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}
