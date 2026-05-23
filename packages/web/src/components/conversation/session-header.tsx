import { Copy, Cpu, Download, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { sendWs } from "../../lib/ws-client";
import { type SessionState, useUIStore } from "../../stores/ui-store";
import { confirmDialog } from "../overlays/confirm-dialog";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { StatusDot } from "../ui/status-dot";
import { ModeSelector } from "./mode-selector";
import { RenameDialog } from "./rename-dialog";

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

function exportSession(id: string, format: "md" | "json") {
  const url = `/api/sessions/${encodeURIComponent(id)}/export?format=${format}`;
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function SessionHeader({ session }: { session: SessionState }) {
  const st = statusLabel(session.status);
  const models = useUIStore((s) => s.models);
  const defaultModel = useUIStore((s) => s.defaultModel);
  const modelByCwd = useUIStore((s) => s.modelByCwd);
  const setPickerOpen = useUIStore((s) => s.setModelPickerOpen);
  const removeSession = useUIStore((s) => s.removeSession);
  const currentModelId = modelByCwd[session.cwd] ?? defaultModel ?? "";
  const currentModel = models.find((m) => m.id === currentModelId);
  const modelLabel = currentModel?.label ?? currentModelId.split(":")[0] ?? "model";

  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const close = () => setMenuOpen(false);

  const onRename = () => {
    close();
    setRenameOpen(true);
  };
  const onDuplicate = () => {
    close();
    sendWs({ type: "duplicate_session", sessionId: session.id });
  };
  const onExportMd = () => {
    close();
    exportSession(session.id, "md");
  };
  const onExportJson = () => {
    close();
    exportSession(session.id, "json");
  };
  const onDelete = async () => {
    close();
    const ok = await confirmDialog({
      title: "Delete session?",
      description: `“${session.title || "Untitled"}” and its full history will be removed.`,
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    sendWs({ type: "delete_session", sessionId: session.id });
    removeSession(session.id);
  };

  return (
    <div className="flex items-center justify-between border-b border-border bg-panel/50 px-4 py-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2
              className="truncate text-sm font-semibold text-foreground"
              title="Double-click to rename"
              onDoubleClick={() => setRenameOpen(true)}
            >
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
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Session actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-48 p-1">
            <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} label="Rename" onClick={onRename} />
            <MenuItem
              icon={<Copy className="h-3.5 w-3.5" />}
              label="Duplicate (new session)"
              onClick={onDuplicate}
            />
            <div className="my-1 h-px bg-border" />
            <MenuItem
              icon={<Download className="h-3.5 w-3.5" />}
              label="Export markdown"
              onClick={onExportMd}
            />
            <MenuItem
              icon={<Download className="h-3.5 w-3.5" />}
              label="Export JSON"
              onClick={onExportJson}
            />
            <div className="my-1 h-px bg-border" />
            <MenuItem
              icon={<Trash2 className="h-3.5 w-3.5" />}
              label="Delete"
              onClick={onDelete}
              danger
            />
          </PopoverContent>
        </Popover>
      </div>
      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        sessionId={session.id}
        initialTitle={session.title}
      />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        danger
          ? "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-destructive hover:bg-destructive/15"
          : "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
      }
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}
