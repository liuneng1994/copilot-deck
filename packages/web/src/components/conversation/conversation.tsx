import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, Loader2, Pause } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type SessionState, type ToolCallState, useUIStore } from "../../stores/ui-store";
import { ActivityBar } from "./activity-bar";
import { MessageBubble } from "./message-bubble";
import { ToolCallCard } from "./tool-call-card";
import { ToolGroupCard } from "./tool-group-card";
import { TurnDiffSummary } from "./turn-diff-summary";
import { TurnPerfRow } from "./turn-perf-row";

type TimelineItem =
  | { kind: "loadOlder"; ts: number }
  | { kind: "message"; ts: number; data: SessionState["messages"][number] }
  | { kind: "toolCall"; ts: number; data: ToolCallState }
  | { kind: "toolGroup"; ts: number; calls: ToolCallState[]; groupKey: string }
  | { kind: "turnSummary"; ts: number; turnId: string; toolCallIds: string[] }
  | { kind: "turnPerf"; ts: number; turnId: string };

const NEAR_BOTTOM_PX = 80;
const TOOL_GROUP_THRESHOLD = 2;

function isGroupable(c: ToolCallState): boolean {
  if (c.status === "failed") return false;
  return true;
}

function itemKey(it: TimelineItem): string {
  switch (it.kind) {
    case "loadOlder":
      return "__load_older__";
    case "message":
      return `m-${it.data.id}`;
    case "toolCall":
      return `tc-${it.data.id}`;
    case "toolGroup":
      return `tg-${it.groupKey}`;
    case "turnSummary":
      return `ts-${it.turnId}`;
    case "turnPerf":
      return `tp-${it.turnId}`;
  }
}

