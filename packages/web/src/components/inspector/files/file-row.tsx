import type { FileEntry } from "@agent-view/shared";
import { cn } from "../../../lib/cn";
import type { SessionState } from "../../../stores/ui-store";
import { FileActions } from "./file-actions";

interface FileRowProps {
  entry: FileEntry;
  depth: number;
  selected: boolean;
  session: SessionState;
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
  if (status.includes("R")) return "border-sky-500/40 bg-sky-500/10 text-sky-300";
  if (status.includes("U") || status.includes("!"))
    return "border-rose-500/40 bg-rose-500/10 text-rose-300";
  return "border-border bg-muted/30 text-muted-foreground";
}

const GIT_CODE_LABEL: Record<string, string> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  U: "unmerged",
  "?": "untracked",
  "!": "ignored",
  " ": "unchanged",
};

function gitBadgeTitle(entry: FileEntry): string {
  const x = entry.gitX ?? " ";
  const y = entry.gitY ?? " ";
  const code = `${x}${y}`;
  if (code === "??") return "?? untracked — new file, not yet added to git";
  if (code === "!!") return "!! ignored — matched by .gitignore";
  if (code === "  ") return "clean — no changes";
  const xLabel = GIT_CODE_LABEL[x] ?? x;
  const yLabel = GIT_CODE_LABEL[y] ?? y;
  return `${code} — index: ${xLabel}, worktree: ${yLabel}`;
}

function splitPath(entry: FileEntry) {
  const displayPath = entry.rel || entry.path;
  const slash = displayPath.lastIndexOf("/");
  return {
    dir: slash >= 0 ? displayPath.slice(0, slash + 1) : "",
    base: slash >= 0 ? displayPath.slice(slash + 1) : displayPath,
  };
}

export function FileRow({ entry, depth, selected, session, onClick }: FileRowProps) {
  const { dir, base } = splitPath(entry);
  const gitStatus = `${entry.gitX ?? " "}${entry.gitY ?? " "}`;
  const changed = (entry.added ?? 0) + (entry.removed ?? 0) > 0;
  const missing = entry.missing === true;

  return (
    <div
      className={cn(
        "group flex h-[26px] w-full items-center gap-2 px-3 text-left text-[11px] outline-none",
        selected ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-muted/60",
        missing && "opacity-60",
      )}
      style={{ paddingLeft: `${12 + depth * 12}px` }}
    >
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            sourceDotClass[entry.source] ?? sourceDotClass.clean,
          )}
          aria-label={`${entry.source} source`}
        />
        <span
          className={cn(
            "w-6 shrink-0 rounded border px-0.5 text-center font-mono text-[10px] leading-4",
            gitBadgeClass(entry),
          )}
          title={gitBadgeTitle(entry)}
        >
          {gitStatus}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="text-muted-foreground">{dir}</span>
          <span
            className={cn(
              "font-medium text-foreground",
              missing && "text-muted-foreground line-through decoration-muted-foreground/60",
            )}
          >
            {base}
          </span>
        </span>
        {missing && (
          <span
            className="shrink-0 rounded bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-300"
            title="File no longer exists on disk (stashed, checked out, or deleted)"
          >
            missing
          </span>
        )}
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
      <FileActions entry={entry} session={session} />
    </div>
  );
}
