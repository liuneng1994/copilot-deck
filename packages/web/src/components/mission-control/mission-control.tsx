import { AlertCircle, Bot, Circle, LayoutDashboard, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { formatCost, formatDuration, formatTokens } from "../../lib/perf-aggregate";
import { orderedSessions } from "../../lib/session-order";
import type { SessionState } from "../../stores/ui-store";
import { useUIStore } from "../../stores/ui-store";
import { iconForKind } from "../conversation/tool-icons";
import { deriveActivity } from "../conversation/use-session-activity";
import { Button } from "../ui/button";

type Filter = "all" | "running" | "idle" | "crashed";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "running", label: "Running" },
  { id: "idle", label: "Idle" },
  { id: "crashed", label: "Crashed" },
];

function matchesFilter(s: SessionState, f: Filter): boolean {
  switch (f) {
    case "all":
      return true;
    case "running":
      return s.status === "streaming" || s.status === "awaiting_perm";
    case "idle":
      return s.status === "idle" && !s.crashed;
    case "crashed":
      return s.status === "error" || !!s.crashed;
  }
}

function StatusDot({ session }: { session: SessionState }) {
  let color = "bg-zinc-400";
  let title = "Idle";
  if (session.crashed || session.status === "error") {
    color = "bg-rose-500";
    title = "Crashed";
  } else if (session.status === "streaming" || session.status === "awaiting_perm") {
    color = "bg-emerald-500";
    title = "Running";
  } else if (session.detached) {
    color = "bg-zinc-300 dark:bg-zinc-600";
    title = "Detached";
  }
  return (
    <span
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", color)}
      title={title}
      aria-label={title}
    />
  );
}

function lastAgentText(s: SessionState): string {
  for (let i = s.messages.length - 1; i >= 0; i--) {
    const m = s.messages[i];
    if (m && m.role === "agent" && m.text) {
      return m.text.slice(0, 100).replace(/\s+/g, " ").trim();
    }
  }
  return "";
}

function tailCwd(cwd: string): string {
  const parts = cwd.split("/");
  return parts.slice(-2).join("/") || cwd;
}

function MissionRow({ session, onOpen }: { session: SessionState; onOpen: () => void }) {
  const toolCalls = useUIStore((s) => s.toolCalls);
  const activity = deriveActivity(session, toolCalls);
  const Icon = activity ? iconForKind(activity.kind) : null;
  const last = lastAgentText(session);
  const durationMs = Math.max(0, Date.now() - session.createdAt);
  const tokens = (session.tokensIn ?? 0) + (session.tokensOut ?? 0);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group w-full rounded-lg border border-border bg-panel-elevated px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-muted"
    >
      <div className="flex items-center gap-3">
        <StatusDot session={session} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{session.title}</span>
            <span className="truncate font-mono text-[10px] text-muted-foreground">
              {tailCwd(session.cwd)}
            </span>
            {session.modeName && (
              <span className="rounded bg-muted px-1 text-[9px] uppercase tracking-wider text-muted-foreground">
                {session.modeName}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
            {activity ? (
              <span className="inline-flex min-w-0 items-center gap-1.5 text-foreground/80">
                {activity.inProgress ? (
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
                ) : Icon ? (
                  <Icon className="h-3 w-3 shrink-0 text-primary" />
                ) : null}
                <span className="font-medium">{activity.verb}</span>
                {activity.location && (
                  <span className="truncate font-mono">{activity.location}</span>
                )}
              </span>
            ) : session.crashed || session.status === "error" ? (
              <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-300">
                <AlertCircle className="h-3 w-3" /> Crashed
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Circle className="h-2 w-2 fill-current opacity-50" /> Idle
              </span>
            )}
            {last && (
              <span className="hidden truncate text-muted-foreground/80 md:inline">
                Last: <span className="italic">"{last}"</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-4 text-[11px]">
          <Metric label="tokens" value={tokens > 0 ? formatTokens(tokens) : "—"} />
          <Metric label="cost" value={formatCost(session.costAmount ?? 0, session.costCurrency)} />
          <Metric label="age" value={formatDuration(durationMs)} />
        </div>
      </div>
    </button>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex w-14 flex-col items-end">
      <span className="font-mono text-foreground">{value}</span>
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
  );
}

export function MissionControl() {
  const sessions = useUIStore((s) => s.sessions);
  const setActive = useUIStore((s) => s.setActiveSession);
  const setTopView = useUIStore((s) => s.setTopView);
  const [filter, setFilter] = useState<Filter>("all");

  const ordered = useMemo(() => orderedSessions(sessions), [sessions]);
  const filtered = useMemo(
    () => ordered.filter((s) => matchesFilter(s, filter)).sort((a, b) => b.updatedAt - a.updatedAt),
    [ordered, filter],
  );

  const counts = useMemo(() => {
    const c = { all: 0, running: 0, idle: 0, crashed: 0 };
    for (const s of ordered) {
      c.all += 1;
      if (matchesFilter(s, "running")) c.running += 1;
      else if (matchesFilter(s, "crashed")) c.crashed += 1;
      else c.idle += 1;
    }
    return c;
  }, [ordered]);

  const open = (id: string) => {
    setActive(id);
    setTopView("workspace");
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Mission Control</h2>
          <span className="text-xs text-muted-foreground">
            {ordered.length} session{ordered.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {FILTERS.map((f) => (
            <Button
              key={f.id}
              variant={filter === f.id ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => setFilter(f.id)}
            >
              {f.label}
              <span className="ml-1.5 rounded bg-muted px-1 text-[9px] text-muted-foreground">
                {counts[f.id]}
              </span>
            </Button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-auto px-6 py-4">
        {filtered.length === 0 ? (
          <div className="mt-16 flex flex-col items-center text-center text-muted-foreground">
            <Bot className="mb-3 h-8 w-8 opacity-40" />
            <p className="text-sm">
              {ordered.length === 0
                ? "No sessions yet — create one from the sidebar."
                : `No ${filter === "all" ? "" : filter} sessions to show.`}
            </p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-5xl flex-col gap-2">
            {filtered.map((s) => (
              <MissionRow key={s.id} session={s} onOpen={() => open(s.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
