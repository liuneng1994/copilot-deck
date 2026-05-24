import {
  AlertTriangle,
  Copy,
  Cpu,
  Download,
  FileCode2,
  Gauge,
  Loader2,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Trash2,
} from "lucide-react";
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
    case "reloading":
      return { label: "reloading…", dot: "warn" as const, pulse: true };
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
  const modelBySession = useUIStore((s) => s.modelBySession);
  const setPickerOpen = useUIStore((s) => s.setModelPickerOpen);
  const removeSession = useUIStore((s) => s.removeSession);
  const sessionOverrideId = modelBySession[session.id];
  const currentModelId = sessionOverrideId ?? modelByCwd[session.cwd] ?? defaultModel ?? "";
  const currentModel = models.find((m) => m.id === currentModelId);
  const modelLabel = currentModel?.label ?? currentModelId.split(":")[0] ?? "model";
  const isSessionOverride = !!sessionOverrideId;

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
    <>
      <ReloadSuggestionBanner session={session} />
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
          <UsageBadge session={session} />
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            title={`Switch model — current: ${currentModelId || "(unset)"}${isSessionOverride ? " (per-session override)" : ""}`}
            className="flex items-center gap-1.5 rounded border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Cpu className="h-3 w-3" />
            <span className="max-w-[160px] truncate font-mono">{modelLabel}</span>
            {isSessionOverride && (
              <span className="rounded bg-primary/15 px-1 py-0.5 text-[8px] font-medium uppercase tracking-wider text-primary">
                session
              </span>
            )}
          </button>
          <ModeSelector session={session} />
          <HintModeControl session={session} />
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Session actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-1">
              <MenuItem
                icon={<Pencil className="h-3.5 w-3.5" />}
                label="Rename"
                onClick={onRename}
              />
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
    </>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

function formatCost(amount: number, currency: string): string {
  const sym = currency === "USD" ? "$" : currency === "EUR" ? "€" : `${currency} `;
  if (amount < 0.01) return `${sym}<0.01`;
  if (amount < 1) return `${sym}${amount.toFixed(3)}`;
  return `${sym}${amount.toFixed(2)}`;
}

function UsageBadge({ session }: { session: SessionState }) {
  const used = session.ctxUsed;
  const total = session.ctxTotal;
  const cost = session.costAmount;
  const currency = session.costCurrency ?? "USD";
  if (typeof used !== "number" || typeof total !== "number" || total <= 0) {
    if (typeof cost === "number") {
      return (
        <span
          className="flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground"
          title={`Cumulative session cost: ${formatCost(cost, currency)}`}
        >
          <Gauge className="h-3 w-3" />
          <span className="font-mono">{formatCost(cost, currency)}</span>
        </span>
      );
    }
    return null;
  }
  const pct = Math.min(100, Math.max(0, (used / total) * 100));
  const tone =
    pct >= 90
      ? "text-red-600 dark:text-red-400"
      : pct >= 75
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";
  const title =
    `Context: ${formatTokens(used)} / ${formatTokens(total)} (${pct.toFixed(1)}%)` +
    (typeof cost === "number" ? ` · Cost: ${formatCost(cost, currency)}` : "");
  return (
    <span
      className={`flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] ${tone}`}
      title={title}
    >
      <Gauge className="h-3 w-3" />
      <span className="font-mono">
        {formatTokens(used)}/{formatTokens(total)}
      </span>
      <span className="opacity-70">·</span>
      <span className="font-mono">{pct.toFixed(0)}%</span>
      {typeof cost === "number" && (
        <>
          <span className="opacity-70">·</span>
          <span className="font-mono">{formatCost(cost, currency)}</span>
        </>
      )}
    </span>
  );
}

