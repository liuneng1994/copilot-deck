import { Bell, Bug } from "lucide-react";
import { StatusDot } from "../ui/status-dot";
import { useUIStore } from "../../stores/ui-store";

export function StatusBar() {
  const wsConnected = useUIStore((s) => s.wsConnected);
  const session = useUIStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null,
  );

  const shortId = session ? session.id.slice(0, 8) : "—";

  return (
    <footer className="flex h-6 items-center justify-between border-t border-border bg-panel px-3 text-[11px] text-muted-foreground">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5">
          <StatusDot status={wsConnected ? "ok" : "err"} pulse={wsConnected} />
          ws
        </span>
        <span className="flex items-center gap-1.5">
          <StatusDot status={session ? "ok" : "muted"} />
          copilot
        </span>
        <span
          className="cursor-pointer font-mono hover:text-foreground"
          onClick={() => session && navigator.clipboard.writeText(session.id)}
          title={session ? `${session.id} — click to copy` : ""}
        >
          sess {shortId}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span title="Context window usage (todo)">ctx —</span>
        <button
          className="flex items-center gap-1 hover:text-foreground"
          title="JSON-RPC trace (M4)"
        >
          <Bug className="h-3 w-3" />
          trace
        </button>
        <button
          className="flex items-center gap-1 hover:text-foreground"
          title="Pending permission requests (M2)"
        >
          <Bell className="h-3 w-3" />0
        </button>
      </div>
    </footer>
  );
}
