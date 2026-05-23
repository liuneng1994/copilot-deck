import { File as FileIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";

export function MentionPopover({
  open,
  cwd,
  query,
  onPick,
  onClose,
}: {
  open: boolean;
  cwd: string;
  query: string;
  onPick: (file: string) => void;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setActive(0);
  }, [query, open]);

  useEffect(() => {
    if (!open || !cwd) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const url = `/api/files?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(query)}&limit=30`;
    fetch(url)
      .then((r) => r.json())
      .then((j: { files?: string[] }) => {
        if (cancelled) return;
        setFiles(j.files ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFiles([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, cwd, query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setActive((a) => Math.min(files.length - 1, a + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setActive((a) => Math.max(0, a - 1));
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (files[active]) {
          e.preventDefault();
          e.stopPropagation();
          onPick(files[active]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, files, active, onPick, onClose]);

  if (!open) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 z-30 mx-4 mb-2 max-h-72 overflow-auto rounded-lg border border-border bg-panel-elevated shadow-lg">
      <div className="border-b border-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {loading ? "Searching…" : `Files · ${files.length}`}
      </div>
      {files.length === 0 ? (
        <div className="px-3 py-2 text-[11px] text-muted-foreground">
          {loading ? "" : "No matches"}
        </div>
      ) : (
        <ul>
          {files.map((f, i) => {
            const slash = f.lastIndexOf("/");
            const dir = slash >= 0 ? f.slice(0, slash + 1) : "";
            const base = slash >= 0 ? f.slice(slash + 1) : f;
            return (
              <li key={f}>
                <button
                  onClick={() => onPick(f)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
                    i === active
                      ? "bg-primary/15 text-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <FileIcon className="h-3 w-3 shrink-0 opacity-60" />
                  <span className="truncate">
                    <span className="text-muted-foreground">{dir}</span>
                    <span className="font-medium text-foreground">{base}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