export function Conversation({ session }: { session: SessionState }) {
  const ref = useRef<HTMLDivElement>(null);
  const allToolCalls = useUIStore((s) => s.toolCalls);
  const loadOlder = useUIStore((s) => s.loadOlderMessages);
  const [pinned, setPinned] = useState(false);
  const itemCountRef = useRef(0);
  const pinnedRef = useRef(false);
  const [pendingCount, setPendingCount] = useState(0);
  const programmaticScrollRef = useRef(0);

  const hasOlder = (session.totalMessages ?? session.messages.length) > session.messages.length;

  const items: TimelineItem[] = useMemo(() => {
    const base: TimelineItem[] = session.messages.map((m) => ({
      kind: "message",
      ts: m.ts,
      data: m,
    }));
    for (const id of session.toolCallIds) {
      const c = allToolCalls[id];
      if (c) base.push({ kind: "toolCall", ts: c.ts, data: c });
    }
    base.sort((a, b) => a.ts - b.ts);

    // Inject TurnDiffSummary at end of each turn (same rules as before) and
    // a TurnPerfRow chip for every turn (regardless of tool count).
    const out: TimelineItem[] = [];
    let turnStartIdx = -1;
    let turnToolIds: string[] = [];
    let turnUserMsgId: string | null = null;
    const flushTurn = () => {
      if (turnStartIdx < 0 || !turnUserMsgId) return;
      const baseTs = out.length > 0 ? out[out.length - 1].ts + 0.5 : Date.now();
      if (turnToolIds.length >= 2) {
        out.push({
          kind: "turnSummary",
          ts: baseTs,
          turnId: turnUserMsgId,
          toolCallIds: turnToolIds,
        });
      }
      out.push({ kind: "turnPerf", ts: baseTs + 0.1, turnId: turnUserMsgId });
    };
    for (let i = 0; i < base.length; i++) {
      const it = base[i];
      const isUserMsg = it.kind === "message" && it.data.role === "user";
      if (isUserMsg) {
        flushTurn();
        turnStartIdx = i;
        turnToolIds = [];
        turnUserMsgId = it.data.id;
      } else if (it.kind === "toolCall") {
        turnToolIds.push(it.data.id);
      }
      out.push(it);
    }
    flushTurn();

    // Coalesce runs of >= TOOL_GROUP_THRESHOLD adjacent groupable tool calls.
    const grouped: TimelineItem[] = [];
    let buf: ToolCallState[] = [];
    const flushBuf = () => {
      if (buf.length === 0) return;
      if (buf.length >= TOOL_GROUP_THRESHOLD) {
        grouped.push({
          kind: "toolGroup",
          ts: buf[0].ts,
          calls: buf,
          groupKey: `${buf[0].id}-${buf.length}`,
        });
      } else {
        for (const c of buf) {
          grouped.push({ kind: "toolCall", ts: c.ts, data: c });
        }
      }
      buf = [];
    };
    for (const it of out) {
      if (it.kind === "toolCall" && isGroupable(it.data)) {
        buf.push(it.data);
        continue;
      }
      flushBuf();
      grouped.push(it);
    }
    flushBuf();

    if (hasOlder) {
      grouped.unshift({ kind: "loadOlder", ts: Number.NEGATIVE_INFINITY });
    }
    return grouped;
  }, [session.messages, session.toolCallIds, allToolCalls, hasOlder]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => ref.current,
    estimateSize: () => 120,
    overscan: 8,
    getItemKey: (i) => itemKey(items[i]),
  });

  const scrollToBottom = useCallback(() => {
    const el = ref.current;
    if (!el || items.length === 0) return;
    programmaticScrollRef.current = Date.now();
    virtualizer.scrollToIndex(items.length - 1, { align: "end" });
    // Fallback in case virtualizer hasn't measured the last row yet.
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
    setPinned(false);
    pinnedRef.current = false;
    setPendingCount(0);
  }, [items.length, virtualizer]);

  // Preserve scroll anchor when older items are prepended at the top.
  const firstVisibleKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (pinnedRef.current) {
      const first = virtualizer.getVirtualItems()[0];
      firstVisibleKeyRef.current = first ? String(first.key) : null;
    }
  });

  // Auto-scroll to bottom on new content unless pinned. When pinned and items
  // were prepended (older history loaded), anchor scroll to keep the
  // previously-first item visible.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on items change
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const newCount = items.length;
    const added = newCount - itemCountRef.current;
    itemCountRef.current = newCount;
    if (pinnedRef.current) {
      // Prepended older content: keep view stable on the anchor item if we
      // know it, otherwise just bump pendingCount for tail growth.
      const anchorKey = firstVisibleKeyRef.current;
      if (anchorKey) {
        const anchorIdx = items.findIndex((it) => itemKey(it) === anchorKey);
        if (anchorIdx > 0) {
          programmaticScrollRef.current = Date.now();
          virtualizer.scrollToIndex(anchorIdx, { align: "start" });
          return;
        }
      }
      if (added > 0) setPendingCount((c) => c + added);
      return;
    }
    requestAnimationFrame(() => {
      programmaticScrollRef.current = Date.now();
      virtualizer.scrollToIndex(items.length - 1, { align: "end" });
      // Hard fallback for unmeasured rows.
      el.scrollTop = el.scrollHeight;
    });
  }, [items]);

  // Watch user scrolls. Any upward scroll during streaming flips pinned=true.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let lastTop = el.scrollTop;
    const onScroll = () => {
      if (Date.now() - programmaticScrollRef.current < 50) {
        lastTop = el.scrollTop;
        return;
      }
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const atBottom = distance < NEAR_BOTTOM_PX;
      const scrolledUp = el.scrollTop < lastTop;
      lastTop = el.scrollTop;

      if (atBottom) {
        if (pinnedRef.current) {
          pinnedRef.current = false;
          setPinned(false);
          setPendingCount(0);
        }
      } else if (scrolledUp && !pinnedRef.current) {
        pinnedRef.current = true;
        setPinned(true);
      }
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const lastMsg = session.messages[session.messages.length - 1];
  const streaming = session.status === "streaming";
  const showJump = pinned;
  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="relative flex-1 min-h-0">
      <ActivityBar session={session} />
      <div ref={ref} data-conversation-root className="h-full overflow-auto">
        {session.crashed && (
          <div className="mx-auto max-w-3xl px-6 pt-6">
            <CrashBanner info={session.crashInfo} />
          </div>
        )}
        {items.length === 0 && !session.crashed ? (
          <div className="mx-auto max-w-3xl px-6 py-6">
            <EmptyConversation cwd={session.cwd} />
          </div>
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px` }} className="relative w-full">
            {virtualItems.map((vi) => {
              const it = items[vi.index];
              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-2">
                    <RenderItem
                      it={it}
                      sessionId={session.id}
                      streaming={streaming}
                      lastMsgId={lastMsg?.id}
                      historyLoading={!!session.historyLoading}
                      remaining={
                        (session.totalMessages ?? session.messages.length) - session.messages.length
                      }
                      onLoadOlder={() => loadOlder(session.id)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {pinned && streaming && (
        <div className="pointer-events-none absolute right-6 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
          <Pause className="h-3 w-3" />
          Follow paused
        </div>
      )}
      {showJump && (
        <button
          type="button"
          onClick={scrollToBottom}
          title="Resume follow & jump to latest"
          className="absolute bottom-4 right-6 z-10 flex h-9 items-center gap-1.5 rounded-full border border-border bg-panel-elevated px-3 text-xs text-foreground shadow-md transition-colors hover:bg-muted"
        >
          <ArrowDown className="h-3.5 w-3.5" />
          {pendingCount > 0 ? `${pendingCount} new` : "Jump to latest"}
        </button>
      )}
    </div>
  );
}

function RenderItem({
  it,
  sessionId,
  streaming,
  lastMsgId,
  historyLoading,
  remaining,
  onLoadOlder,
}: {
  it: TimelineItem;
  sessionId: string;
  streaming: boolean;
  lastMsgId: string | undefined;
  historyLoading: boolean;
  remaining: number;
  onLoadOlder: () => void;
}) {
  if (it.kind === "loadOlder") {
    return (
      <div className="flex justify-center py-2">
        <button
          type="button"
          onClick={onLoadOlder}
          disabled={historyLoading}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-panel-elevated px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:opacity-60"
        >
          {historyLoading ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> Loading older…
            </>
          ) : (
            <>↑ Load older ({remaining})</>
          )}
        </button>
      </div>
    );
  }
  if (it.kind === "toolCall") {
    return (
      <div className="ml-10">
        <ToolCallCard call={it.data} />
      </div>
    );
  }
  if (it.kind === "toolGroup") {
    return (
      <div className="ml-10">
        <ToolGroupCard calls={it.calls} />
      </div>
    );
  }
  if (it.kind === "turnSummary") {
    return <TurnDiffSummary toolCallIds={it.toolCallIds} />;
  }
  if (it.kind === "turnPerf") {
    return <TurnPerfRowWrapper sessionId={sessionId} turnId={it.turnId} />;
  }
  const m = it.data;
  return (
    <MessageBubble
      message={m}
      sessionId={sessionId}
      streaming={streaming && m.id === lastMsgId && m.role === "agent"}
    />
  );
}

function CrashBanner({ info }: { info?: { code: number | null; signal: string | null } }) {
  return (
    <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
      <div className="font-medium">Copilot child process exited.</div>
      <p className="mt-1 text-rose-800/80 dark:text-rose-200/80">
        This session can no longer accept prompts. Create a new session for the same workspace to
        continue.
        {info && (
          <span className="ml-2 font-mono text-[10px] opacity-70">
            code={info.code ?? "?"} signal={info.signal ?? "?"}
          </span>
        )}
      </p>
    </div>
  );
}

function TurnPerfRowWrapper({ sessionId, turnId }: { sessionId: string; turnId: string }) {
  const session = useUIStore((s) => s.sessions[sessionId]);
  if (!session) return null;
  return <TurnPerfRow session={session} turnUserMsgId={turnId} />;
}

function EmptyConversation({ cwd }: { cwd: string }) {
  return (
    <div className="mt-16 flex flex-col items-center text-center">
      <div className="mb-3 text-3xl">💬</div>
      <h3 className="text-base font-semibold">Session ready</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Working in <span className="font-mono">{cwd}</span>. Send your first prompt below.
      </p>
    </div>
  );
}

export function NoSessionPlaceholder() {
  const sessions = useUIStore((s) => s.sessions);
  const count = Object.keys(sessions).length;
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <div className="mb-3 text-4xl">🤖</div>
        <h3 className="text-base font-semibold">No session selected</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {count === 0
            ? "Create your first Copilot session from the sidebar."
            : "Pick a session from the sidebar to view its conversation."}
        </p>
      </div>
    </div>
  );
}
