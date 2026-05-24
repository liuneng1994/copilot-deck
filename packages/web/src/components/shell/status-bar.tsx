import { AlertCircle, Bell, Bug, GitBranch } from "lucide-react";
import { useEffect, useState } from "react";
import { useUIStore } from "../../stores/ui-store";
import { StatusDot } from "../ui/status-dot";

interface GitInfo {
  repo: boolean;
  branch?: string;
  dirty?: boolean;
}

export function StatusBar() {
  const wsConnected = useUIStore((s) => s.wsConnected);
  const session = useUIStore((s) => (s.activeSessionId ? s.sessions[s.activeSessionId] : null));
  const pendingPerms = useUIStore((s) => s.permissionQueue.length);
  const [git, setGit] = useState<GitInfo | null>(null);

  useEffect(() => {
    setGit(null);
    if (!session?.cwd) return;
    let cancelled = false;
    void fetch(`/api/git-info?cwd=${encodeURIComponent(session.cwd)}`)
      .then((r) => r.json() as Promise<GitInfo>)
      .then((j) => {
        if (!cancelled) setGit(j);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session?.cwd]);

  const shortId = session ? session.id.slice(0, 8) : "—";
  const ctxLabel =
    session?.ctxUsed != null && session?.ctxTotal
      ? `${Math.round((session.ctxUsed / session.ctxTotal) * 100)}%`
      : session?.ctxUsed != null
        ? `${session.ctxUsed.toLocaleString()} tok`
        : null;

  const copilotOk = !!session && !session.crashed;

  return (
    <footer className="flex h-6 items-center justify-between border-t border-border bg-panel px-3 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <StatusDot status={wsConnected ? "ok" : "err"} pulse={wsConnected} />
          ws
        </span>
        <span className="flex items-center gap-1.5">
          <StatusDot
            status={!session ? "muted" : copilotOk ? "ok" : "err"}
            pulse={copilotOk && session?.status === "streaming"}
          />
          copilot
        </span>
        {session?.crashed && (
          <span className="flex items-center gap-1 text-rose-400" title="copilot child exited">
            <AlertCircle className="h-3 w-3" />
            crashed
          </span>
        )}
        {git?.repo && git.branch && (
          <span
            className="flex items-center gap-1"
            title={`git branch (${git.dirty ? "dirty" : "clean"})`}
          >
            <GitBranch className="h-3 w-3" />
            {git.branch}
            {git.dirty && <span className="text-amber-400">*</span>}
          </span>
        )}
        <button
          type="button"
          className="cursor-pointer font-mono hover:text-foreground"
          onClick={() => session && navigator.clipboard.writeText(session.id)}
          title={session ? `${session.id} — click to copy` : ""}
        >
          sess {shortId}
        </button>
      </div>
      <div className="flex items-center gap-3">
        {ctxLabel && <span title="Context window usage">ctx {ctxLabel}</span>}
        <button
          type="button"
          className="flex items-center gap-1 hover:text-foreground"
          title="JSON-RPC trace"
          onClick={() =>
            useUIStore.getState().setTraceDrawerOpen(!useUIStore.getState().traceDrawerOpen)
          }
        >
          <Bug className="h-3 w-3" />
          trace
        </button>
        <button
          type="button"
          className={
            pendingPerms > 0
              ? "flex items-center gap-1 text-amber-400 hover:text-amber-700 dark:text-amber-300"
              : "flex items-center gap-1 hover:text-foreground"
          }
          title={
            pendingPerms > 0
              ? `${pendingPerms} pending permission request${pendingPerms === 1 ? "" : "s"} — click to focus`
              : "No pending permissions"
          }
          onClick={() => {
            if (pendingPerms === 0) return;
            const dialog = document.querySelector("[data-permission-dialog]") as HTMLElement | null;
            if (!dialog) return;
            dialog.scrollIntoView({ behavior: "smooth", block: "center" });
            const btn = dialog.querySelector("button") as HTMLButtonElement | null;
            btn?.focus();
          }}
          disabled={pendingPerms === 0}
        >
          <Bell className="h-3 w-3" />
          {pendingPerms}
        </button>
      </div>
    </footer>
  );
}
