import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "../../lib/focus-trap";
import { useUIStore } from "../../stores/ui-store";

function fmtTs(ts: number) {
  const d = new Date(ts);
  return `${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
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
  const [kind, setKind] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const drawerRef = useRef<HTMLDialogElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  useFocusTrap(drawerRef, open, { initialFocus: searchRef });

  // Distinct kinds present in the current trace buffer, used for the filter
  // dropdown. Re-computed on each trace update.
  const kinds = useMemo(() => {
    const set = new Set<string>();
    for (const ev of trace) set.add(ev.kind);
    return [...set].sort();
  }, [trace]);

  // Auto-scroll to the bottom of the trace list as new events arrive.
  const listRef = useRef<HTMLDivElement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every new trace event
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
    fetch("/api/trace?limit=200")
      .then((r) => r.json() as Promise<{ events: typeof trace }>)
      .then((j) => useUIStore.getState().setTrace(j.events))
      .catch(() => undefined);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return trace.filter((ev) => {
      if (filters.direction && ev.direction !== filters.direction) return false;
      if (
        filters.sessionScope &&
        activeSessionId &&
        ev.sessionId &&
        ev.sessionId !== activeSessionId
      )
        return false;
      if (kind && ev.kind !== kind) return false;
      if (q) {
        // Substring match against the kind + serialized payload. Keeps the
        // implementation dependency-free at the cost of stringifying once
        // per event; the trace buffer is bounded so this is acceptable.
        const haystack = `${ev.kind}\n${safeStringify(ev.payload)}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [trace, filters, activeSessionId, kind, query]);

  if (!open) return null;

  return (
    <dialog
      ref={drawerRef}
      open
      aria-modal="true"
      aria-labelledby="trace-title"
      className="fixed inset-y-0 right-0 z-40 ml-auto mr-0 flex h-dvh w-[640px] max-w-[90vw] flex-col border-l border-border bg-panel p-0 text-foreground shadow-2xl"
    >
      <header className="flex items-center justify-between border-b border-border px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <span id="trace-title" className="font-medium">
            Trace
          </span>
          <span className="text-xs text-muted-foreground">
            {filtered.length} / {trace.length}
          </span>
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
            <option value="">all dir</option>
            <option value="in">incoming</option>
            <option value="out">outgoing</option>
          </select>
          <select
            className="max-w-[120px] rounded border border-border bg-bg px-1 py-0.5 text-xs"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">all kinds</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded border border-border px-2 py-0.5 text-xs hover:bg-bg"
            onClick={clearTrace}
          >
            clear
          </button>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(false)}
            aria-label="Close trace drawer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>
      <div className="border-b border-border px-3 py-1.5">
        <input
          ref={searchRef}
          type="text"
          placeholder="Search kind or payload…"
          aria-label="Search trace events"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded border border-border bg-bg px-2 py-1 font-mono text-[11px] outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto font-mono text-[11px]">
        {filtered.length === 0 ? (
          <div className="p-3 text-muted-foreground">No events yet.</div>
        ) : (
          filtered.map((ev) => {
            const isExpanded = !!expanded[ev.id];
            return (
              <div key={ev.id} className="border-b border-border/50 px-2 py-1">
                <button
                  type="button"
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
    </dialog>
  );
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
