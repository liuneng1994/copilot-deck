import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useUIStore } from "../../stores/ui-store";

function fmtTs(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
}

export function TraceDrawer() {
  const open = useUIStore((s) => s.traceDrawerOpen);
  const setOpen = useUIStore((s) => s.setTraceDrawerOpen);
  const trace = useUIStore((s) => s.trace);
  const filters = useUIStore((s) => s.traceFilters);
  const setFilters = useUIStore((s) => s.setTraceFilters);
  const activeSessionId = useUIStore((s) => s.activeSessionId);
  const clearTrace = useUIStore((s) => s.clearTrace);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  // Auto-scroll to the bottom of the trace list as new events arrive.
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [trace, open]);

  // On first open, fetch the recent slice from the server in case we missed older events.
  const fetched = useRef(false);
  useEffect(() => {
    if (!open || fetched.current) return;
    fetched.current = true;
    fetch(`/api/trace?limit=200`)
      .then((r) => r.json() as Promise<{ events: typeof trace }>)
      .then((j) => useUIStore.getState().setTrace(j.events))
      .catch(() => undefined);
  }, [open]);

  const filtered = useMemo(() => {
    return trace.filter((ev) => {
      if (filters.direction && ev.direction !== filters.direction) return false;
      if (filters.sessionScope && activeSessionId && ev.sessionId && ev.sessionId !== activeSessionId)
        return false;
      return true;
    });
  }, [trace, filters, activeSessionId]);

  if (!open) return null;

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-[640px] max-w-[90vw] flex-col border-l border-border bg-panel text-foreground shadow-2xl">
      <header className="flex items-center justify-between border-b border-border px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium">Trace</span>
          <span className="text-xs text-muted-foreground">{filtered.length} / {trace.length}</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={filters.sessionScope}
              onChange={(e) => setFilters({ sessionScope: e.target.checked })}
            />
            session
          </label>
          <select
            className="rounded border border-border bg-bg px-1 py-0.5 text-xs"
            value={filters.direction ?? ""}
            onChange={(e) =>
              setFilters({ direction: (e.target.value || undefined) as "in" | "out" | undefined })
            }
          >
            <option value="">all</option>
            <option value="in">incoming</option>
            <option value="out">outgoing</option>
          </select>
          <button className="rounded border border-border px-2 py-0.5 text-xs hover:bg-bg" onClick={clearTrace}>
            clear
          </button>
          <button className="text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>
      <div ref={listRef} className="flex-1 overflow-y-auto font-mono text-[11px]">
        {filtered.length === 0 ? (
          <div className="p-3 text-muted-foreground">No events yet.</div>
        ) : (
          filtered.map((ev) => {
            const isExpanded = !!expanded[ev.id];
            return (
              <div key={ev.id} className="border-b border-border/50 px-2 py-1">
                <button
                  className="flex w-full items-center gap-2 text-left hover:bg-bg/40"
                  onClick={() => setExpanded((m) => ({ ...m, [ev.id]: !m[ev.id] }))}
                >
                  <span className="text-muted-foreground">{fmtTs(ev.ts)}</span>
                  {ev.direction === "in" ? (
                    <ArrowDown className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <ArrowUp className="h-3 w-3 text-sky-400" />
                  )}
                  <span className="font-medium">{ev.kind}</span>
                  {ev.sessionId && (
                    <span className="text-muted-foreground">· {ev.sessionId.slice(0, 8)}</span>
                  )}
                </button>
                {isExpanded && (
                  <pre className="mt-1 max-h-[280px] overflow-auto rounded bg-bg/50 p-2 text-[10px] leading-snug">
                    {JSON.stringify(ev.payload, null, 2)}
                  </pre>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
