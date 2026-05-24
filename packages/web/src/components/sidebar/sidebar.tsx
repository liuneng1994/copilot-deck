import {
  ChevronRight,
  FolderOpen,
  FolderPlus,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { orderedSessions } from "../../lib/session-order";
import { sendWs } from "../../lib/ws-client";
import { type SessionState, useUIStore } from "../../stores/ui-store";
import { confirmDialog } from "../overlays/confirm-dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { StatusDot } from "../ui/status-dot";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { CwdCombobox } from "./cwd-combobox";

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
  const width = useUIStore((s) => s.sidebarWidth);

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
  const displaySessionIds = useMemo(
    () => groups.flatMap(({ list }) => list.map((session) => session.id)),
    [groups],
  );
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(active);
  const sessionListRef = useRef<HTMLDivElement | null>(null);
  const previousActiveRef = useRef<string | null>(active);

  useEffect(() => {
    if (active !== previousActiveRef.current) {
      previousActiveRef.current = active;
      if (active && displaySessionIds.includes(active)) setFocusedSessionId(active);
      return;
    }
    setFocusedSessionId((current) =>
      current && displaySessionIds.includes(current) ? current : (displaySessionIds[0] ?? null),
    );
  }, [active, displaySessionIds]);

  const focusSessionOption = (id: string) => {
    const option = Array.from(
      sessionListRef.current?.querySelectorAll<HTMLButtonElement>("[data-session-id]") ?? [],
    ).find((element) => element.dataset.sessionId === id);
    option?.focus();
  };

  const onSessionListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (displaySessionIds.length === 0) return;
    const target = event.target as HTMLElement;
    if (!target.closest("[data-session-id]")) return;

    const currentId =
      target.closest<HTMLElement>("[data-session-id]")?.dataset.sessionId ??
      focusedSessionId ??
      active ??
      displaySessionIds[0];
    const currentIndex = Math.max(0, displaySessionIds.indexOf(currentId));
    let nextId: string | null = null;

    if (event.key === "ArrowDown") {
      nextId = displaySessionIds[Math.min(currentIndex + 1, displaySessionIds.length - 1)];
    } else if (event.key === "ArrowUp") {
      nextId = displaySessionIds[Math.max(currentIndex - 1, 0)];
    } else if (event.key === "Home") {
      nextId = displaySessionIds[0];
    } else if (event.key === "End") {
      nextId = displaySessionIds[displaySessionIds.length - 1];
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setActive(currentId);
      return;
    } else {
      return;
    }

    event.preventDefault();
    setFocusedSessionId(nextId);
    window.requestAnimationFrame(() => focusSessionOption(nextId));
  };

  // Numeric hotkey hints (Cmd+1..9): map session.id → "1".."9" for the first 9
  // sessions in display order (unfiltered).
  const hotkeyIndex = useMemo(() => {
    const ordered = orderedSessions(sessions);
    const m = new Map<string, number>();
    ordered.slice(0, 9).forEach((s, i) => m.set(s.id, i + 1));
    return m;
  }, [sessions]);

  /** Recently-used cwds, deduped and ordered by latest session activity. */
  const recentCwds = useMemo(() => {
    const lastSeen = new Map<string, number>();
    for (const s of Object.values(sessions)) {
      if (!s.cwd) continue;
      const cur = lastSeen.get(s.cwd) ?? 0;
      if (s.updatedAt > cur) lastSeen.set(s.cwd, s.updatedAt);
    }
    return [...lastSeen.entries()].sort((a, b) => b[1] - a[1]).map(([cwd]) => cwd);
  }, [sessions]);

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
    <aside
      className="flex h-full shrink-0 flex-col border-r border-border bg-panel"
      style={{ width }}
    >
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <CwdCombobox
          value={cwdInput}
          onChange={setCwdInput}
          onSubmit={createSession}
          recents={recentCwds}
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
          aria-label="Search sessions"
          className="h-8 pl-7 text-xs"
        />
      </div>

      <ScrollArea className="flex-1">
        <div
          ref={sessionListRef}
          // biome-ignore lint/a11y/useSemanticElements: roving session buttons expose listbox semantics.
          role="listbox"
          aria-label="Sessions"
          tabIndex={-1}
          className="px-2 pb-3"
          onKeyDown={onSessionListKeyDown}
        >
          {groups.length === 0 && (
            <div className="px-2 py-8 text-center text-xs text-muted-foreground">
              No sessions yet.
              <br />
              Enter a path and hit <kbd className="rounded bg-muted px-1 py-0.5 text-[10px]">+</kbd>
              .
            </div>
          )}
          {groups.map(({ cwd, list }) => (
            <div key={cwd} className="mb-3">
              <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <FolderOpen className="h-3 w-3" />
                <span className="truncate" title={cwd}>
                  {cwd}
                </span>
              </div>
              <ul className="space-y-0.5" aria-label={cwd}>
                {list.map((s) => (
                  <SidebarSessionItem
                    key={s.id}
                    session={s}
                    isActive={s.id === active}
                    isFocused={s.id === focusedSessionId}
                    onFocus={() => setFocusedSessionId(s.id)}
                    onActivate={() => setActive(s.id)}
                    hotkey={hotkeyIndex.get(s.id)}
                  />
                ))}
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
      <Button
        variant="ghost"
        size="icon"
        onClick={onExpand}
        title="Expand sidebar (⌘\)"
        aria-label="Expand sidebar"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </aside>
  );
}

function SidebarSessionItem({
  session: s,
  isActive,
  isFocused,
  onFocus,
  onActivate,
  hotkey,
}: {
  session: SessionState;
  isActive: boolean;
  isFocused: boolean;
  onFocus: () => void;
  onActivate: () => void;
  hotkey?: number;
}) {
  const dot = statusToDot(s.status);
  const fanoutSelected = useUIStore((st) => st.fanoutSelection.includes(s.id));
  const anyFanoutSelected = useUIStore((st) => st.fanoutSelection.length > 0);
  const toggleFanout = useUIStore((st) => st.toggleFanoutSelection);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(s.title);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      setDraft(s.title);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }
  }, [editing, s.title]);

  const commit = () => {
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === s.title) return;
    sendWs({ type: "rename_session", sessionId: s.id, title: trimmed });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (!editing && e.key === "F2") {
      e.preventDefault();
      setEditing(true);
    }
  };

  return (
    <li
      className={cn("group/item relative", fanoutSelected && "bg-accent/5")}
      onKeyDown={onKeyDown}
    >
      {!editing && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleFanout(s.id);
          }}
          aria-pressed={fanoutSelected}
          aria-label={
            fanoutSelected
              ? `Remove ${s.title} from broadcast selection`
              : `Add ${s.title} to broadcast selection`
          }
          title={
            fanoutSelected
              ? "Remove from broadcast selection"
              : "Add to broadcast (multi-select to send the same prompt to many sessions)"
          }
          className={cn(
            "absolute left-0.5 top-1/2 z-10 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-sm border text-[10px]",
            fanoutSelected
              ? "border-accent bg-accent/40 text-accent-foreground opacity-100"
              : "border-border opacity-0 hover:bg-muted group-hover/item:opacity-60",
            anyFanoutSelected && !fanoutSelected && "opacity-40",
          )}
        >
          {fanoutSelected ? "✓" : ""}
        </button>
      )}
      {editing ? (
        <div className="flex w-full items-center gap-2 rounded-md bg-panel-elevated px-2 py-1">
          <StatusDot status={dot.status} pulse={dot.pulse} />
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
              }
            }}
            maxLength={200}
            className="flex-1 bg-transparent text-xs text-foreground outline-none"
          />
        </div>
      ) : (
        <button
          type="button"
          // biome-ignore lint/a11y/useSemanticElements: roving session button acts as a selectable listbox option.
          role="option"
          aria-selected={isActive}
          tabIndex={isFocused ? 0 : -1}
          data-session-id={s.id}
          onFocus={onFocus}
          onClick={onActivate}
          onDoubleClick={() => setEditing(true)}
          className={cn(
            "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 pr-12 text-left text-xs transition-colors",
            isActive
              ? "bg-panel-elevated text-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
            s.detached && !isActive && "opacity-60",
          )}
          title={
            s.detached
              ? "Detached — child exited; history is read-only (F2 to rename)"
              : "Double-click or F2 to rename"
          }
        >
          <StatusDot status={dot.status} pulse={dot.pulse} />
          <MessageSquare className="h-3 w-3 shrink-0 opacity-50" />
          <span className="flex-1 truncate">
            {s.title}
            {s.detached && (
              <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                detached
              </span>
            )}
          </span>
          {hotkey != null && (
            <kbd
              className="rounded bg-muted px-1 py-0.5 font-mono text-[9px] text-muted-foreground"
              title={`⌘${hotkey} to switch`}
            >
              ⌘{hotkey}
            </kbd>
          )}
          {isActive && <ChevronRight className="h-3 w-3 opacity-60" />}
        </button>
      )}
      {!editing && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(true);
            }}
            className="absolute right-7 top-1/2 hidden -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground group-hover/item:block"
            title="Rename session"
            aria-label={`Rename ${s.title}`}
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation();
              const ok = await confirmDialog({
                title: "Delete session?",
                description: `“${s.title}” and its full history will be removed. This cannot be undone.`,
                confirmLabel: "Delete",
                tone: "danger",
              });
              if (!ok) return;
              sendWs({ type: "delete_session", sessionId: s.id });
              useUIStore.getState().removeSession(s.id);
            }}
            className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive group-hover/item:block"
            title="Delete session"
            aria-label={`Delete ${s.title}`}
          >
            <Trash2 className="h-3 w-3" />
          </button>
          {s.detached && (
            <button
              type="button"
              disabled={!!s.reattaching}
              onClick={(e) => {
                e.stopPropagation();
                if (s.reattaching) return;
                useUIStore.getState().setReattaching(s.id, true);
                sendWs({ type: "reattach_session", sessionId: s.id });
                window.setTimeout(() => {
                  const cur = useUIStore.getState().sessions[s.id];
                  if (cur?.reattaching) useUIStore.getState().setReattaching(s.id, false);
                }, 15_000);
              }}
              className="absolute right-12 top-1/2 hidden -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-warn/20 hover:text-warn group-hover/item:block disabled:opacity-60"
              title={s.reattaching ? "Reattaching…" : "Reattach session"}
              aria-label={s.reattaching ? `Reattaching ${s.title}` : `Reattach ${s.title}`}
            >
              <RotateCcw className={cn("h-3 w-3", s.reattaching && "animate-spin")} />
            </button>
          )}
        </>
      )}
    </li>
  );
}