function ReloadSuggestionBanner({ session }: { session: SessionState }) {
  const suggestion = useUIStore((s) => s.reloadSuggestions[session.id]);
  const dismiss = useUIStore((s) => s.dismissReloadSuggestion);
  const reload = useUIStore((s) => s.reloadSession);
  const reloading = session.status === "reloading";

  if (!suggestion) return null;

  return (
    <div className="flex items-center justify-between border-b border-amber-500/30 bg-amber-100 px-4 py-1.5 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
      <div className="flex min-w-0 items-center gap-2">
        {reloading ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : (
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        )}
        <span className="truncate">
          {reloading
            ? "Reloading session…"
            : "MCP / plugin configuration changed. Reload this session to apply."}
        </span>
      </div>
      <div className="ml-3 flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => reload(session.id)}
          disabled={reloading}
          className="rounded px-2 py-0.5 font-medium text-amber-950 dark:text-amber-100 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
        >
          Reload now
        </button>
        <button
          type="button"
          onClick={() => dismiss(session.id)}
          disabled={reloading}
          className="rounded px-2 py-0.5 text-amber-900/80 dark:text-amber-100/80 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
        >
          Dismiss
        </button>
      </div>
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

type HintMode = "agents_md" | "prompt" | "off";

const HINT_LABELS: Record<HintMode, string> = {
  agents_md: "AGENTS.md",
  prompt: "Prompt",
  off: "Off",
};

const HINT_DESCRIPTIONS: Record<HintMode, string> = {
  agents_md:
    "Write the rich-output hint into this workspace's AGENTS.md so every session in this cwd uses it.",
  prompt: "Prepend the hint to the first prompt of this session only. No files are written.",
  off: "Don't inject any rendering hints.",
};

function HintModeControl({ session }: { session: SessionState }) {
  const [open, setOpen] = useState(false);
  const [writeBusy, setWriteBusy] = useState(false);
  const [writeResult, setWriteResult] = useState<string | null>(null);
  const setRenderHintMode = useUIStore((s) => s.setRenderHintMode);
  const setNotice = useUIStore((s) => s.setNotice);
  const mode: HintMode = session.renderHintMode ?? "prompt";

  async function pickMode(next: HintMode) {
    if (next === mode) return;
    try {
      const r = await fetch(`/api/sessions/${session.id}/render-hint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setRenderHintMode(session.id, next);
      if (next === "agents_md") {
        await writeAgentsMd(true);
      }
    } catch (err) {
      setNotice({
        id: `hint-${Date.now()}`,
        kind: "warn",
        text: `Failed to set render hint: ${(err as Error).message}`,
        ts: Date.now(),
      });
    }
  }

  async function writeAgentsMd(silent = false) {
    setWriteBusy(true);
    setWriteResult(null);
    try {
      const r = await fetch(`/api/sessions/${session.id}/agents-md`, {
        method: "POST",
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { status: string; path: string };
      const msg = `${data.status} ${data.path}`;
      setWriteResult(msg);
      if (!silent)
        setNotice({
          id: `agentsmd-${Date.now()}`,
          kind: "info",
          text: `AGENTS.md ${msg}`,
          ts: Date.now(),
        });
    } catch (err) {
      const msg = (err as Error).message;
      setWriteResult(`error: ${msg}`);
      if (!silent)
        setNotice({
          id: `agentsmd-err-${Date.now()}`,
          kind: "warn",
          text: `AGENTS.md write failed: ${msg}`,
          ts: Date.now(),
        });
    } finally {
      setWriteBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
          title="Rich-output rendering hints"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>Hints: {HINT_LABELS[mode]}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <div className="px-2 pb-1.5 pt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          Rendering hints
        </div>
        <div className="space-y-0.5">
          {(["agents_md", "prompt", "off"] as HintMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                void pickMode(m);
              }}
              className={
                m === mode
                  ? "flex w-full flex-col gap-0.5 rounded bg-muted px-2 py-1.5 text-left"
                  : "flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left hover:bg-muted"
              }
            >
              <span className="text-xs font-medium">{HINT_LABELS[m]}</span>
              <span className="text-[11px] leading-snug text-muted-foreground">
                {HINT_DESCRIPTIONS[m]}
              </span>
            </button>
          ))}
        </div>
        <div className="mt-2 border-t border-border pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-full justify-start gap-2 text-xs"
            disabled={writeBusy}
            onClick={() => {
              void writeAgentsMd(false);
            }}
          >
            {writeBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileCode2 className="h-3.5 w-3.5" />
            )}
            Write AGENTS.md now
          </Button>
          {writeResult && (
            <div className="px-2 pb-0.5 pt-1 text-[11px] text-muted-foreground">{writeResult}</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
