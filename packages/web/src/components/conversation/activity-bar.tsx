import { FileEdit, FileSearch, FileText, Globe, Loader2, Terminal, Wrench } from "lucide-react";
import { type SessionState, type ToolCallState, useUIStore } from "../../stores/ui-store";

function iconFor(kind: string) {
  switch (kind) {
    case "edit":
      return FileEdit;
    case "read":
      return FileText;
    case "search":
      return FileSearch;
    case "execute":
      return Terminal;
    case "fetch":
      return Globe;
    default:
      return Wrench;
  }
}

function verbFor(kind: string): string {
  switch (kind) {
    case "edit":
      return "editing";
    case "read":
      return "reading";
    case "search":
      return "searching";
    case "execute":
      return "running";
    case "fetch":
      return "fetching";
    case "think":
      return "thinking";
    default:
      return "working";
  }
}

function shortLocation(call: ToolCallState): string {
  const loc = call.locations?.[0]?.path;
  if (loc) {
    const parts = loc.split("/");
    return parts.slice(-2).join("/");
  }
  return call.inputSummary || call.title || "";
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function ActivityBar({ session }: { session: SessionState }) {
  const all = useUIStore((s) => s.toolCalls);
  if (session.status !== "streaming") return null;

  // Find tool calls for this session sorted by ts.
  const calls = session.toolCallIds
    .map((id) => all[id])
    .filter((c): c is ToolCallState => !!c)
    .sort((a, b) => a.ts - b.ts);
  if (calls.length === 0) return null;

  // Count back to most recent user message → "op N of this turn".
  const lastUserTs = [...session.messages].reverse().find((m) => m.role === "user")?.ts ?? 0;
  const turnCalls = calls.filter((c) => c.ts >= lastUserTs);
  if (turnCalls.length === 0) return null;

  // Prefer the most recent in-progress; fall back to the latest completed.
  const inProgress = [...turnCalls].reverse().find((c) => c.status === "in_progress");
  const target = inProgress ?? turnCalls[turnCalls.length - 1];
  const Icon = iconFor(target.kind);
  const loc = shortLocation(target);
  const opIndex = turnCalls.indexOf(target) + 1;

  return (
    <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 flex justify-center px-6 pt-2">
      <div className="pointer-events-auto inline-flex max-w-full items-center gap-2 truncate rounded-full border border-border bg-panel-elevated/95 px-3 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
        {inProgress ? (
          <Loader2 className="h-3 w-3 animate-spin text-primary" />
        ) : (
          <Icon className="h-3 w-3 text-primary" />
        )}
        <span className="font-medium text-foreground">{verbFor(target.kind)}</span>
        {loc && (
          <span className="truncate font-mono text-foreground/80" title={loc}>
            {loc}
          </span>
        )}
        <span className="text-muted-foreground">·</span>
        <span>{ordinal(opIndex)} op this turn</span>
      </div>
    </div>
  );
}
