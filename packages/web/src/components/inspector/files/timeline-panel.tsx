import { diffLines } from "diff";
import { Eye, Pencil, TerminalSquare } from "lucide-react";
import { useMemo } from "react";
import { cn } from "../../../lib/cn";
import type { SessionState, ToolCallState } from "../../../stores/ui-store";
import { useUIStore } from "../../../stores/ui-store";

interface TimelinePanelProps {
  session: SessionState;
  toolCalls: Record<string, ToolCallState>;
}

type TouchType = "read" | "write" | "exec";

interface TouchEvent {
  ts: number;
  callId: string;
  kind: string;
  touchType: TouchType;
  path: string;
  snippet?: string;
  additions?: number;
  deletions?: number;
  turnKey?: string;
  turnLabel?: string;
}

interface TimelineGroup {
  id: string;
  label: string;
  events: TouchEvent[];
}

const PATH_KEYS = new Set([
  "path",
  "file",
  "filePath",
  "file_path",
  "filename",
  "fileName",
  "targetFile",
  "target_file",
  "absolutePath",
  "absolute_path",
]);

export function TimelinePanel({ session, toolCalls }: TimelinePanelProps) {
  const setSelectedFilePath = useUIStore((s) => s.setSelectedFilePath);
  const groups = useMemo(() => buildGroups(session, toolCalls), [session, toolCalls]);

  if (groups.length === 0) {
    return (
      <div className="px-3 py-2 text-[11px] text-muted-foreground">
        No file touches yet in this session.
      </div>
    );
  }

  const selectPath = (path: string) => setSelectedFilePath(path);
  const jumpToCall = (event: TouchEvent) => {
    setSelectedFilePath(event.path);
    scrollToToolCall(event.callId);
  };

  return (
    <div className="divide-y divide-border text-xs">
      {groups.map((group) => (
        <section key={group.id} className="py-2">
          <div className="sticky top-0 z-10 border-y border-border bg-panel/95 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground first:border-t-0">
            {group.label}
          </div>
          <div className="py-1">
            {group.events.map((event) => (
              <TimelineRow
                key={`${event.callId}:${event.path}:${event.touchType}:${event.ts}`}
                event={event}
                onSelect={selectPath}
                onJump={jumpToCall}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TimelineRow({
  event,
  onSelect,
  onJump,
}: {
  event: TouchEvent;
  onSelect: (path: string) => void;
  onJump: (event: TouchEvent) => void;
}) {
  const visual = touchVisual(event.touchType);
  return (
    <div className="group relative grid grid-cols-[4.75rem_5.75rem_minmax(0,1fr)_auto_auto] gap-2 px-3 py-1.5 font-mono text-[11px] hover:bg-muted/40">
      <button
        type="button"
        onClick={() => onSelect(event.path)}
        className="absolute inset-0 cursor-pointer rounded-sm focus:outline-none focus:ring-1 focus:ring-ring"
        aria-label={`Open ${event.path}`}
      />
      <span className="pointer-events-none relative text-muted-foreground">
        {formatTime(event.ts)}
      </span>
      <span
        className={cn(
          "pointer-events-none relative inline-flex items-center gap-1 font-semibold",
          visual.className,
        )}
      >
        <visual.Icon className="h-3 w-3" />[{visual.label}]
      </span>
      <span className="pointer-events-none relative truncate text-foreground" title={event.path}>
        {event.path}
      </span>
      <span className="pointer-events-none relative min-w-[3.75rem] text-right text-muted-foreground">
        {event.touchType === "write" && formatChurn(event)}
      </span>
      <button
        type="button"
        onClick={() => onJump(event)}
        className="relative text-[10px] text-primary opacity-80 underline-offset-2 hover:underline group-hover:opacity-100"
      >
        [Jump to call]
      </button>
      {event.snippet && (
        <span className="pointer-events-none relative col-start-2 col-end-6 truncate pt-0.5 text-muted-foreground">
          ─ &quot;{event.snippet}&quot;
        </span>
      )}
    </div>
  );
}

function buildGroups(
  session: SessionState,
  toolCalls: Record<string, ToolCallState>,
): TimelineGroup[] {
  const calls = session.toolCallIds.map((id) => toolCalls[id]).filter(Boolean);
  const turnLookup = buildTurnLookup(session);
  const events = calls.flatMap((call) => buildEvents(call, turnLookup)).sort((a, b) => a.ts - b.ts);
  const groups: TimelineGroup[] = [];

  for (const event of events) {
    const previous = groups[groups.length - 1];
    const previousEvent = previous?.events[previous.events.length - 1];
    const sameTurn = event.turnKey != null && event.turnKey === previousEvent?.turnKey;
    const withinGap = previousEvent != null && event.ts - previousEvent.ts <= 10_000;

    if (!previous || (!sameTurn && !withinGap)) {
      const turnNumber = event.turnLabel ?? `Turn ${groups.length + 1}`;
      groups.push({
        id: `${event.turnKey ?? "gap"}:${event.ts}:${groups.length}`,
        label: `${turnNumber} — ${formatTime(event.ts)}`,
        events: [event],
      });
      continue;
    }

    previous.events.push(event);
  }

  return groups;
}

function buildEvents(
  call: ToolCallState,
  turnLookup: ReturnType<typeof buildTurnLookup>,
): TouchEvent[] {
  const paths = pickPaths(call);
  const turn = turnLookup(call);
  return paths.map((path) => {
    const diffBlock = call.content.find((block) => block.kind === "diff" && block.path === path);
    const touchType = classifyTouch(call, Boolean(diffBlock));
    const diffStats =
      touchType === "write" ? summarizeDiff(diffBlock?.oldText, diffBlock?.newText) : undefined;

    return {
      ts: call.ts,
      callId: call.id,
      kind: call.kind,
      touchType,
      path,
      snippet: diffStats?.snippet,
      additions: diffStats?.additions,
      deletions: diffStats?.deletions,
      turnKey: turn?.key,
      turnLabel: turn?.label,
    };
  });
}

function pickPaths(call: ToolCallState): string[] {
  const paths = new Set<string>();

  for (const location of call.locations ?? []) addPath(paths, location.path);
  for (const block of call.content) addPath(paths, block.path);
  collectPathsFromUnknown(call.rawInput, paths);
  collectPathsFromUnknown(call.rawOutput, paths);

  return [...paths];
}

function collectPathsFromUnknown(value: unknown, paths: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) collectPathsFromUnknown(item, paths);
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, nested] of Object.entries(value)) {
    if (PATH_KEYS.has(key) && typeof nested === "string") addPath(paths, nested);
    if (Array.isArray(nested) || isRecord(nested)) collectPathsFromUnknown(nested, paths);
  }
}

function addPath(paths: Set<string>, path: string | undefined) {
  if (!path || !looksLikePath(path)) return;
  paths.add(path);
}

function looksLikePath(path: string) {
  if (path.length > 400 || /[\n\r]/.test(path)) return false;
  if (/^https?:\/\//.test(path)) return false;
  return path.includes("/") || /\.[A-Za-z0-9]{1,8}$/.test(path) || path.startsWith("~");
}

function classifyTouch(call: ToolCallState, hasDiff: boolean): TouchType {
  const text = `${call.kind} ${call.title}`.toLowerCase();
  const raw = isRecord(call.rawInput) ? call.rawInput : undefined;

  if (hasDiff || /(write|edit|patch|apply|create|delete|replace|move|rename)/.test(text)) {
    return "write";
  }
  if (/(execute|exec|shell|bash|terminal|run)/.test(text) || typeof raw?.command === "string") {
    return "exec";
  }
  return "read";
}

function summarizeDiff(oldText = "", newText = "") {
  let additions = 0;
  let deletions = 0;
  let snippet = "";

  for (const part of diffLines(oldText, newText)) {
    if (part.added) additions += countLines(part.value);
    if (part.removed) deletions += countLines(part.value);
    if (!snippet && (part.added || part.removed)) snippet = normalizeSnippet(part.value);
  }

  return { additions, deletions, snippet: trimSnippet(snippet) };
}

function countLines(text: string) {
  if (!text) return 0;
  const lines = text.split("\n").length;
  return text.endsWith("\n") ? lines - 1 : lines;
}

function normalizeSnippet(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function trimSnippet(text: string) {
  if (text.length <= 80) return text;
  return `${text.slice(0, 79)}…`;
}

function formatChurn(event: TouchEvent) {
  if (event.additions == null && event.deletions == null) return "";
  return `+${event.additions ?? 0} -${event.deletions ?? 0}`;
}

function touchVisual(type: TouchType) {
  switch (type) {
    case "write":
      return { label: "WRITE", Icon: Pencil, className: "text-amber-700 dark:text-amber-300" };
    case "exec":
      return {
        label: "EXEC",
        Icon: TerminalSquare,
        className: "text-violet-700 dark:text-violet-300",
      };
    default:
      return { label: "READ", Icon: Eye, className: "text-sky-700 dark:text-sky-300" };
  }
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function buildTurnLookup(session: SessionState) {
  const turns = extractSessionTurns(session);
  return (call: ToolCallState) => {
    const explicit = extractExplicitTurn(call);
    if (explicit) return explicit;
    if (turns.length === 0) return undefined;

    let turnIndex = 0;
    for (let index = 0; index < turns.length; index += 1) {
      if (turns[index].ts <= call.ts) turnIndex = index;
    }
    const turn = turns[turnIndex];
    return turn ? { key: turn.key, label: turn.label } : undefined;
  };
}

function extractSessionTurns(session: SessionState) {
  const withTurns = session as SessionState & { turns?: unknown };
  if (!Array.isArray(withTurns.turns)) return [];

  return withTurns.turns
    .map((turn, index) => {
      if (!isRecord(turn)) return undefined;
      const ts = numericField(turn, ["ts", "createdAt", "startedAt", "startTs", "timestamp"]);
      if (ts == null) return undefined;
      const key = stringField(turn, ["id", "turnId", "key"]) ?? String(index + 1);
      const labelIndex = numericField(turn, ["index", "turnIndex", "number"]) ?? index + 1;
      return { key, ts, label: `Turn ${labelIndex}` };
    })
    .filter((turn): turn is { key: string; ts: number; label: string } => Boolean(turn))
    .sort((a, b) => a.ts - b.ts);
}

function extractExplicitTurn(call: ToolCallState) {
  const record = call as unknown as Record<string, unknown>;
  const key = stringField(record, ["turnId", "parentTurnId", "parentTurn", "turnKey"]);
  const index = numericField(record, ["turnIndex", "parentTurnIndex"]);
  if (key == null && index == null) return undefined;
  return {
    key: key ?? String(index),
    label: `Turn ${index ?? key}`,
  };
}

function numericField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function stringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function scrollToToolCall(callId: string) {
  const win = window as Window & { scrollToToolCall?: (callId: string) => void };
  if (typeof win.scrollToToolCall === "function") {
    win.scrollToToolCall(callId);
    return;
  }

  const selector = `[data-tool-call-id="${escapeAttributeValue(callId)}"]`;
  const target = document.querySelector(selector) ?? document.getElementById(`tool-call-${callId}`);
  target?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function escapeAttributeValue(value: string) {
  return value.replace(/["\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
