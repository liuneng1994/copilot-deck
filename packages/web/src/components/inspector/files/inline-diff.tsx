import { diffLines } from "diff";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../../lib/cn";
import type { DiffViewMode, SessionState, ToolCallState } from "../../../stores/ui-store";
import { useUIStore } from "../../../stores/ui-store";

interface InlineDiffProps {
  path: string;
  session: SessionState;
}

type DiffSource = "net" | "head";
type RowKind = "add" | "del" | "ctx" | "hunk";

interface DiffBlock {
  path?: string;
  oldText?: string;
  newText?: string;
}

interface DiffRow {
  kind: RowKind;
  text: string;
  oldNo?: number;
  newNo?: number;
  hunkIndex?: number;
}

interface FoldedRun {
  key: string;
  start: number;
  end: number;
  count: number;
}

type VisibleDiffItem = DiffRow | FoldedRun;

interface SplitPair {
  left: VisibleDiffItem | null;
  right: VisibleDiffItem | null;
}

const FOLD_THRESHOLD = 50;

function blocksForCall(call: ToolCallState): DiffBlock[] {
  const direct = (call as ToolCallState & { diffBlocks?: DiffBlock[] }).diffBlocks;
  const blocks = Array.isArray(direct) ? [...direct] : [];
  for (const block of call.content) {
    if (block.kind === "diff") blocks.push(block);
  }
  return blocks;
}

function orderedCalls(
  session: SessionState,
  toolCalls: Record<string, ToolCallState>,
): ToolCallState[] {
  const order = new Map(session.toolCallIds.map((id, index) => [id, index]));
  return Object.values(toolCalls)
    .filter((call) => call.sessionId === session.id)
    .sort((a, b) => {
      const ao = order.get(a.id);
      const bo = order.get(b.id);
      if (ao !== undefined || bo !== undefined)
        return (ao ?? Number.MAX_SAFE_INTEGER) - (bo ?? Number.MAX_SAFE_INTEGER);
      return a.ts - b.ts;
    });
}

