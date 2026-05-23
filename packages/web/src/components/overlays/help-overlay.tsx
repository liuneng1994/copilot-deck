import { X } from "lucide-react";
import { useEffect } from "react";
import { BUILTIN_COMMANDS } from "../../lib/builtin-commands";
import { useUIStore } from "../../stores/ui-store";

const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: "⌘ \\", desc: "Toggle sidebar" },
  { keys: "⌘ B", desc: "Toggle inspector" },
  { keys: "⌘ F", desc: "Find in conversation" },
  { keys: "⌘ 1-9", desc: "Switch to nth session" },
  { keys: "⌘ ↵ / ↵", desc: "Send prompt" },
  { keys: "Esc", desc: "Cancel streaming reply" },
  { keys: "↑ ↓ (empty composer)", desc: "Recall prompt history" },
  { keys: "/", desc: "Open slash command picker" },
  { keys: "@", desc: "Mention a file from cwd" },
  { keys: "↑ ↓ / Tab", desc: "Navigate command picker" },
  { keys: "Hover message", desc: "Copy / Edit (user) / Regenerate (agent)" },
];

export function HelpOverlay() {
  const open = useUIStore((s) => s.helpOpen);
  const setOpen = useUIStore((s) => s.setHelpOpen);
  useEffect(() => {
    if (!open) return;
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
  if (!open) return null;

  const grouped = new Map<string, typeof BUILTIN_COMMANDS>();
  for (const c of BUILTIN_COMMANDS) {
    if (!grouped.has(c.category)) grouped.set(c.category, []);
    grouped.get(c.category)!.push(c);
  }
  const order = ["view", "session", "system", "help"];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <button
        type="button"
        aria-label="Close help overlay"
        className="absolute inset-0 cursor-default bg-transparent"
        onClick={() => setOpen(false)}
      />
      <div className="relative flex max-h-[80vh] w-[640px] max-w-full flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="text-sm font-medium">Agent View — Help</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Keyboard shortcuts and built-in slash commands
            </div>
          </div>
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(false)}
            aria-label="Close help"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 text-xs">
          <section className="mb-5">
            <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Keyboard
            </h3>
            <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5">
              {SHORTCUTS.map((s) => (
                <li key={s.keys} className="flex items-center gap-2">
                  <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                    {s.keys}
                  </kbd>
                  <span className="text-muted-foreground">{s.desc}</span>
                </li>
              ))}
            </ul>
          </section>

          {order
            .filter((cat) => grouped.has(cat))
            .map((cat) => (
              <section key={cat} className="mb-5">
                <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {cat === "view"
                    ? "View toggles"
                    : cat === "session"
                      ? "Session"
                      : cat === "system"
                        ? "System / CLI built-ins"
                        : "Help"}
                </h3>
                <ul className="space-y-1">
                  {grouped.get(cat)!.map((c) => (
                    <li key={c.name} className="flex items-baseline gap-3">
                      <span className="w-24 shrink-0 font-mono text-foreground">/{c.name}</span>
                      <span className="text-muted-foreground">{c.description}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

          <section>
            <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Notes
            </h3>
            <p className="text-muted-foreground">
              Commands marked{" "}
              <span className="rounded bg-amber-500/10 px-1 py-0.5 text-[9px] uppercase tracking-wider text-amber-300">
                agent
              </span>{" "}
              are forwarded to the underlying Copilot CLI. Commands marked{" "}
              <span className="rounded bg-sky-500/10 px-1 py-0.5 text-[9px] uppercase tracking-wider text-sky-300">
                ui
              </span>{" "}
              run inside this web UI and never leave the browser.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
