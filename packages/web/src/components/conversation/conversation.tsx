import { useEffect, useMemo, useRef } from "react";
import { useUIStore, type SessionState, type ToolCallState } from "../../stores/ui-store";
import { MessageBubble } from "./message-bubble";
import { ToolCallCard } from "./tool-call-card";

type TimelineItem =
  | { kind: "message"; ts: number; data: SessionState["messages"][number] }
  | { kind: "toolCall"; ts: number; data: ToolCallState };

export function Conversation({ session }: { session: SessionState }) {
  const ref = useRef<HTMLDivElement>(null);
  const allToolCalls = useUIStore((s) => s.toolCalls);

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

  // Auto-scroll to bottom on new content (unless user scrolled up).
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

  const lastMsg = session.messages[session.messages.length - 1];
  const streaming = session.status === "streaming";

  return (
    <div ref={ref} className="flex-1 min-h-0 overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
        {items.length === 0 && <EmptyConversation cwd={session.cwd} />}
        {items.map((it) => {
          if (it.kind === "toolCall") {
            return <ToolCallCard key={`tc-${it.data.id}`} call={it.data} />;
          }
          const m = it.data;
          return (
            <MessageBubble
              key={m.id}
              message={m}
              streaming={streaming && m.id === lastMsg?.id && m.role === "agent"}
            />
          );
        })}
      </div>
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
