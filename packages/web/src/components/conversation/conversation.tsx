import { useEffect, useRef } from "react";
import { useUIStore, type SessionState } from "../../stores/ui-store";
import { MessageBubble } from "./message-bubble";

export function Conversation({ session }: { session: SessionState }) {
  const ref = useRef<HTMLDivElement>(null);
  const messages = session.messages;

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
  }, [messages]);

  const lastIsAgent = messages[messages.length - 1]?.role === "agent";
  const streaming = session.status === "streaming";

  return (
    <div ref={ref} className="flex-1 min-h-0 overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-6">
        {messages.length === 0 && (
          <EmptyConversation cwd={session.cwd} />
        )}
        {messages.map((m, i) => (
          <MessageBubble
            key={m.id}
            message={m}
            streaming={streaming && i === messages.length - 1 && lastIsAgent}
          />
        ))}
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
