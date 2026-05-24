import type { FileEntry } from "@agent-view/shared";
import { Check, ExternalLink, RotateCcw } from "lucide-react";
import { useState } from "react";
import { type SessionState, useUIStore } from "../../../stores/ui-store";

interface FileActionsProps {
  entry: FileEntry;
  session: SessionState;
  onChanged?: () => void;
}

function showNotice(kind: "info" | "warn", text: string) {
  useUIStore.getState().setNotice({ id: `file-action-${Date.now()}`, kind, text, ts: Date.now() });
}

export function FileActions({ entry, session, onChanged }: FileActionsProps) {
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [busy, setBusy] = useState(false);
  const markReviewed = useUIStore((s) => s.markReviewed);
  const isReviewed = useUIStore((s) => s.reviewed[session.id]?.has(entry.path) ?? false);
  const canRestore = entry.source === "dirty" || entry.source === "untracked";
  const isUntracked = entry.source === "untracked";
  const labelPath = entry.rel || entry.path;

  function review() {
    markReviewed(session.id, entry.path, true);
    showNotice("info", `Marked ${labelPath} reviewed.`);
  }

  async function restore() {
    setBusy(true);
    try {
      const response = await fetch("/api/git/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: session.cwd, paths: [entry.path] }),
      });
      if (!response.ok) throw new Error(await response.text());
      setConfirmRestore(false);
      showNotice("info", `Restored ${labelPath}.`);
      await useUIStore.getState().loadFilesOverview(session.cwd);
      onChanged?.();
    } catch (error) {
      showNotice(
        "warn",
        `Restore failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  function openInEditor() {
    void fetch(
      `/api/open-in-editor?path=${encodeURIComponent(entry.path)}&cwd=${encodeURIComponent(session.cwd)}`,
      { method: "POST" },
    );
  }

  return (
    <>
      <div className="flex items-center gap-1 opacity-80 transition-opacity group-hover:opacity-100 hover:opacity-100">
        {canRestore && (
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            title={isUntracked ? "Delete untracked file" : "Restore file"}
            disabled={busy}
            onClick={() => setConfirmRestore(true)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          className={`rounded p-1 hover:bg-muted ${
            isReviewed ? "text-emerald-400" : "text-muted-foreground hover:text-foreground"
          }`}
          title={isReviewed ? "Reviewed" : "Mark reviewed"}
          onClick={review}
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Open in editor"
          onClick={openInEditor}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>
      {confirmRestore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 p-4">
          <div className="w-full max-w-sm rounded-lg border border-border bg-background p-4 shadow-xl">
            <h3
              className={`text-sm font-semibold ${isUntracked ? "text-destructive" : "text-foreground"}`}
            >
              {isUntracked ? "Delete untracked file?" : "Restore file?"}
            </h3>
            <p className="mt-2 text-xs text-muted-foreground">
              {isUntracked
                ? "This will permanently delete the untracked file from disk."
                : "This will discard working tree changes for this file."}
            </p>
            <div
              className="mt-3 truncate rounded border border-border bg-muted/30 p-2 text-[11px] text-foreground"
              title={entry.path}
            >
              {labelPath}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
                disabled={busy}
                onClick={() => setConfirmRestore(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                disabled={busy}
                onClick={() => void restore()}
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
