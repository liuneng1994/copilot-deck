import { Clock3, Coins, Wrench } from "lucide-react";
import {
  aggregateSession,
  formatCost,
  formatDuration,
  formatTokens,
} from "../../../lib/perf-aggregate";
import type { SessionState } from "../../../stores/ui-store";
import { useUIStore } from "../../../stores/ui-store";

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-panel-elevated px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-1 font-mono text-sm text-foreground">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function PerfTab({ session }: { session: SessionState }) {
  const toolCalls = useUIStore((s) => s.toolCalls);
  const perf = aggregateSession(session, toolCalls);
  const avgCost =
    perf.totals.completedTurnCount > 0 ? perf.totals.cost / perf.totals.completedTurnCount : 0;
  const lastTurns = perf.turns.slice(-50).reverse();

  return (
    <div className="space-y-3 px-2 pb-3 text-xs">
      {/* Session overview */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard
          icon={Clock3}
          label="duration"
          value={formatDuration(perf.totals.durationMs)}
          sub={`${perf.totals.turnCount} turn${perf.totals.turnCount === 1 ? "" : "s"}`}
        />
        <StatCard
          icon={Coins}
          label="tokens"
          value={
            perf.totals.tokensIn + perf.totals.tokensOut > 0
              ? formatTokens(perf.totals.tokensIn + perf.totals.tokensOut)
              : "—"
          }
          sub={
            perf.totals.tokensIn || perf.totals.tokensOut
              ? `${formatTokens(perf.totals.tokensIn)} in / ${formatTokens(perf.totals.tokensOut)} out`
              : undefined
          }
        />
        <StatCard
          icon={Coins}
          label="cost"
          value={formatCost(perf.totals.cost, session.costCurrency)}
          sub={
            perf.totals.completedTurnCount > 0
              ? `${formatCost(avgCost, session.costCurrency)} / turn avg`
              : undefined
          }
        />
      </div>

      {/* Top tools */}
      <section>
        <div className="mb-1 flex items-center gap-1.5 px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Wrench className="h-3 w-3" />
          Top tools by time
        </div>
        {perf.topTools.length === 0 ? (
          <div className="rounded border border-dashed border-border px-3 py-3 text-center text-muted-foreground">
            No tool calls yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded border border-border">
            <table className="w-full text-left">
              <thead className="bg-muted text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 font-normal">Tool</th>
                  <th className="px-2 py-1 text-right font-normal">Time</th>
                  <th className="px-2 py-1 text-right font-normal">Calls</th>
                </tr>
              </thead>
              <tbody>
                {perf.topTools.map((t) => (
                  <tr key={t.kind} className="border-t border-border/60">
                    <td className="truncate px-2 py-1 font-mono">{t.kind}</td>
                    <td className="px-2 py-1 text-right font-mono">
                      {t.totalMs > 0 ? formatDuration(t.totalMs) : "—"}
                    </td>
                    <td className="px-2 py-1 text-right font-mono text-muted-foreground">
                      {t.count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Per-turn table */}
      <section>
        <div className="mb-1 px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          Per-turn (latest first, up to 50)
        </div>
        {lastTurns.length === 0 ? (
          <div className="rounded border border-dashed border-border px-3 py-3 text-center text-muted-foreground">
            No turns yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded border border-border">
            <table className="w-full text-left">
              <thead className="bg-muted text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 font-normal">#</th>
                  <th className="px-2 py-1 font-normal">Duration</th>
                  <th className="px-2 py-1 text-right font-normal">Δ tok</th>
                  <th className="px-2 py-1 text-right font-normal">Δ cost</th>
                  <th className="px-2 py-1 font-normal">Heaviest</th>
                </tr>
              </thead>
              <tbody>
                {lastTurns.map((t) => {
                  const delta =
                    t.deltaTokensIn !== undefined || t.deltaTokensOut !== undefined
                      ? (t.deltaTokensIn ?? 0) + (t.deltaTokensOut ?? 0)
                      : undefined;
                  return (
                    <tr key={t.userMsgId} className="border-t border-border/60">
                      <td className="px-2 py-1 font-mono text-muted-foreground">
                        {t.turnIndex + 1}
                        {t.inProgress && (
                          <span className="ml-1 text-[9px] text-amber-600 dark:text-amber-300">
                            live
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1 font-mono">{formatDuration(t.durationMs)}</td>
                      <td className="px-2 py-1 text-right font-mono">
                        {delta !== undefined ? formatTokens(delta) : "—"}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">
                        {t.deltaCost !== undefined
                          ? formatCost(t.deltaCost, session.costCurrency)
                          : "—"}
                      </td>
                      <td className="truncate px-2 py-1 font-mono text-muted-foreground">
                        {t.heaviestTool
                          ? `${t.heaviestTool.name} (${formatDuration(t.heaviestTool.durationMs)})`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
