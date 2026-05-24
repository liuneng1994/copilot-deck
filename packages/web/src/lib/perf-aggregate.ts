import type { SessionState, ToolCallState, TurnSnapshot } from "../stores/ui-store";

export interface TurnAggregate {
  turnIndex: number;
  userMsgId: string;
  userTs: number;
  endTs: number;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** Cumulative-counter deltas; undefined when snapshot lacks data
   * (e.g. hydrated turns before snapshot tracking). */
  deltaTokensIn?: number;
  deltaTokensOut?: number;
  deltaCost?: number;
  toolCalls: ToolCallState[];
  /** Heaviest tool by wall-clock time within this turn. */
  heaviestTool?: { name: string; durationMs: number };
  /** True while the turn is still streaming. */
  inProgress: boolean;
}

export interface ToolRankEntry {
  kind: string;
  totalMs: number;
  count: number;
}

export interface SessionPerf {
  turns: TurnAggregate[];
  topTools: ToolRankEntry[];
  totals: {
    tokensIn: number;
    tokensOut: number;
    cost: number;
    durationMs: number;
    turnCount: number;
    completedTurnCount: number;
  };
}

function toolDuration(c: ToolCallState): number {
  if (!c.finishedAt) return 0;
  return Math.max(0, c.finishedAt - c.startedAt);
}

function safeDelta(end: number | undefined, start: number): number | undefined {
  if (end === undefined) return undefined;
  const d = end - start;
  if (!Number.isFinite(d) || d < 0) return undefined;
  return d;
}

/** Build per-turn aggregates by walking user messages and slicing tool calls
 * by `startedAt` between turn boundaries. Uses `turnSnapshots` for accurate
 * Δ tokens/cost when available, otherwise leaves those fields undefined.
 */
export function aggregateTurns(
  session: SessionState,
  toolCalls: Record<string, ToolCallState>,
): TurnAggregate[] {
  const userMsgs = session.messages.filter((m) => m.role === "user");
  if (userMsgs.length === 0) return [];
  const allCalls = session.toolCallIds
    .map((id) => toolCalls[id])
    .filter((c): c is ToolCallState => !!c);
  const snapByUserId = new Map<string, TurnSnapshot>();
  for (const s of session.turnSnapshots ?? []) {
    snapByUserId.set(s.userMsgId, s);
  }
  const now = Date.now();
  const out: TurnAggregate[] = [];
  for (let i = 0; i < userMsgs.length; i++) {
    const u = userMsgs[i];
    const nextU = userMsgs[i + 1];
    const turnEnd = nextU ? nextU.ts : now;
    const snap = snapByUserId.get(u.id);
    const inProgress = !nextU && session.status === "streaming";
    const calls = allCalls.filter((c) => c.startedAt >= u.ts && c.startedAt < turnEnd);
    // Heaviest by duration; skip in-progress (no finishedAt → 0).
    let heaviest: { name: string; durationMs: number } | undefined;
    for (const c of calls) {
      const d = toolDuration(c);
      if (d <= 0) continue;
      if (!heaviest || d > heaviest.durationMs) {
        heaviest = { name: c.kind || c.title || "tool", durationMs: d };
      }
    }
    const endTs = snap?.endTs ?? (nextU ? nextU.ts : now);
    out.push({
      turnIndex: i,
      userMsgId: u.id,
      userTs: u.ts,
      endTs,
      durationMs: Math.max(0, endTs - u.ts),
      deltaTokensIn: snap ? safeDelta(snap.endTokensIn, snap.startTokensIn) : undefined,
      deltaTokensOut: snap ? safeDelta(snap.endTokensOut, snap.startTokensOut) : undefined,
      deltaCost: snap ? safeDelta(snap.endCost, snap.startCost) : undefined,
      toolCalls: calls,
      heaviestTool: heaviest,
      inProgress,
    });
  }
  return out;
}

/** Rank tools by total wall-clock time across the whole session. */
export function rankTools(
  session: SessionState,
  toolCalls: Record<string, ToolCallState>,
  limit = 10,
): ToolRankEntry[] {
  const totals = new Map<string, { totalMs: number; count: number }>();
  for (const id of session.toolCallIds) {
    const c = toolCalls[id];
    if (!c) continue;
    const key = c.kind || c.title || "tool";
    const cur = totals.get(key) ?? { totalMs: 0, count: 0 };
    cur.totalMs += toolDuration(c);
    cur.count += 1;
    totals.set(key, cur);
  }
  return Array.from(totals.entries())
    .map(([kind, v]) => ({ kind, ...v }))
    .sort((a, b) => b.totalMs - a.totalMs || b.count - a.count)
    .slice(0, limit);
}

export function aggregateSession(
  session: SessionState,
  toolCalls: Record<string, ToolCallState>,
): SessionPerf {
  const turns = aggregateTurns(session, toolCalls);
  const topTools = rankTools(session, toolCalls, 10);
  const completed = turns.filter((t) => !t.inProgress);
  return {
    turns,
    topTools,
    totals: {
      tokensIn: session.tokensIn ?? 0,
      tokensOut: session.tokensOut ?? 0,
      cost: session.costAmount ?? 0,
      durationMs: Math.max(0, Date.now() - session.createdAt),
      turnCount: turns.length,
      completedTurnCount: completed.length,
    },
  };
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m - h * 60}m`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatCost(amount: number, currency = "USD"): string {
  if (!Number.isFinite(amount) || amount === 0) return "—";
  const symbol = currency === "USD" ? "$" : "";
  return `${symbol}${amount.toFixed(amount < 1 ? 4 : 2)}`;
}
