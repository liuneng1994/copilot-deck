import { useEffect, useMemo, useState } from "react";
import { Sparkles, Zap } from "lucide-react";
import { cn } from "../../lib/cn";

export interface SlashCommand {
  name: string;
  description?: string;
}

export interface SlashItem {
  name: string;
  description?: string;
  /** "builtin" — handled in the UI; "agent" — sent to the agent as text. */
  source: "builtin" | "agent";
  /** Optional category for built-ins (e.g. "view", "session"). */
  category?: string;
}

export function SlashPopover({
  open,
  commands,
  builtins,
  query,
  onPick,
  onClose,
}: {
  open: boolean;
  commands: SlashCommand[];
  builtins: SlashItem[];
  query: string;
  onPick: (cmd: SlashItem) => void;
  onClose: () => void;
}) {
  const [active, setActive] = useState(0);

  const items = useMemo<SlashItem[]>(() => {
    const q = query.toLowerCase();
    const matches = (n: string, d?: string) =>
      !q ||
      n.toLowerCase().includes(q) ||
      (d ?? "").toLowerCase().includes(q);
    const builtinsF = builtins.filter((b) => matches(b.name, b.description));
    const agentF = commands
      .filter((c) => matches(c.name, c.description))
      .map<SlashItem>((c) => ({
        name: c.name,
        description: c.description,
        source: "agent",
      }));
    // Built-ins first so handy view toggles surface quickly.
    return [...builtinsF, ...agentF].slice(0, 30);
  }, [commands, builtins, query]);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setActive((a) => Math.min(items.length - 1, a + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setActive((a) => Math.max(0, a - 1));
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (items[active]) {
          e.preventDefault();
          e.stopPropagation();
          onPick(items[active]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, items, active, onPick, onClose]);

  if (!open || items.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 z-30 mx-4 mb-2 max-h-72 overflow-auto rounded-lg border border-border bg-panel-elevated shadow-lg">
      <div className="border-b border-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        Slash commands · {items.length}
      </div>
      <ul>
        {items.map((c, i) => {
          const isBuiltin = c.source === "builtin";
          const Icon = isBuiltin ? Zap : Sparkles;
          return (
            <li key={`${c.source}:${c.name}`}>
              <button
                onClick={() => onPick(c)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
                  i === active
                    ? "bg-primary/15 text-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                <Icon
                  className={cn(
                    "h-3 w-3 shrink-0",
                    isBuiltin ? "text-sky-400" : "text-amber-400",
                  )}
                />
                <span className="font-mono text-foreground">/{c.name}</span>
                {c.description && (
                  <span className="flex-1 truncate text-[11px] text-muted-foreground">
                    {c.description}
                  </span>
                )}
                <span
                  className={cn(
                    "shrink-0 rounded px-1 py-0.5 text-[9px] uppercase tracking-wider",
                    isBuiltin
                      ? "bg-sky-500/10 text-sky-300"
                      : "bg-amber-500/10 text-amber-300",
                  )}
                >
                  {isBuiltin ? (c.category ?? "ui") : "agent"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
