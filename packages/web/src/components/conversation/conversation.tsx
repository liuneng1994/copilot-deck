import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type SessionState, type ToolCallState, useUIStore } from "../../stores/ui-store";
import { MessageBubble } from "./message-bubble";
import { ToolCallCard } from "./tool-call-card";

type TimelineItem =
  | { kind: "message"; ts: number; data: SessionState["messages"][number] }
  | { kind: "toolCall"; ts: number; data: ToolCallState };

export function Conversation({ session }: { session: SessionState }) {
  const ref = useRef<HTMLDivElement>(null);
  const allToolCalls = useUIStore((s) => s.toolCalls);
  const [showJump, setShowJump] = useState(false);

  const items: TimelineItem[] = useMemo(() => {
    const out: TimelineItem[] = session.messages.map((m) => ({
      kind: "message",
      ts: m.ts,
      data: m,
    }));
    for (const id of session.toolCallIds) {
      const c = allToolCalls[id];
      if (c) out.push({ kind: "toolCall", ts: c.ts, data: c });
    }
    out.sort((a, b) => a.ts - b.ts);
    return out;
  }, [session.messages, session.toolCallIds, allToolCalls]);

  const scrollToBottom = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  // Auto-scroll to bottom on new content (unless user scrolled up).
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on items change, ref reads are intentional
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (nearBottom) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [items]);

  // Track whether user has scrolled away from the bottom so we can offer a
  // jump-back affordance. Threshold matches the auto-scroll heuristic.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowJump(distance > 240);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const lastMsg = session.messages[session.messages.length - 1];
  const streaming = session.status === "streaming";

  return (
    <div className="relative flex-1 min-h-0">
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
      {showJump && (
        <button
          type="button"
          onClick={scrollToBottom}
          title="Jump to latest"
          className="absolute bottom-4 right-6 z-10 flex h-9 items-center gap-1.5 rounded-full border border-border bg-panel-elevated px-3 text-xs text-foreground shadow-md transition-colors hover:bg-muted"
        >
          <ArrowDown className="h-3.5 w-3.5" />
          Jump to latest
        </button>
      )}
    </div>
  );
}

function CrashBanner({ info }: { info?: { code: number | null; signal: string | null } }) {
  return (
    <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
      <div className="font-medium">Copilot child process exited.</div>
      <p className="mt-1 text-rose-200/80">
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
