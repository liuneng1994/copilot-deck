import { ChevronDown, ChevronRight, FileDiff } from "lucide-react";
import { useMemo, useState } from "react";
import { type ToolCallState, useUIStore } from "../../stores/ui-store";
import { DiffView } from "./diff-view";

interface AggregatedFile {
  path: string;
  oldText: string;
  newText: string;
  adds: number;
  dels: number;
  /** Number of tool calls that touched this file in this turn. */
  edits: number;
}

function extractEditFromToolCall(call: ToolCallState): {
  path: string;
  oldText: string;
  newText: string;
} | null {
  // 1) Look at ACP diff content blocks first — they are authoritative.
  const diffBlock = call.content?.find((b) => b.kind === "diff" && (b.path || b.newText));
  if (diffBlock?.path && (diffBlock.newText !== undefined || diffBlock.oldText !== undefined)) {
    return {
      path: diffBlock.path,
      oldText: diffBlock.oldText ?? "",
      newText: diffBlock.newText ?? "",
    };
  }
  // 2) Fall back to rawInput shape commonly produced by edit/write tools.
  const raw = (call.rawInput ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = raw[k];
      if (typeof v === "string") return v;
    }
    return undefined;
  };
  const path = pick("path", "file_path", "filePath", "filename");
  if (!path) return null;
  const newText = pick("content", "new_content", "newContent", "text");
  const oldText = pick("old_content", "oldContent", "old", "previous");
  if (newText === undefined && oldText === undefined) return null;
  return { path, oldText: oldText ?? "", newText: newText ?? "" };
}

function countLineDiff(oldText: string, newText: string): { adds: number; dels: number } {
  if (oldText === newText) return { adds: 0, dels: 0 };
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  let adds = 0;
  let dels = 0;
  for (const l of newLines) if (!oldSet.has(l)) adds++;
  for (const l of oldLines) if (!newSet.has(l)) dels++;
  return { adds, dels };
}

export function TurnDiffSummary({ toolCallIds }: { toolCallIds: string[] }) {
  const allCalls = useUIStore((s) => s.toolCalls);
  const [open, setOpen] = useState(false);
  const [openFiles, setOpenFiles] = useState<Record<string, boolean>>({});

  const files = useMemo<AggregatedFile[]>(() => {
    const byPath = new Map<string, AggregatedFile>();
    for (const id of toolCallIds) {
      const call = allCalls[id];
      if (!call) continue;
      const edit = extractEditFromToolCall(call);
      if (!edit) continue;
      const existing = byPath.get(edit.path);
      if (existing) {
        // Subsequent edit to same file in same turn — chain: prev.new becomes next.old's baseline.
        // We approximate by keeping the original oldText and using the latest newText.
        existing.newText = edit.newText;
        existing.edits += 1;
      } else {
        byPath.set(edit.path, {
          path: edit.path,
          oldText: edit.oldText,
          newText: edit.newText,
          adds: 0,
          dels: 0,
          edits: 1,
        });
      }
    }
    const arr = [...byPath.values()];
    for (const f of arr) {
      const c = countLineDiff(f.oldText, f.newText);
      f.adds = c.adds;
      f.dels = c.dels;
    }
    return arr.sort((a, b) => b.adds + b.dels - (a.adds + a.dels));
  }, [toolCallIds, allCalls]);

  if (files.length < 2) return null;

  const totalAdds = files.reduce((s, f) => s + f.adds, 0);
  const totalDels = files.reduce((s, f) => s + f.dels, 0);

  return (
    <div className="ml-10 rounded-md border border-border bg-panel-elevated/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-muted/50"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <FileDiff className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium text-foreground">Files changed ({files.length})</span>
        <span className="ml-auto flex items-center gap-2 font-mono text-[10px]">
          <span className="text-success">+{totalAdds}</span>
          <span className="text-destructive">−{totalDels}</span>
        </span>
      </button>
      {open && (
        <div className="border-t border-border">
          {files.map((f) => {
            const isOpen = openFiles[f.path] ?? false;
            return (
              <div key={f.path} className="border-b border-border/50 last:border-b-0">
                <button
                  type="button"
                  onClick={() => setOpenFiles((o) => ({ ...o, [f.path]: !isOpen }))}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-muted/50"
                >
                  {isOpen ? (
                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                  )}
                  <span className="truncate font-mono text-foreground">{f.path}</span>
                  {f.edits > 1 && (
                    <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground">
                      {f.edits} edits
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2 font-mono text-[10px]">
                    <span className="text-success">+{f.adds}</span>
                    <span className="text-destructive">−{f.dels}</span>
                  </span>
                </button>
                {isOpen && (
                  <div className="overflow-hidden border-t border-border">
                    <DiffView path={f.path} oldText={f.oldText} newText={f.newText} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
