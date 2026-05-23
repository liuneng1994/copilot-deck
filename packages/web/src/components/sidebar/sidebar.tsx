import { ChevronRight, FolderOpen, FolderPlus, MessageSquare, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { StatusDot } from "../ui/status-dot";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { cn } from "../../lib/cn";
import { useUIStore, type SessionState } from "../../stores/ui-store";
import { sendWs } from "../../lib/ws-client";

function statusToDot(status: SessionState["status"]) {
  if (status === "streaming") return { status: "ok" as const, pulse: true };
  if (status === "awaiting_perm") return { status: "warn" as const, pulse: true };
  if (status === "error") return { status: "err" as const };
  return { status: "muted" as const };
}

export function Sidebar() {
  const [q, setQ] = useState("");
  const [cwdInput, setCwdInput] = useState("/root/agents");
  const [busy, setBusy] = useState(false);
  const sessions = useUIStore((s) => s.sessions);
  const active = useUIStore((s) => s.activeSessionId);
  const setActive = useUIStore((s) => s.setActiveSession);
  const setLastError = useUIStore((s) => s.setLastError);

  const groups = useMemo(() => {
    const byCwd = new Map<string, SessionState[]>();
    for (const s of Object.values(sessions)) {
      if (!byCwd.has(s.cwd)) byCwd.set(s.cwd, []);
      byCwd.get(s.cwd)!.push(s);
    }
    const filtered = q
      ? new Map(
          [...byCwd.entries()].map(([k, list]) => [
            k,
            list.filter(
              (s) =>
                s.title.toLowerCase().includes(q.toLowerCase()) ||
                s.cwd.toLowerCase().includes(q.toLowerCase()),
            ),
          ]),
        )
      : byCwd;
    return [...filtered.entries()]
      .filter(([_, list]) => list.length > 0)
      .map(([cwd, list]) => ({ cwd, list: list.sort((a, b) => b.updatedAt - a.updatedAt) }));
  }, [sessions, q]);

  const createSession = () => {
    if (!cwdInput.trim()) return;
    sendWs({ type: "create_session", cwd: cwdInput.trim() });
  };

  const createFolderAndSession = async () => {
    const path = cwdInput.trim();
    if (!path || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/mkdir", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        path?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setLastError(data.error ?? `mkdir failed: HTTP ${res.status}`);
        return;
      }
      setLastError(null);
      sendWs({ type: "create_session", cwd: data.path ?? path });
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-panel">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <Input
          value={cwdInput}
          onChange={(e) => setCwdInput(e.target.value)}
          placeholder="cwd path…"
          className="h-8 text-xs"
          onKeyDown={(e) => e.key === "Enter" && createSession()}
          disabled={busy}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0"
              onClick={createFolderAndSession}
              disabled={busy || !cwdInput.trim()}
              aria-label="Create folder and session"
            >
              <FolderPlus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>mkdir -p + new session</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={createSession}
              disabled={busy || !cwdInput.trim()}
              aria-label="New session"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>New session in existing folder</TooltipContent>
        </Tooltip>
      </div>

      <div className="relative px-3 py-2">
        <Search className="pointer-events-none absolute left-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search sessions"
          className="h-8 pl-7 text-xs"
        />
      </div>

      <ScrollArea className="flex-1">
        <div className="px-2 pb-3">
          {groups.length === 0 && (
            <div className="px-2 py-8 text-center text-xs text-muted-foreground">
              No sessions yet.
              <br />
              Enter a path and hit{" "}
              <kbd className="rounded bg-muted px-1 py-0.5 text-[10px]">+</kbd>.
            </div>
          )}
          {groups.map(({ cwd, list }) => (
            <div key={cwd} className="mb-3">
              <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <FolderOpen className="h-3 w-3" />
                <span className="truncate" title={cwd}>{cwd}</span>
              </div>
              <ul className="space-y-0.5">
                {list.map((s) => {
                  const dot = statusToDot(s.status);
                  const isActive = s.id === active;
                  return (
                    <li key={s.id}>
                      <button
                        onClick={() => setActive(s.id)}
                        className={cn(
                          "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                          isActive
                            ? "bg-panel-elevated text-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <StatusDot status={dot.status} pulse={dot.pulse} />
                        <MessageSquare className="h-3 w-3 shrink-0 opacity-50" />
                        <span className="flex-1 truncate">{s.title}</span>
                        {isActive && <ChevronRight className="h-3 w-3 opacity-60" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </ScrollArea>
    </aside>
  );
}

export function SidebarRail({ onExpand }: { onExpand: () => void }) {
  return (
    <aside className="flex h-full w-12 shrink-0 flex-col items-center border-r border-border bg-panel py-2">
      <Button variant="ghost" size="icon" onClick={onExpand} title="Expand sidebar (⌘\)">
        <ChevronRight className="h-4 w-4" />
      </Button>
    </aside>
  );
}
