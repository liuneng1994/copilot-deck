import { ArrowDown, Pause } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type SessionState, type ToolCallState, useUIStore } from "../../stores/ui-store";
import { ActivityBar } from "./activity-bar";
import { MessageBubble } from "./message-bubble";
import { ToolCallCard } from "./tool-call-card";
import { ToolGroupCard } from "./tool-group-card";
import { TurnDiffSummary } from "./turn-diff-summary";

type TimelineItem =
  | { kind: "message"; ts: number; data: SessionState["messages"][number] }
  | { kind: "toolCall"; ts: number; data: ToolCallState }
  | { kind: "toolGroup"; ts: number; calls: ToolCallState[]; groupKey: string }
  | { kind: "turnSummary"; ts: number; turnId: string; toolCallIds: string[] };

const NEAR_BOTTOM_PX = 80;

/** Minimum adjacent tool calls (without intervening agent text) needed
 * to coalesce them into a folded group. Permission-required / failed
 * calls are excluded from grouping so the user always sees them. */
const TOOL_GROUP_THRESHOLD = 2;

function isGroupable(c: ToolCallState): boolean {
  if (c.status === "failed") return false;
  return true;
}

export function Conversation({ session }: { session: SessionState }) {
  const ref = useRef<HTMLDivElement>(null);
  const allToolCalls = useUIStore((s) => s.toolCalls);
  // `pinned` means the user explicitly scrolled away from the tail and wants
  // updates to stop auto-following until they jump back.
  const [pinned, setPinned] = useState(false);
  const itemCountRef = useRef(0);
  const pinnedRef = useRef(false);
  const [pendingCount, setPendingCount] = useState(0);
  // Tracks the last programmatic scroll so we can ignore it in the scroll
  // handler (otherwise auto-scrolling would itself appear as user motion).
  const programmaticScrollRef = useRef(0);

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

    // Inject a TurnDiffSummary at the END of each turn. A turn = sequence of
    // items starting at a user message, ending right before the next user
    // message (or end of list).
    const out: TimelineItem[] = [];
    let turnStartIdx = -1;
    let turnToolIds: string[] = [];
    let turnUserMsgId: string | null = null;
    const flushTurn = (insertBeforeIndex: number) => {
      if (turnStartIdx < 0 || turnToolIds.length < 2 || !turnUserMsgId) return;
      const ts =
        insertBeforeIndex > 0 && out.length > 0 ? out[out.length - 1].ts + 0.5 : Date.now();
      out.push({
        kind: "turnSummary",
        ts,
        turnId: turnUserMsgId,
        toolCallIds: turnToolIds,
      });
    };
    for (let i = 0; i < base.length; i++) {
      const it = base[i];
      const isUserMsg = it.kind === "message" && it.data.role === "user";
      if (isUserMsg) {
        flushTurn(i);
        turnStartIdx = i;
        turnToolIds = [];
        turnUserMsgId = it.data.id;
      } else if (it.kind === "toolCall") {
        turnToolIds.push(it.data.id);
      }
      out.push(it);
    }
    flushTurn(base.length);

    // Coalesce runs of >= TOOL_GROUP_THRESHOLD adjacent groupable tool calls
    // (no agent message in between) into a single folded ToolGroup item.
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
    return grouped;
  }, [session.messages, session.toolCallIds, allToolCalls]);

  const scrollToBottom = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    programmaticScrollRef.current = Date.now();
    el.scrollTop = el.scrollHeight;
    setPinned(false);
    pinnedRef.current = false;
    setPendingCount(0);
  }, []);

  // Auto-scroll to bottom on new content unless the user has pinned the view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on items change, ref reads are intentional
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const newCount = items.length;
    const added = newCount - itemCountRef.current;
    itemCountRef.current = newCount;
    if (pinnedRef.current) {
      if (added > 0) setPendingCount((c) => c + added);
      return;
    }
    requestAnimationFrame(() => {
      programmaticScrollRef.current = Date.now();
      el.scrollTop = el.scrollHeight;
    });
  }, [items]);

  // Watch user scrolls. Any upward scroll during streaming flips pinned=true.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let lastTop = el.scrollTop;
    const onScroll = () => {
      // Ignore programmatic scrolls that happened in the same tick.
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

  return (
    <div className="relative flex-1 min-h-0">
      <ActivityBar session={session} />
      <div ref={ref} data-conversation-root className="h-full overflow-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
          {session.crashed && <CrashBanner info={session.crashInfo} />}
          {items.length === 0 && !session.crashed && <EmptyConversation cwd={session.cwd} />}
          {items.map((it) => {
            if (it.kind === "toolCall") {
              return (
                <div key={`tc-${it.data.id}`} className="ml-10">
                  <ToolCallCard call={it.data} />
                </div>
              );
            }
            if (it.kind === "toolGroup") {
              return (
                <div key={`tg-${it.groupKey}`} className="ml-10">
                  <ToolGroupCard calls={it.calls} />
                </div>
              );
            }
            if (it.kind === "turnSummary") {
              return <TurnDiffSummary key={`ts-${it.turnId}`} toolCallIds={it.toolCallIds} />;
            }
            const m = it.data;
            return (
              <MessageBubble
                key={m.id}
                message={m}
                sessionId={session.id}
                streaming={streaming && m.id === lastMsg?.id && m.role === "agent"}
              />
            );
          })}
        </div>
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