function normalizePath(path: string | undefined, cwd: string) {
  if (!path) return "";
  const normalized = path.replaceAll("\\", "/");
  const cwdPrefix = `${cwd.replaceAll("\\", "/")}/`;
  return normalized.startsWith(cwdPrefix)
    ? normalized.slice(cwdPrefix.length)
    : normalized.replace(/^\.\//, "");
}

function samePath(a: string | undefined, b: string, cwd: string) {
  return normalizePath(a, cwd) === normalizePath(b, cwd);
}

function aggregateNetDiff(
  path: string,
  session: SessionState,
  toolCalls: Record<string, ToolCallState>,
) {
  const blocks = orderedCalls(session, toolCalls)
    .flatMap((call) => blocksForCall(call))
    .filter(
      (block) =>
        samePath(block.path, path, session.cwd) &&
        typeof block.oldText === "string" &&
        typeof block.newText === "string",
    );

  if (blocks.length === 0) return null;

  const oldText = blocks[0].oldText ?? "";
  let newText = oldText;
  for (const block of blocks) {
    const before = block.oldText ?? "";
    const after = block.newText ?? "";
    if (newText === before) newText = after;
    else if (before && newText.includes(before)) newText = newText.replace(before, after);
    else newText = after;
  }
  return { oldText, newText };
}

function rowsFromTexts(oldText: string, newText: string): DiffRow[] {
  if (oldText === newText) return [];
  const rows: DiffRow[] = [];
  let oldNo = 1;
  let newNo = 1;
  let hunkIndex = -1;
  let inChange = false;

  for (const part of diffLines(oldText, newText)) {
    const lines = part.value.split("\n");
    if (lines.at(-1) === "") lines.pop();
    if ((part.added || part.removed) && !inChange) {
      hunkIndex += 1;
      inChange = true;
    }
    if (!part.added && !part.removed && lines.length > 0) inChange = false;

    for (const line of lines) {
      if (part.added) rows.push({ kind: "add", text: line, newNo: newNo++, hunkIndex });
      else if (part.removed) rows.push({ kind: "del", text: line, oldNo: oldNo++, hunkIndex });
      else rows.push({ kind: "ctx", text: line, oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return rows;
}

function parseUnifiedDiff(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  let hunkIndex = -1;

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("@@")) {
      hunkIndex += 1;
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(raw);
      oldNo = Number(match?.[1] ?? 0);
      newNo = Number(match?.[2] ?? 0);
      rows.push({ kind: "hunk", text: raw, hunkIndex });
      continue;
    }
    if (
      raw.startsWith("diff --git") ||
      raw.startsWith("index ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ")
    ) {
      continue;
    }
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      rows.push({ kind: "add", text: raw.slice(1), newNo: newNo++, hunkIndex });
    } else if (raw.startsWith("-") && !raw.startsWith("---")) {
      rows.push({ kind: "del", text: raw.slice(1), oldNo: oldNo++, hunkIndex });
    } else if (raw.startsWith(" ")) {
      rows.push({ kind: "ctx", text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return rows;
}

function foldRuns(rows: DiffRow[]): FoldedRun[] {
  const runs: FoldedRun[] = [];
  let start: number | null = null;
  for (let index = 0; index <= rows.length; index += 1) {
    if (rows[index]?.kind === "ctx") {
      start ??= index;
      continue;
    }
    if (start !== null && index - start > FOLD_THRESHOLD) {
      runs.push({ key: `${start}:${index}`, start, end: index, count: index - start });
    }
    start = null;
  }
  return runs;
}

function changedLineCount(rows: DiffRow[], kind: "add" | "del") {
  return rows.filter((row) => row.kind === kind).length;
}

function buildSplitPairs(items: VisibleDiffItem[]): SplitPair[] {
  const pairs: SplitPair[] = [];
  let deletions: DiffRow[] = [];
  let additions: DiffRow[] = [];

  const flushChanges = () => {
    const count = Math.max(deletions.length, additions.length);
    for (let index = 0; index < count; index += 1) {
      pairs.push({ left: deletions[index] ?? null, right: additions[index] ?? null });
    }
    deletions = [];
    additions = [];
  };

  for (const item of items) {
    if ("count" in item || item.kind === "ctx" || item.kind === "hunk") {
      flushChanges();
      pairs.push({ left: item, right: item });
    } else if (item.kind === "del") {
      deletions.push(item);
    } else {
      additions.push(item);
    }
  }
  flushChanges();

  return pairs;
}

function pairHunkIndex(pair: SplitPair): number | undefined {
  const left = pair.left && !("count" in pair.left) ? pair.left.hunkIndex : undefined;
  if (left !== undefined) return left;
  return pair.right && !("count" in pair.right) ? pair.right.hunkIndex : undefined;
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
  );
}

export function InlineDiff({ path, session }: InlineDiffProps) {
  const toolCalls = useUIStore((s) => s.toolCalls);
  const generation = useUIStore((s) => s.filesOverview[session.cwd]?.generation ?? 0);
  const [source, setSource] = useState<DiffSource>("net");
  const [headDiff, setHeadDiff] = useState<string | null>(null);
  const [headError, setHeadError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [activeHunk, setActiveHunk] = useState<number | null>(null);
  const diffViewMode = useUIStore((s) => s.diffViewMode);
  const setDiffViewMode = useUIStore((s) => s.setDiffViewMode);
  const hunkRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const initKeyRef = useRef<string | null>(null);
  const leftPaneRef = useRef<HTMLDivElement | null>(null);
  const rightPaneRef = useRef<HTMLDivElement | null>(null);

  const netPair = useMemo(
    () => aggregateNetDiff(path, session, toolCalls),
    [path, session, toolCalls],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `generation` is a refresh signal from git/file-watcher
  useEffect(() => {
    if (source !== "head") return;
    const controller = new AbortController();
    setHeadError(null);
    setHeadDiff(null);
    const params = new URLSearchParams({ cwd: session.cwd, path, base: "HEAD" });
    fetch(`/api/git/diff?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return response.json() as Promise<{ diff?: string }>;
      })
      .then((data) => setHeadDiff(data.diff ?? ""))
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setHeadError(error instanceof Error ? error.message : "Unable to load diff");
      });
    return () => controller.abort();
  }, [source, session.cwd, path, generation]);

  const rows = useMemo(() => {
    if (source === "head") return headDiff == null ? null : parseUnifiedDiff(headDiff);
    return netPair ? rowsFromTexts(netPair.oldText, netPair.newText) : [];
  }, [source, headDiff, netPair]);

  const folds = useMemo(() => (rows ? foldRuns(rows) : []), [rows]);
  const foldByStart = useMemo(() => new Map(folds.map((fold) => [fold.start, fold])), [folds]);
  const hunkIndexes = useMemo(
    () =>
      Array.from(
        new Set(
          (rows ?? [])
            .filter((row) => row.kind === "add" || row.kind === "del" || row.kind === "hunk")
            .map((row) => row.hunkIndex ?? 0),
        ),
      ),
    [rows],
  );

  useEffect(() => {
    const key = `${session.cwd}::${path}::${source}`;
    if (initKeyRef.current === key) return;
    if (folds.length === 0) return;
    initKeyRef.current = key;
    setCollapsed(new Set(folds.map((fold) => fold.key)));
  }, [folds, session.cwd, path, source]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || hunkIndexes.length === 0) return;
      if (event.key !== "j" && event.key !== "k") return;
      event.preventDefault();
      const current = activeHunk == null ? -1 : hunkIndexes.indexOf(activeHunk);
      const nextIndex =
        event.key === "j"
          ? Math.min(current + 1, hunkIndexes.length - 1)
          : Math.max(current - 1, 0);
      const next = hunkIndexes[nextIndex];
      setActiveHunk(next);
      hunkRefs.current[next]?.scrollIntoView({ block: "center", behavior: "smooth" });
      window.setTimeout(() => setActiveHunk((value) => (value === next ? null : value)), 900);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeHunk, hunkIndexes]);

  const toggleFold = (key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const visibleRows: Array<DiffRow | FoldedRun> = [];
  if (rows) {
    for (let index = 0; index < rows.length; index += 1) {
      const fold = foldByStart.get(index);
      if (fold && collapsed.has(fold.key)) {
        visibleRows.push(fold);
        index = fold.end - 1;
      } else {
        visibleRows.push(rows[index]);
      }
    }
  }

  const splitPairs = buildSplitPairs(visibleRows);
  const adds = rows ? changedLineCount(rows, "add") : 0;
  const dels = rows ? changedLineCount(rows, "del") : 0;
  const isLoading = source === "head" && rows === null && !headError;
  const emptyText = source === "head" ? "Identical to HEAD" : "No changes for this file";

  const syncScroll = (
    sourceRef: RefObject<HTMLDivElement | null>,
    targetRef: RefObject<HTMLDivElement | null>,
  ) => {
    const sourceEl = sourceRef.current;
    const targetEl = targetRef.current;
    if (!sourceEl || !targetEl) return;
    if (Math.abs(targetEl.scrollTop - sourceEl.scrollTop) < 1) return;
    targetEl.scrollTop = sourceEl.scrollTop;
  };

  const renderRow = (item: DiffRow | FoldedRun, index: number) => {
    if ("count" in item) {
      return (
        <button
          key={item.key}
          type="button"
          onClick={() => toggleFold(item.key)}
          className="grid w-full grid-cols-[48px_48px_24px_1fr] border-y border-border/40 bg-muted/25 font-mono text-[11px] leading-6 text-muted-foreground hover:bg-muted/50"
        >
          <span />
          <span />
          <span>…</span>
          <span className="text-left">{item.count} lines collapsed (click)</span>
        </button>
      );
    }

    const previous = visibleRows[index - 1];
    const previousHunk = previous && "hunkIndex" in previous ? previous.hunkIndex : undefined;
    const isHunkStart = item.hunkIndex !== undefined && previousHunk !== item.hunkIndex;
    const ref = isHunkStart
      ? (node: HTMLDivElement | null) => {
          hunkRefs.current[item.hunkIndex ?? 0] = node;
        }
      : undefined;

    if (item.kind === "hunk") {
      return (
        <div
          key={`hunk-${index}`}
          ref={ref}
          className={cn(
            "grid grid-cols-[48px_48px_24px_1fr] bg-primary/10 font-mono text-[11px] leading-6 text-primary",
            activeHunk === item.hunkIndex && "ring-1 ring-primary",
          )}
        >
          <span />
          <span />
          <span>@@</span>
          <span className="truncate px-2">{item.text}</span>
        </div>
      );
    }

    const sign = item.kind === "add" ? "+" : item.kind === "del" ? "-" : " ";
    const bg =
      item.kind === "add" ? "bg-success/15" : item.kind === "del" ? "bg-destructive/15" : "";
    const fg =
      item.kind === "add"
        ? "text-success"
        : item.kind === "del"
          ? "text-destructive"
          : "text-muted-foreground";

    return (
      <div
        key={`row-${index}`}
        ref={ref}
        className={cn(
          "grid grid-cols-[48px_48px_24px_1fr] font-mono text-[12px] leading-[1.55]",
          bg,
          activeHunk === item.hunkIndex && "ring-1 ring-primary",
        )}
      >
        <span className="select-none border-r border-border/40 px-1 text-right text-[10px] text-muted-foreground">
          {item.oldNo ?? ""}
        </span>
        <span className="select-none border-r border-border/40 px-1 text-right text-[10px] text-muted-foreground">
          {item.newNo ?? ""}
        </span>
        <span className={cn("select-none px-1", fg)}>{sign}</span>
        <span className="whitespace-pre px-1">{item.text}</span>
      </div>
    );
  };

  const renderSplitCell = (
    item: VisibleDiffItem | null,
    side: "left" | "right",
    key: string,
    ref?: (node: HTMLDivElement | null) => void,
  ) => {
    if (!item) {
      return (
        <div
          key={key}
          ref={ref}
          className="grid grid-cols-[48px_24px_1fr] bg-muted/20 font-mono text-[12px] leading-[1.55]"
        >
          <span className="select-none border-r border-border/40 px-1 text-right text-[10px] text-muted-foreground" />
          <span className="select-none px-1 text-muted-foreground" />
          <span className="whitespace-pre px-1">&nbsp;</span>
        </div>
      );
    }

    if ("count" in item) {
      return (
        <button
          key={key}
          type="button"
          onClick={() => toggleFold(item.key)}
          className="grid w-full grid-cols-[48px_24px_1fr] border-y border-border/40 bg-muted/25 font-mono text-[11px] leading-6 text-muted-foreground hover:bg-muted/50"
        >
          <span />
          <span>…</span>
          <span className="text-left">{item.count} lines collapsed (click)</span>
        </button>
      );
    }

    if (item.kind === "hunk") {
      return (
        <div
          key={key}
          ref={ref}
          className={cn(
            "grid grid-cols-[48px_24px_1fr] bg-primary/10 font-mono text-[11px] leading-6 text-primary",
            activeHunk === item.hunkIndex && "ring-1 ring-primary",
          )}
        >
          <span />
          <span>@@</span>
          <span className="truncate px-2">{item.text}</span>
        </div>
      );
    }

    const sign = item.kind === "add" ? "+" : item.kind === "del" ? "-" : " ";
    const bg =
      item.kind === "add" ? "bg-success/15" : item.kind === "del" ? "bg-destructive/15" : "";
    const fg =
      item.kind === "add"
        ? "text-success"
        : item.kind === "del"
          ? "text-destructive"
          : "text-muted-foreground";
    const lineNo = side === "left" ? item.oldNo : item.newNo;

    return (
      <div
        key={key}
        ref={ref}
        className={cn(
          "grid grid-cols-[48px_24px_1fr] font-mono text-[12px] leading-[1.55]",
          bg,
          activeHunk === item.hunkIndex && "ring-1 ring-primary",
        )}
      >
        <span className="select-none border-r border-border/40 px-1 text-right text-[10px] text-muted-foreground">
          {lineNo ?? ""}
        </span>
        <span className={cn("select-none px-1", fg)}>{sign}</span>
        <span className="whitespace-pre px-1">{item.text}</span>
      </div>
    );
  };

  const renderSplitPane = (side: "left" | "right") =>
    splitPairs.map((pair, index) => {
      const hunkIndex = pairHunkIndex(pair);
      const previousHunk = index > 0 ? pairHunkIndex(splitPairs[index - 1]) : undefined;
      const ref =
        side === "left" && hunkIndex !== undefined && previousHunk !== hunkIndex
          ? (node: HTMLDivElement | null) => {
              hunkRefs.current[hunkIndex] = node;
            }
          : undefined;
      return renderSplitCell(pair[side], side, `${side}-${index}`, ref);
    });

  const splitView = (
    <div className="grid grid-cols-2 border-t border-border/40">
      <div
        ref={leftPaneRef}
        onScroll={() => syncScroll(leftPaneRef, rightPaneRef)}
        className="max-h-[360px] overflow-auto border-r border-border/60"
      >
        {renderSplitPane("left")}
      </div>
      <div
        ref={rightPaneRef}
        onScroll={() => syncScroll(rightPaneRef, leftPaneRef)}
        className="max-h-[360px] overflow-auto"
      >
        {renderSplitPane("right")}
      </div>
    </div>
  );

  return (
    <div className="border-b border-border bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-panel/60 px-3 py-1.5 text-[11px]">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex shrink-0 overflow-hidden rounded border border-border">
            <button
              type="button"
              onClick={() => setSource("net")}
              className={cn(
                "px-2 py-0.5",
                source === "net"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              Net agent diff
            </button>
            <button
              type="button"
              onClick={() => setSource("head")}
              className={cn(
                "border-l border-border px-2 py-0.5",
                source === "head"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              vs HEAD
            </button>
          </div>
          <span className="truncate font-mono text-foreground">{path}</span>
          <span className="inline-flex shrink-0 gap-2 text-xs">
            <span className="text-emerald-600 dark:text-emerald-400">+{adds}</span>
            <span className="text-rose-600 dark:text-rose-400">-{dels}</span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="mr-1 flex overflow-hidden rounded border border-border">
            {(["unified", "split"] as DiffViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setDiffViewMode(mode)}
                className={cn(
                  "px-2 py-0.5 text-xs capitalize",
                  diffViewMode === mode
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60",
                )}
              >
                {mode}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setCollapsed(new Set(folds.map((fold) => fold.key)))}
            className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ⌄ collapse all
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(new Set())}
            className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            ⌃ expand all
          </button>
        </div>
      </div>
      {headError ? (
        <div className="max-h-[360px] overflow-auto px-3 py-2 text-[11px] text-destructive">
          {headError}
        </div>
      ) : isLoading ? (
        <div className="max-h-[360px] overflow-auto px-3 py-2 text-[11px] text-muted-foreground">
          Loading diff…
        </div>
      ) : !rows || rows.length === 0 ? (
        <div className="max-h-[360px] overflow-auto px-3 py-2 text-[11px] text-muted-foreground">
          {emptyText}
        </div>
      ) : diffViewMode === "split" ? (
        splitView
      ) : (
        <div className="max-h-[360px] overflow-auto">{visibleRows.map(renderRow)}</div>
      )}
    </div>
  );
}
