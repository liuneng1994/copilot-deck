import { ChevronDown, Clock, Folder } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/cn";

interface DirEntry {
  name: string;
  path: string;
}

export interface CwdComboboxProps {
  value: string;
  onChange: (v: string) => void;
  /** Submit on Enter — typically "create session". */
  onSubmit: () => void;
  /** Recently-used cwds (most recent first). */
  recents: string[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

/** Combobox for picking a working directory.
 *
 * - Free-form text input (always editable)
 * - Dropdown on focus shows: recent cwds (deduped) + live subdirectories of the typed path
 * - Arrow keys navigate, Enter selects, Esc closes, Tab autocompletes first match
 */
export function CwdCombobox({
  value,
  onChange,
  onSubmit,
  recents,
  disabled,
  placeholder = "cwd path…",
  className,
}: CwdComboboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(0);
  const [subdirs, setSubdirs] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch subdirs as the user types (debounced).
  useEffect(() => {
    if (!open) return;
    if (!value.trim()) {
      setSubdirs([]);
      return;
    }
    const t = setTimeout(() => {
      setLoading(true);
      const url = `/api/list-dir?path=${encodeURIComponent(value)}&limit=80`;
      fetch(url)
        .then((r) => r.json() as Promise<{ entries?: DirEntry[]; error?: string }>)
        .then((j) => {
          setSubdirs(j.entries ?? []);
        })
        .catch(() => setSubdirs([]))
        .finally(() => setLoading(false));
    }, 150);
    return () => clearTimeout(t);
  }, [value, open]);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const items = useMemo(() => {
    const recent = recents
      .filter((p, i) => recents.indexOf(p) === i) // dedup
      .filter((p) => !value.trim() || p.toLowerCase().includes(value.toLowerCase()))
      .slice(0, 6)
      .map((p) => ({ kind: "recent" as const, path: p, name: p }));
    const dirs = subdirs.map((d) => ({ kind: "dir" as const, path: d.path, name: d.path }));
    // De-dup: don't show a recent entry that exactly equals a subdir.
    const seen = new Set<string>();
    return [...recent, ...dirs].filter((it) => {
      if (seen.has(it.path)) return false;
      seen.add(it.path);
      return true;
    });
  }, [recents, subdirs, value]);

  // Keep highlight in range when items change.
  useEffect(() => {
    setHoverIdx((i) => Math.min(Math.max(0, i), Math.max(0, items.length - 1)));
  }, [items.length]);

  const pick = (p: string) => {
    onChange(p);
    setOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div ref={rootRef} className={cn("relative flex-1", className)}>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) setOpen(true);
            setHoverIdx((i) => Math.min(items.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHoverIdx((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter") {
            if (open && items[hoverIdx]) {
              e.preventDefault();
              pick(items[hoverIdx].path);
            } else {
              e.preventDefault();
              setOpen(false);
              onSubmit();
            }
          } else if (e.key === "Tab" && items[hoverIdx]) {
            e.preventDefault();
            pick(items[hoverIdx].path);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className="h-8 w-full rounded-md border border-border bg-bg pl-2 pr-7 text-xs outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-50"
      />
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
        tabIndex={-1}
        aria-label="Toggle folder list"
      >
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-72 w-[320px] overflow-y-auto rounded-md border border-border bg-panel-elevated text-xs shadow-lg">
          {items.length === 0 && !loading && (
            <div className="px-3 py-2 text-muted-foreground">No matches.</div>
          )}
          {loading && items.length === 0 && (
            <div className="px-3 py-2 text-muted-foreground">Loading…</div>
          )}
          {items.map((it, i) => {
            const active = i === hoverIdx;
            const Icon = it.kind === "recent" ? Clock : Folder;
            return (
              <button
                type="button"
                key={`${it.kind}:${it.path}`}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(it.path);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-2 py-1.5 text-left",
                  active ? "bg-bg/60 text-foreground" : "text-muted-foreground hover:bg-bg/30",
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                <span className="flex-1 truncate" title={it.path}>
                  {it.path}
                </span>
                {it.kind === "recent" && (
                  <span className="text-[9px] uppercase tracking-wider opacity-60">recent</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
