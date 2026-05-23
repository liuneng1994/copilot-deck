import { Cpu, MoreHorizontal } from "lucide-react";
import { type SessionState, useUIStore } from "../../stores/ui-store";
import { Button } from "../ui/button";
import { StatusDot } from "../ui/status-dot";
import { ModeSelector } from "./mode-selector";

function statusLabel(s: SessionState["status"]) {
  switch (s) {
    case "streaming":
      return { label: "streaming", dot: "ok" as const, pulse: true };
    case "awaiting_perm":
      return { label: "awaiting permission", dot: "warn" as const, pulse: true };
    case "error":
      return { label: "error", dot: "err" as const };
    default:
      return { label: "idle", dot: "muted" as const };
  }
}

export function SessionHeader({ session }: { session: SessionState }) {
  const st = statusLabel(session.status);
  const models = useUIStore((s) => s.models);
  const defaultModel = useUIStore((s) => s.defaultModel);
  const modelByCwd = useUIStore((s) => s.modelByCwd);
  const setPickerOpen = useUIStore((s) => s.setModelPickerOpen);
  const currentModelId = modelByCwd[session.cwd] ?? defaultModel ?? "";
  const currentModel = models.find((m) => m.id === currentModelId);
  const modelLabel = currentModel?.label ?? currentModelId.split(":")[0] ?? "model";

  return (
    <div className="flex items-center justify-between border-b border-border bg-panel/50 px-4 py-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-foreground">
              {session.title || "New session"}
            </h2>
            <span className="flex items-center gap-1 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              <StatusDot status={st.dot} pulse={st.pulse} />
              {st.label}
            </span>
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            {session.cwd}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          title={`Switch model — current: ${currentModelId || "(unset)"}`}
          className="flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Cpu className="h-3 w-3" />
          <span className="max-w-[160px] truncate font-mono">{modelLabel}</span>
        </button>
        <ModeSelector session={session} />
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
