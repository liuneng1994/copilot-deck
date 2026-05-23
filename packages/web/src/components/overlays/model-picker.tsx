import type { ModelGroup } from "@agent-view/shared";
import { Check, Cpu, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { sendWs } from "../../lib/ws-client";
import { useUIStore } from "../../stores/ui-store";

const GROUP_ORDER: ModelGroup[] = ["claude", "gpt", "other"];
const GROUP_LABEL: Record<ModelGroup, string> = {
  claude: "Anthropic Claude",
  gpt: "OpenAI GPT",
  other: "Other",
};

export function ModelPickerOverlay() {
  const open = useUIStore((s) => s.modelPickerOpen);
  const setOpen = useUIStore((s) => s.setModelPickerOpen);
  const models = useUIStore((s) => s.models);
  const defaultModel = useUIStore((s) => s.defaultModel);
  const modelByCwd = useUIStore((s) => s.modelByCwd);
  const modelBySession = useUIStore((s) => s.modelBySession);
  const activeId = useUIStore((s) => s.activeSessionId);
  const session = useUIStore((s) => (activeId ? s.sessions[activeId] : null));
  const cwd = session?.cwd ?? null;
  /** Scope toggle: when a session is active, default to per-session; user can
   * flip to cwd-wide. */
  const [scope, setScope] = useState<"session" | "cwd">(activeId ? "session" : "cwd");
  // Reset scope when picker opens or activeId changes.
  useEffect(() => {
    if (open) setScope(activeId ? "session" : "cwd");
  }, [open, activeId]);

  const cwdEffective = cwd ? (modelByCwd[cwd] ?? defaultModel) : defaultModel;
  const sessionOverride = activeId ? (modelBySession[activeId] ?? null) : null;
  const currentModel =
    scope === "session" && activeId ? (sessionOverride ?? cwdEffective) : cwdEffective;

  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setQuery("");
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, setOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.label.toLowerCase().includes(q) ||
        (m.tag ?? "").toLowerCase().includes(q),
    );
  }, [models, query]);

  const grouped = useMemo(() => {
    const map = new Map<ModelGroup, typeof models>();
    for (const m of filtered) {
      if (!map.has(m.group)) map.set(m.group, []);
      map.get(m.group)!.push(m);
    }
    return map;
  }, [filtered]);

  if (!open) return null;

  const pick = (id: string) => {
    if (scope === "session" && activeId) {
      sendWs({ type: "set_session_model", sessionId: activeId, model: id });
      useUIStore.getState().setModelForSession(activeId, id);
    } else if (cwd) {
      sendWs({ type: "set_model", cwd, model: id });
      useUIStore.getState().setModelForCwd(cwd, id);
    } else {
      return;
    }
    setOpen(false);
  };

  const canPick = scope === "session" ? !!activeId : !!cwd;
  const scopeHint =
    scope === "session" && activeId
      ? "Applies to this session only · detaches + reattaches via ACP loadSession"
      : cwd
        ? `Applies to all sessions in ${cwd} (without per-session override) · respawns the agent`
        : "No active session — pick a cwd in the sidebar first";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-20">
      <button
        type="button"
        aria-label="Close model picker"
        className="absolute inset-0 cursor-default bg-transparent"
        onClick={() => setOpen(false)}
      />
      <div className="relative flex max-h-[70vh] w-[560px] max-w-full flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-2xl">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Cpu className="h-4 w-4 text-muted-foreground" />
          <div className="flex-1">
            <div className="text-sm font-medium">Switch model</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{scopeHint}</div>
          </div>
          {activeId && cwd && (
            <div className="flex items-center gap-0.5 rounded border border-border bg-background p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => setScope("session")}
                className={cn(
                  "rounded px-1.5 py-0.5",
                  scope === "session"
                    ? "bg-primary/20 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                title="Switch model for this session only"
              >
                session
              </button>
              <button
                type="button"
                onClick={() => setScope("cwd")}
                className={cn(
                  "rounded px-1.5 py-0.5",
                  scope === "cwd"
                    ? "bg-primary/20 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                title="Switch default model for this cwd"
              >
                cwd
              </button>
            </div>
          )}
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="border-b border-border px-3 py-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter models…"
            className="w-full rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-2 text-xs">
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-muted-foreground">
              No models match &ldquo;{query}&rdquo;.
            </div>
          )}
          {GROUP_ORDER.filter((g) => grouped.has(g)).map((group) => (
            <section key={group} className="mb-3">
              <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {GROUP_LABEL[group]}
              </div>
              <ul>
                {grouped.get(group)!.map((m) => {
                  const isCurrent = m.id === currentModel;
                  const isDefault = m.id === defaultModel;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => pick(m.id)}
                        disabled={!canPick}
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left",
                          isCurrent
                            ? "bg-primary/15 text-foreground"
                            : "text-muted-foreground hover:bg-muted",
                          !canPick && "cursor-not-allowed opacity-50",
                        )}
                      >
                        <span className="w-4 shrink-0">
                          {isCurrent && <Check className="h-3.5 w-3.5 text-primary" />}
                        </span>
                        <span className="font-mono text-foreground">{m.label}</span>
                        {m.tag && (
                          <span className="rounded bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                            {m.tag}
                          </span>
                        )}
                        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                          {m.id}
                          {isDefault && (
                            <span className="ml-1 rounded bg-sky-500/10 px-1 py-0.5 text-[9px] uppercase tracking-wider text-sky-300">
                              default
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <footer className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
          {scope === "session" && activeId
            ? "Per-session override detaches this session and reattaches it on the (cwd, model) agent via ACP loadSession. Other sessions stay on the cwd default."
            : "Switching kills the current Copilot child for this cwd. Existing messages remain; the next prompt starts a fresh ACP session under the chosen model."}
        </footer>
      </div>
    </div>
  );
}
