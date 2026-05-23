import { useEffect, useMemo, useState } from "react";
import { cn } from "../../lib/cn";

export interface SlashCommand {
  name: string;
  description?: string;
}

export function SlashPopover({
  open,
  commands,
  query,
  onPick,
  onClose,
}: {
  open: boolean;
  commands: SlashCommand[];
  query: string;
  onPick: (cmd: SlashCommand) => void;
  onClose: () => void;
}) {
  const [active, setActive] = useState(0);

  const items = useMemo(() => {
    const q = query.toLowerCase();
    const filtered = q
      ? commands.filter(
          (c) =>
            c.name.toLowerCase().includes(q) ||
            (c.description ?? "").toLowerCase().includes(q),
        )
      : commands;
    return filtered.slice(0, 20);
  }, [commands, query]);

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
        {items.map((c, i) => (
          <li key={c.name}>
            <button
              onClick={() => onPick(c)}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex w-full items-baseline gap-3 px-3 py-1.5 text-left text-xs",
                i === active
                  ? "bg-primary/15 text-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <span className="font-mono text-foreground">/{c.name}</span>
              {c.description && (
                <span className="truncate text-[11px] text-muted-foreground">
                  {c.description}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
