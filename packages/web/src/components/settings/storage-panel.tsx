import type { PruneRequest, PruneResult, StorageStats } from "@agent-view/shared";
import { Database, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

type ApiError = { error?: string };

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(ts: number | null): string {
  if (!ts) return "No activity yet";
  return new Date(ts).toLocaleString();
}

function summarize(result: PruneResult, dryRun: boolean): string {
  const prefix = dryRun ? "Preview" : "Cleanup complete";
  return `${prefix}: ${result.deletedTraceEvents.toLocaleString()} trace events, ${result.deletedSessions.toLocaleString()} sessions${dryRun ? " would be deleted" : " deleted"}. Freed ${formatBytes(result.freedBytes)}.`;
}

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as T & ApiError;
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}

export function StoragePanel() {
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [olderThanDays, setOlderThanDays] = useState(30);
  const [pruneSessions, setPruneSessions] = useState(false);
  const [busy, setBusy] = useState<"stats" | "preview" | "prune" | "vacuum" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setBusy((current) => current ?? "stats");
    setError(null);
    try {
      const response = await fetch("/api/storage/stats");
      setStats(await readJson<StorageStats>(response));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy((current) => (current === "stats" ? null : current));
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const request: PruneRequest = { olderThanDays, pruneSessions };
  const disabled = busy !== null;

  const preview = async () => {
    setBusy("preview");
    setError(null);
    setMessage(null);
    try {
      const params = new URLSearchParams({
        olderThanDays: String(request.olderThanDays),
        pruneSessions: String(request.pruneSessions),
        dryRun: "true",
      });
      const response = await fetch(`/api/storage/prune?${params.toString()}`);
      const result = await readJson<PruneResult>(response);
      setMessage(summarize(result, true));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const runCleanup = async () => {
    if (!window.confirm(`Delete data older than ${olderThanDays} days?`)) return;
    setBusy("prune");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/storage/prune", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const result = await readJson<PruneResult>(response);
      setMessage(summarize(result, false));
      await loadStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const runVacuum = async () => {
    if (!window.confirm("Vacuum the SQLite database to reclaim unused disk space?")) return;
    setBusy("vacuum");
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/storage/vacuum", { method: "POST" });
      const result = await readJson<{ freedBytes: number }>(response);
      setMessage(`Vacuum complete: reclaimed ${formatBytes(result.freedBytes)}.`);
      await loadStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-panel p-3">
        <div>
          <h2 className="text-base font-semibold">Storage</h2>
          <p className="text-xs text-muted-foreground">
            Inspect SQLite usage, prune old trace data, and reclaim disk space.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={loadStats}>
          <RefreshCw className={cn("h-3.5 w-3.5", busy === "stats" && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-foreground">
          {message}
        </div>
      ) : null}

      <section className="grid gap-2 rounded-lg border border-border bg-panel p-3 text-sm">
        <div className="flex items-center gap-2 font-semibold">
          <Database className="h-4 w-4" /> Current database
        </div>
        {stats ? (
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <Stat label="Size" value={formatBytes(stats.dbSizeBytes)} />
            <Stat label="Sessions" value={stats.sessionCount.toLocaleString()} />
            <Stat label="Trace events" value={stats.traceEventCount.toLocaleString()} />
            <Stat label="Oldest activity" value={formatDate(stats.oldestActivityAt)} />
            <div className="min-w-0 sm:col-span-2">
              <div className="text-muted-foreground">Path</div>
              <code className="mt-1 block truncate rounded bg-muted px-2 py-1 font-mono text-[11px]">
                {stats.dbPath}
              </code>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading storage stats…
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-panel p-3">
        <div>
          <h3 className="text-sm font-semibold">Prune old data</h3>
          <p className="text-xs text-muted-foreground">
            Trace events are deleted by default. Session rows are only removed when enabled below.
          </p>
        </div>
        <div className="grid gap-1 text-xs font-medium text-muted-foreground">
          <label htmlFor="storage-prune-days">Delete data older than</label>
          <div className="flex items-center gap-2 text-foreground">
            <Input
              id="storage-prune-days"
              type="number"
              min={1}
              max={365}
              value={olderThanDays}
              onChange={(event) => setOlderThanDays(Number(event.target.value))}
              className="w-28"
            />
            days
          </div>
        </div>
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={pruneSessions}
            onChange={(event) => setPruneSessions(event.target.checked)}
            className="mt-0.5"
          />
          <span>Also delete sessions, not just trace events</span>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={preview}>
            {busy === "preview" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Preview
          </Button>
          <Button type="button" size="sm" disabled={disabled} onClick={runCleanup}>
            {busy === "prune" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            Run cleanup
          </Button>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-panel p-3">
        <div>
          <h3 className="text-sm font-semibold">Vacuum database</h3>
          <p className="text-xs text-muted-foreground">
            Rewrites the SQLite file so disk space from prior deletes is returned to the OS.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={runVacuum}>
          {busy === "vacuum" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Vacuum database
        </Button>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-1 font-medium text-foreground">{value}</div>
    </div>
  );
}
