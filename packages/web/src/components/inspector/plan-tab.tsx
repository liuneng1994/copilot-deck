import { Check, Circle, Loader2 } from "lucide-react";
import type { PlanEntry, SessionState } from "../../stores/ui-store";

const PRIORITY_BADGE: Record<NonNullable<PlanEntry["priority"]>, string> = {
  low: "border-border bg-muted text-muted-foreground",
  medium: "border-warn/40 bg-warn/10 text-warn",
  high: "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

/** Render the most recent ACP plan emitted for the session. */
export function PlanTab({ session }: { session: SessionState }) {
  const plan = session.plan ?? [];
  if (plan.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
        No plan emitted yet for this session.
      </div>
    );
  }

  const completed = plan.filter((e) => e.status === "completed").length;
  const total = plan.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="space-y-2 px-2 py-1">
      <div className="flex items-center justify-between px-1 text-[10px] text-muted-foreground">
        <span>
          {completed} of {total} done
        </span>
        <span>{pct}%</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded bg-muted">
        <div
          className="h-full bg-success transition-all"
          style={{ width: `${pct}%` }}
          aria-hidden="true"
        />
      </div>
      <ul className="space-y-1.5 pt-1">
        {plan.map((entry, idx) => (
          <li
            key={`${idx}-${entry.content.slice(0, 32)}`}
            className="flex items-start gap-2 rounded-md border border-border bg-panel-elevated px-2 py-1.5 text-xs"
          >
            <PlanStatusIcon status={entry.status} />
            <div className="min-w-0 flex-1">
              <div
                className={
                  entry.status === "completed"
                    ? "line-through text-muted-foreground"
                    : "text-foreground"
                }
              >
                {entry.content || <span className="italic text-muted-foreground">(empty)</span>}
              </div>
              {entry.priority && (
                <span
                  className={`mt-1 inline-block rounded border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${PRIORITY_BADGE[entry.priority]}`}
                >
                  {entry.priority}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanStatusIcon({ status }: { status?: PlanEntry["status"] }) {
  if (status === "completed") {
    return <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />;
  }
  if (status === "in_progress") {
    return <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />;
  }
  return <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}
