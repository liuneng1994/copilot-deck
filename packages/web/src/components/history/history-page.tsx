import { ArrowRight, History, Loader2, RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { useUIStore } from "../../stores/ui-store";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

interface HistorySessionSummary {
  id: string;
  cwd: string | null;
  repository: string | null;
  branch: string | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
}

interface HistoryTurn {
  index: number;
  userMessage: string | null;
  assistantResponse: string | null;
  timestamp: string;
}

interface HistorySessionDetail extends HistorySessionSummary {
  turns: HistoryTurn[];
}

export function HistoryPage() {
  const setTopView = useUIStore((s) => s.setTopView);
  const setActive = useUIStore((s) => s.setActiveSession);
  const setNotice = useUIStore((s) => s.setNotice);

  const [available, setAvailable] = useState(true);
  const [sessions, setSessions] = useState<HistorySessionSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [cwdFilter, setCwdFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HistorySessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [resuming, setResuming] = useState(false);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (cwdFilter.trim()) params.set("cwd", cwdFilter.trim());
      params.set("limit", "200");
      const res = await fetch(`/api/copilot-history/sessions?${params}`);
      const data = (await res.json()) as {
        available: boolean;
        sessions: HistorySessionSummary[];
      };
      setAvailable(data.available);
      setSessions(data.sessions ?? []);
    } catch (err) {
      setNotice({
        id: `hist-${Date.now()}`,
        kind: "warn",
        text: `Failed to load Copilot history: ${(err as Error).message}`,
        ts: Date.now(),
      });
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [q, cwdFilter, setNotice]);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    let cancelled = false;
    void fetch(`/api/copilot-history/sessions/${selectedId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: HistorySessionDetail) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err: Error) => {
        if (!cancelled)
          setNotice({
            id: `hist-d-${Date.now()}`,
            kind: "warn",
            text: `Could not load session: ${err.message}`,
            ts: Date.now(),
          });
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, setNotice]);

  const onResume = async () => {
    if (!detail || resuming) return;
    if (!detail.cwd) {
      setNotice({
        id: `hist-r-${Date.now()}`,
        kind: "warn",
        text: "This session has no recorded cwd — cannot resume.",
        ts: Date.now(),
      });
      return;
    }
    setResuming(true);
    try {
      const res = await fetch("/api/copilot-history/resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ externalSessionId: detail.id, cwd: detail.cwd }),
      });
      const data = (await res.json()) as { sessionId?: string; error?: string };
      if (!res.ok || !data.sessionId) throw new Error(data.error ?? `HTTP ${res.status}`);
      window.setTimeout(() => {
        setActive(data.sessionId ?? null);
        setTopView("workspace");
      }, 250);
      setNotice({
        id: `hist-ok-${Date.now()}`,
        kind: "info",
        text: "Resumed Copilot session.",
        ts: Date.now(),
      });
    } catch (err) {
      setNotice({
        id: `hist-err-${Date.now()}`,
        kind: "warn",
        text: `Resume failed: ${(err as Error).message}`,
        ts: Date.now(),
      });
    } finally {
      setResuming(false);
    }
  };

  const groups = useMemo(() => {
    if (!sessions) return [];
    const byCwd = new Map<string, HistorySessionSummary[]>();
    for (const s of sessions) {
      const key = s.cwd ?? "(no cwd)";
      const arr = byCwd.get(key) ?? [];
      arr.push(s);
      byCwd.set(key, arr);
    }
    return Array.from(byCwd.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([cwd, list]) => ({ cwd, sessions: list }));
  }, [sessions]);

  return (
    <div className="flex h-full min-h-0 w-full">
      <div className="flex w-[420px] shrink-0 flex-col border-r border-border bg-panel">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Copilot CLI History</span>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {sessions ? `${sessions.length} sessions` : "…"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => void fetchSessions()}
            title="Refresh"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          </Button>
        </div>
        <div className="flex flex-col gap-1.5 border-b border-border px-3 py-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search summary / cwd / repo"
              className="h-7 pl-7 text-xs"
            />
          </div>
          <Input
            value={cwdFilter}
            onChange={(e) => setCwdFilter(e.target.value)}
            placeholder="Filter cwd (exact)"
            className="h-7 text-xs"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!available && (
            <div className="p-6 text-center text-xs text-muted-foreground">
              <p>Copilot CLI database not found at</p>
              <code className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5">
                ~/.copilot/session-store.db
              </code>
              <p className="mt-2">Run Copilot CLI at least once to populate it.</p>
            </div>
          )}
          {available && sessions && sessions.length === 0 && (
            <div className="p-6 text-center text-xs text-muted-foreground">No sessions match.</div>
          )}
          {available &&
            groups.map((g) => (
              <div key={g.cwd}>
                <div
                  className="sticky top-0 z-10 truncate border-b border-border bg-panel-elevated px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                  title={g.cwd}
                >
                  {g.cwd}
                </div>
                {g.sessions.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    className={cn(
                      "block w-full border-b border-border/40 px-3 py-2 text-left transition-colors hover:bg-muted",
                      selectedId === s.id && "bg-primary/10 hover:bg-primary/15",
                    )}
                  >
                    <div className="line-clamp-2 text-xs text-foreground">
                      {s.summary || (
                        <span className="italic text-muted-foreground">(no summary)</span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>
                        {s.turnCount} turn{s.turnCount === 1 ? "" : "s"}
                      </span>
                      <span>·</span>
                      <span>{formatTs(s.updatedAt)}</span>
                    </div>
                  </button>
                ))}
              </div>
            ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col bg-background">
        {!selectedId && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <History className="h-8 w-8 opacity-50" />
            <p>Select a session on the left to preview its conversation.</p>
            <p className="text-xs">Then use "Resume" to import and continue chatting.</p>
          </div>
        )}
        {selectedId && (
          <>
            <div className="flex items-start justify-between gap-3 border-b border-border bg-panel px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {detail?.summary || "(no summary)"}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <code className="rounded bg-muted px-1.5 py-0.5">{detail?.cwd ?? "—"}</code>
                  {detail?.repository && <span>repo: {detail.repository}</span>}
                  {detail?.branch && <span>branch: {detail.branch}</span>}
                  <span>{detail ? `${detail.turnCount} turns` : ""}</span>
                  <span>{detail ? formatTs(detail.updatedAt) : ""}</span>
                </div>
              </div>
              <Button
                size="sm"
                onClick={onResume}
                disabled={!detail || resuming || !detail.cwd}
                className="gap-1.5"
              >
                {resuming ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowRight className="h-3.5 w-3.5" />
                )}
                {resuming ? "Resuming…" : "Resume"}
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {detailLoading && !detail && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading…
                </div>
              )}
              {detail && detail.turns.length === 0 && (
                <div className="text-xs text-muted-foreground">
                  This session has no turns recorded.
                </div>
              )}
              {detail?.turns.map((t) => (
                <div key={t.index} className="mb-4 space-y-2">
                  {t.userMessage && (
                    <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
                      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                        you · turn {t.index + 1}
                      </div>
                      <pre className="whitespace-pre-wrap font-sans text-xs text-foreground">
                        {t.userMessage}
                      </pre>
                    </div>
                  )}
                  {t.assistantResponse && (
                    <div className="rounded-lg border border-border bg-panel-elevated px-3 py-2">
                      <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                        agent
                      </div>
                      <pre className="whitespace-pre-wrap font-sans text-xs text-foreground">
                        {t.assistantResponse}
                      </pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const ms = Date.now() - d.getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return d.toLocaleString();
}
