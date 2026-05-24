import type { FileEntry, GitStatus } from "@agent-view/shared";
import { useState } from "react";
import { useUIStore } from "../../../stores/ui-store";

interface GitBarProps {
  cwd: string;
  status?: GitStatus;
}

function showNotice(kind: "info" | "warn", text: string) {
  useUIStore.getState().setNotice({ id: `git-${Date.now()}`, kind, text, ts: Date.now() });
}

function displayPath(entry: FileEntry) {
  return entry.rel || entry.path;
}

export function GitBar({ cwd, status }: GitBarProps) {
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const overview = useUIStore((s) => s.filesOverview[cwd]);
  const touchedEntries = overview?.touched;
  const agentTouchedSet = new Set(overview?.agentTouched ?? []);
  // Subset of working-tree changes that the agent touched this session.
  const agentEntries = (touchedEntries ?? []).filter((entry) => agentTouchedSet.has(entry.rel));

  if (!status) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
        <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
        <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        <div className="ml-auto h-6 w-32 animate-pulse rounded bg-muted" />
        <div className="h-6 w-16 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  const dirtyCount = status.files.length;
  const untrackedCount = status.files.filter((file) => file.x === "?" || file.y === "?").length;
  const agentPaths = agentEntries.map((entry) => entry.path);
  const isRepo = status.isRepo !== false;

  async function restoreAgentChanges() {
    if (agentPaths.length === 0) return;
    setBusy(true);
    try {
      const response = await fetch("/api/git/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, paths: agentPaths }),
      });
      if (!response.ok) throw new Error(await response.text());
      setRestoreOpen(false);
      showNotice("info", `Restored ${agentPaths.length} agent-touched file(s).`);
      await useUIStore.getState().loadFilesOverview(cwd);
    } catch (error) {
      showNotice(
        "warn",
        `Restore failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function stashChanges() {
    const fallback = `Agent-view stash ${new Date().toISOString()}`;
    const message = window.prompt("Stash message", fallback);
    if (message === null) return;
    setBusy(true);
    try {
      const response = await fetch("/api/git/stash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, message: message.trim() || fallback }),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(text);
      showNotice("info", text || "Stashed working tree changes.");
      await useUIStore.getState().loadFilesOverview(cwd);
    } catch (error) {
      showNotice("warn", `Stash failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
        <button
          type="button"
          className="rounded-full border border-border bg-muted/60 px-2 py-0.5 font-medium text-foreground hover:bg-muted"
          onClick={() => undefined}
          title={isRepo ? "Current branch" : "This directory is not a git repository"}
        >
          {isRepo ? (status.branch ?? "detached") : "no git"}
        </button>
        {isRepo && status.ahead > 0 && (
          <span className="font-medium text-foreground">↑{status.ahead}</span>
        )}
        {isRepo && status.behind > 0 && (
          <span className="font-medium text-foreground">↓{status.behind}</span>
        )}
        <span className="text-muted-foreground">
          {isRepo
            ? `${dirtyCount} dirty · ${untrackedCount} untracked · ${agentEntries.length} agent`
            : `${agentEntries.length} agent-touched`}
        </span>
        {isRepo && (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              className="whitespace-nowrap rounded border border-border px-2 py-1 text-[11px] text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy || agentPaths.length === 0}
              onClick={() => setRestoreOpen(true)}
              title="Discard working-tree changes for agent-touched files"
            >
              Restore…
            </button>
            <button
              type="button"
              className="whitespace-nowrap rounded border border-border px-2 py-1 text-[11px] text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              disabled={busy || dirtyCount === 0}
              onClick={() => void stashChanges()}
              title="git stash all working-tree changes"
            >
              Stash…
            </button>
          </div>
        )}
      </div>
      {restoreOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-4 shadow-xl">
            <h3 className="text-sm font-semibold text-foreground">Restore agent changes?</h3>
            <p className="mt-2 text-xs text-muted-foreground">
              This will discard working tree changes for these agent-touched paths:
            </p>
            <ul className="mt-3 max-h-48 overflow-auto rounded border border-border bg-muted/30 p-2 text-[11px] text-foreground">
              {agentEntries.map((entry) => (
                <li key={entry.path} className="truncate py-0.5" title={entry.path}>
                  {displayPath(entry)}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                disabled={busy}
                onClick={() => setRestoreOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                disabled={busy}
                onClick={() => void restoreAgentChanges()}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
