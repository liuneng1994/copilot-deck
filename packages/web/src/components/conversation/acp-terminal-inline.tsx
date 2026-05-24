import { ArrowDownToLine, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { sendWs } from "../../lib/ws-client";
import { useUIStore } from "../../stores/ui-store";
import { TerminalBlock } from "./tool-content";

/**
 * Live view of an ACP-extension terminal owned by ProcessHost on the server.
 * Mirrors `bg_task_*` snapshots from the store and shows a "Move to background"
 * affordance after a short delay so long-running commands (dev servers, watch
 * tasks) don't block the conversation visually.
 */
export function AcpTerminalInline({
  terminalId,
  fallbackText,
}: {
  terminalId: string;
  fallbackText?: string;
}) {
  // The server links ACP terminals to BgTaskSnapshots via `acpTerminalId`.
  const task = useUIStore((s) =>
    Object.values(s.bgTasks).find((t) => t.acpTerminalId === terminalId),
  );
  const [showHint, setShowHint] = useState(false);

  // Highlight the "Move to background" button after 3s so users discover it.
  useEffect(() => {
    if (!task) return;
    if (task.mode === "background" || task.status === "exited") return;
    const id = window.setTimeout(() => setShowHint(true), 3000);
    return () => window.clearTimeout(id);
  }, [task]);

  const text = useMemo(() => task?.outputTail ?? fallbackText ?? "", [task, fallbackText]);
  const running = task?.status === "running" || (!task && !fallbackText);

  if (task?.mode === "background") {
    return (
      <div className="my-1 rounded border border-dashed border-border bg-panel-elevated px-2 py-1.5 text-[11px] text-muted-foreground">
        <span className="font-mono">[deck]</span> Moved to background as task #{task.id.slice(0, 6)}
        . Output continues in the Tasks tab.
      </div>
    );
  }

  return (
    <div className="my-1 overflow-hidden rounded border border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border bg-panel-elevated px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {running ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
        )}
        <span>terminal</span>
        {task?.id && (
          <span className="font-mono text-muted-foreground/70">#{task.id.slice(0, 6)}</span>
        )}
        <span className="ml-auto" />
        {task && task.mode === "foreground" && task.status === "running" && (
          <button
            type="button"
            onClick={() => sendWs({ type: "terminal_move_to_background", taskId: task.id })}
            className={`flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] transition ${
              showHint
                ? "border-warning/60 bg-warning/15 text-warning"
                : "border-border bg-panel hover:bg-muted/40"
            }`}
            title="Detach this process so it keeps running in the Tasks tab without blocking the turn."
          >
            <ArrowDownToLine className="h-3 w-3" />
            Move to background
          </button>
        )}
      </div>
      <TerminalBlock text={text} />
    </div>
  );
}
