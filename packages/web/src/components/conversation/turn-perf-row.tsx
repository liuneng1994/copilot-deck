import { ChevronDown, ChevronRight, Clock3, Coins, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { aggregateTurns, formatCost, formatDuration, formatTokens } from "../../lib/perf-aggregate";
import type { SessionState } from "../../stores/ui-store";
import { useUIStore } from "../../stores/ui-store";

/** Compact per-turn perf chip rendered at the tail of each user turn. */
export function TurnPerfRow({
  session,
  turnUserMsgId,
}: {
  session: SessionState;
  turnUserMsgId: string;
}) {
  const toolCalls = useUIStore((s) => s.toolCalls);
  const [expanded, setExpanded] = useState(false);

  const turn = useMemo(() => {
    const all = aggregateTurns(session, toolCalls);
    return all.find((t) => t.userMsgId === turnUserMsgId) ?? null;
  }, [session, toolCalls, turnUserMsgId]);

  if (!turn) return null;

  const totalTokens =
    turn.deltaTokensIn !== undefined || turn.deltaTokensOut !== undefined
      ? (turn.deltaTokensIn ?? 0) + (turn.deltaTokensOut ?? 0)
      : undefined;

  const toolDurations = turn.toolCalls
    .map((c) => ({
      name: c.kind || c.title || "tool",
      ms: c.finishedAt ? Math.max(0, c.finishedAt - c.startedAt) : 0,
    }))
    .filter((t) => t.ms > 0)
    .sort((a, b) => b.ms - a.ms);

  return (
    <div className="ml-10 mt-1">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-2 rounded-full border border-border bg-panel-elevated/60 px-2.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="inline-flex items-center gap-1">
          <Clock3 className="h-3 w-3" />
          {formatDuration(turn.durationMs)}
        </span>
        {turn.inProgress ? (
          <span className="inline-flex items-center gap-1">
            <Wrench className="h-3 w-3" />
            {turn.toolCalls.length} op{turn.toolCalls.length === 1 ? "" : "s"}
          </span>
        ) : (
          <>
            {totalTokens !== undefined && totalTokens > 0 && (
              <span className="inline-flex items-center gap-1">
                <Coins className="h-3 w-3" />
                {formatTokens(totalTokens)} tok
              </span>
            )}
            {turn.deltaCost !== undefined && turn.deltaCost > 0 && (
              <span className="font-mono">{formatCost(turn.deltaCost, session.costCurrency)}</span>
            )}
            {turn.heaviestTool && (
              <span className="inline-flex items-center gap-1 font-mono text-foreground/70">
                <Wrench className="h-3 w-3" />
                {turn.heaviestTool.name}
              </span>
            )}
          </>
        )}
      </button>
      {expanded && toolDurations.length > 0 && (
        <div className="mt-1 max-w-md rounded border border-border bg-panel-elevated p-2 text-[10px]">
          <div className="mb-1 text-muted-foreground">Tool time breakdown</div>
          <ul className="space-y-0.5">
            {toolDurations.map((t, i) => (
              <li key={`${t.name}-${i}`} className="flex justify-between font-mono">
                <span className="truncate">{t.name}</span>
                <span className="text-muted-foreground">{formatDuration(t.ms)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
