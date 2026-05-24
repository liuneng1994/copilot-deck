import { Loader2 } from "lucide-react";
import type { SessionState } from "../../stores/ui-store";
import { iconForKind } from "./tool-icons";
import { useSessionActivity } from "./use-session-activity";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function ActivityBar({ session }: { session: SessionState }) {
  const activity = useSessionActivity(session.id);
  if (!activity) return null;
  const Icon = iconForKind(activity.kind);
  return (
    <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 flex justify-center px-6 pt-2">
      <div className="pointer-events-auto inline-flex max-w-full items-center gap-2 truncate rounded-full border border-border bg-panel-elevated/95 px-3 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
        {activity.inProgress ? (
          <Loader2 className="h-3 w-3 animate-spin text-primary" />
        ) : (
          <Icon className="h-3 w-3 text-primary" />
        )}
        <span className="font-medium text-foreground">{activity.verb}</span>
        {activity.location && (
          <span className="truncate font-mono text-foreground/80" title={activity.location}>
            {activity.location}
          </span>
        )}
        <span className="text-muted-foreground">·</span>
        <span>{ordinal(activity.opIndex)} op this turn</span>
      </div>
    </div>
  );
}
