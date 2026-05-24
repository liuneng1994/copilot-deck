import { Clock, X } from "lucide-react";
import { type SessionState, useUIStore } from "../../stores/ui-store";

/**
 * Strip / shorten queued-prompt text for chip display. We keep this
 * deliberately tight so a long queue stays one line on typical widths.
 */
function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 50 ? `${flat.slice(0, 50)}…` : flat || "(empty)";
}

export function QueuedPromptsBar({ session }: { session: SessionState }) {
  const queue = useUIStore((s) => s.queuedPrompts[session.id] ?? []);
  const remove = useUIStore((s) => s.removeQueuedPrompt);
  const clear = useUIStore((s) => s.clearQueuedPrompts);

  if (queue.length === 0) return null;

  const paused =
    session.status === "awaiting_perm" || session.detached || session.crashed;

  return (
    <div className="mx-auto mb-1.5 flex max-w-3xl flex-wrap items-center gap-1.5 px-3 text-[11px] text-muted-foreground">
      <Clock className="h-3 w-3 shrink-0 opacity-70" />
      <span className="font-medium text-foreground">
        Queued ({queue.length})
        {paused && (
          <span className="ml-1 text-warn">
            — {session.detached || session.crashed ? "session detached" : "paused, awaiting permission"}
          </span>
        )}
        :
      </span>
      {queue.map((q, i) => (
        <span
          key={q.id}
          className="group inline-flex max-w-[260px] items-center gap-1 rounded-md border border-border bg-panel-elevated px-1.5 py-0.5 font-mono"
        >
          {i === 0 && <span className="text-[9px] uppercase text-primary">next</span>}
          <span className="truncate" title={q.text}>
            {preview(q.text)}
          </span>
          {q.localAttachments && q.localAttachments.length > 0 && (
            <span className="text-[9px] text-muted-foreground">
              📎{q.localAttachments.length}
            </span>
          )}
          <button
            type="button"
            onClick={() => remove(session.id, q.id)}
            className="ml-0.5 rounded p-0.5 opacity-60 transition-opacity hover:bg-muted hover:opacity-100"
            title="Remove from queue"
            aria-label="Remove from queue"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => clear(session.id)}
        className="ml-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider hover:bg-muted hover:text-foreground"
      >
        Clear all
      </button>
    </div>
  );
}
