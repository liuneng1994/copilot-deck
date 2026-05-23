import type { GrepHit } from "@agent-view/shared";
import { type FormEvent, useMemo, useState } from "react";
import { useUIStore } from "../../../stores/ui-store";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";

interface GrepPanelProps {
  cwd: string;
}

interface GrepGroup {
  path: string;
  hits: GrepHit[];
}

function parseGlobs(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function formatElapsed(startedAt: number | null): string | null {
  if (!startedAt) return null;
  const seconds = (Date.now() - startedAt) / 1000;
  return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

export function GrepPanel({ cwd }: GrepPanelProps) {
  const [pattern, setPattern] = useState("");
  const [globs, setGlobs] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [currentOpId, setCurrentOpId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const grepOps = useUIStore((s) => s.grepOps);
  const setSelectedFilePath = useUIStore((s) => s.setSelectedFilePath);
  const currentOp = currentOpId ? grepOps[currentOpId] : undefined;
  const hits = currentOp?.hits ?? [];
  const inFlight = Boolean(currentOpId && !currentOp?.done);

  const groups = useMemo<GrepGroup[]>(() => {
    const byPath = new Map<string, GrepHit[]>();
    for (const hit of hits) {
      const pathHits = byPath.get(hit.path);
      if (pathHits) pathHits.push(hit);
      else byPath.set(hit.path, [hit]);
    }
    return [...byPath.entries()]
      .map(([path, pathHits]) => ({
        path,
        hits: [...pathHits].sort((a, b) => a.line - b.line || a.col - b.col),
      }))
      .sort((a, b) => b.hits.length - a.hits.length || a.path.localeCompare(b.path));
  }, [hits]);

  async function cancelOp(opId: string): Promise<void> {
    try {
      await fetch(`/api/grep/${encodeURIComponent(opId)}/cancel`, { method: "POST" });
    } catch {
      // The grep runner may already have completed; the done message will reconcile state.
    }
  }

  async function handleSubmit(event?: FormEvent): Promise<void> {
    event?.preventDefault();
    const q = pattern.trim();
    if (!q || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    if (currentOpId && !grepOps[currentOpId]?.done) await cancelOp(currentOpId);

    try {
      const response = await fetch("/api/grep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, q, globs: parseGlobs(globs), caseSensitive }),
      });
      if (!response.ok) throw new Error(`Search failed (${response.status})`);
      const data = (await response.json()) as { opId?: string };
      if (!data.opId) throw new Error("Search failed: missing operation id");
      setCurrentOpId(data.opId);
      setStartedAt(Date.now());
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Search failed");
    } finally {
      setSubmitting(false);
    }
  }

  function handleHitClick(hit: GrepHit): void {
    setSelectedFilePath(hit.path);
    window.requestAnimationFrame(() => {
      const target =
        document.getElementById(`L${hit.line}`) ?? document.getElementById(`line-${hit.line}`);
      target?.scrollIntoView({ block: "center" });
    });
  }

  const elapsed = formatElapsed(startedAt);
  const error = submitError ?? currentOp?.error;
  const status = currentOpId
    ? currentOp?.done
      ? `Results: ${plural(hits.length, "hit")} in ${plural(groups.length, "file")}${elapsed ? ` (${elapsed})` : ""}`
      : "Searching…"
    : "Type a pattern and press Enter to search";

  return (
    <section className="flex h-full flex-col text-xs">
      <form className="border-b border-border p-3" onSubmit={handleSubmit}>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Search
        </div>
        <div className="grid gap-2">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(140px,0.6fr)]">
            <Input
              aria-label="Search pattern"
              className="h-8 text-xs"
              placeholder="pattern"
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
            />
            <Input
              aria-label="Glob filters"
              className="h-8 text-xs"
              placeholder="globs (optional)"
              value={globs}
              onChange={(event) => setGlobs(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <input
                className="h-3.5 w-3.5 accent-primary"
                type="checkbox"
                checked={caseSensitive}
                onChange={(event) => setCaseSensitive(event.target.checked)}
              />
              case-sensitive
            </label>
            <Button size="sm" type="submit" disabled={!pattern.trim() || submitting}>
              {submitting ? "Starting…" : "Search"}
            </Button>
            {inFlight && currentOpId && (
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={() => void cancelOp(currentOpId)}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      </form>

      <div className="flex-1 overflow-auto p-3">
        <div className="mb-3 text-[11px] text-muted-foreground">{status}</div>
        {error && (
          <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
            {error}
          </div>
        )}
        {currentOp?.done && hits.length === 0 && !error ? (
          <div className="text-[11px] text-muted-foreground">No matches</div>
        ) : (
          <div className="space-y-2">
            {currentOp?.truncated && (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                Results were truncated. Narrow the pattern or globs for more matches.
              </div>
            )}
            {groups.map((group) => (
              <details key={group.path} className="group rounded-md border border-border/70" open>
                <summary className="cursor-pointer select-none px-2 py-1.5 font-medium hover:bg-muted/60">
                  <span className="mr-1 text-muted-foreground group-open:hidden">▸</span>
                  <span className="mr-1 hidden text-muted-foreground group-open:inline">▾</span>
                  {group.path} <span className="text-muted-foreground">({group.hits.length})</span>
                </summary>
                <div className="border-t border-border/60 py-1 font-mono text-[11px]">
                  {group.hits.map((hit, index) => (
                    <button
                      key={`${hit.path}:${hit.line}:${hit.col}:${index}`}
                      className="grid w-full grid-cols-[3.5rem_minmax(0,1fr)] gap-2 px-2 py-0.5 text-left hover:bg-muted/70"
                      type="button"
                      onClick={() => handleHitClick(hit)}
                    >
                      <span className="select-none text-right text-muted-foreground">
                        {hit.line}
                      </span>
                      <span className="min-w-0 whitespace-pre-wrap break-words">
                        {hit.before}
                        <mark className="rounded bg-amber-500/30 px-0.5 text-amber-100">
                          {hit.match}
                        </mark>
                        {hit.after}
                      </span>
                    </button>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
