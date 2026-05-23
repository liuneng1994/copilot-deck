import type { FileEntry } from "@agent-view/shared";
import { cn } from "../../../lib/cn";

interface FileRowProps {
  entry: FileEntry;
  depth: number;
  selected: boolean;
  onClick: () => void;
}

const sourceDotClass: Record<string, string> = {
  agent: "bg-sky-400",
  dirty: "bg-amber-400",
  untracked: "bg-violet-400",
  clean: "bg-zinc-500",
};

function gitBadgeClass(entry: FileEntry) {
  const status = `${entry.gitX ?? " "}${entry.gitY ?? " "}`;
  if (status.includes("?")) return "border-violet-500/40 bg-violet-500/10 text-violet-300";
  if (status.includes("A")) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  if (status.includes("M")) return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  if (status.includes("D")) return "border-rose-500/40 bg-rose-500/10 text-rose-300";
  return "border-border bg-muted/30 text-muted-foreground";
}

function splitPath(entry: FileEntry) {
  const displayPath = entry.rel || entry.path;
  const slash = displayPath.lastIndexOf("/");
  return {
    dir: slash >= 0 ? displayPath.slice(0, slash + 1) : "",
    base: slash >= 0 ? displayPath.slice(slash + 1) : displayPath,
  };
}

export function FileRow({ entry, depth, selected, onClick }: FileRowProps) {
  const { dir, base } = splitPath(entry);
  const gitStatus = `${entry.gitX ?? " "}${entry.gitY ?? " "}`;
  const changed = (entry.added ?? 0) + (entry.removed ?? 0) > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-[26px] w-full items-center gap-2 px-3 text-left text-[11px] outline-none",
        selected ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted/60",
      )}
      style={{ paddingLeft: `${12 + depth * 12}px` }}
    >
      <span
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          sourceDotClass[entry.source] ?? sourceDotClass.clean,
        )}
        aria-hidden="true"
      />
      <span
        className={cn(
          "w-6 shrink-0 rounded border px-0.5 text-center font-mono text-[10px] leading-4",
          gitBadgeClass(entry),
        )}
      >
        {gitStatus}
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="text-muted-foreground">{dir}</span>
        <span className="font-medium text-foreground">{base}</span>
      </span>
      {entry.isGenerated && (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          generated
        </span>
      )}
      {changed && (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          <span className="text-emerald-300">+{entry.added ?? 0}</span>{" "}
          <span className="text-rose-300">−{entry.removed ?? 0}</span>
        </span>
      )}
    </button>
  );
}
