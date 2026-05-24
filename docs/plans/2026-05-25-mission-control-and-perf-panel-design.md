# Mission Control + Cost & Perf — Design

Date: 2026-05-25

## Goals

1. **Mission Control** — a multi-session dashboard so users can monitor all running/idle sessions at a glance without context-switching.
2. **Cost & Perf** — per-turn breakdown of time, tokens, cost, and heaviest tool; surfaced both in conversation (per-turn chip) and in a new Inspector tab (session overview + top-tools ranking).

## 1. Mission Control

### Entry
- App top-bar adds a new icon button next to History.
- `topView` union extends: `"workspace" | "history" | "mission-control"`.
- Clicking the button calls `setTopView("mission-control")`.

### Layout — wide list (one session per row)

```
[●] session-name · cwd-tail              [tokens]  [cost]  [duration]
    Activity: Editing src/foo.ts (3/5)            Last: "I'll refactor the…"
```

- Status dot: green = running, gray = idle, red = crashed.
- Activity line: reuses the derivation logic of `ActivityBar` (latest in-progress tool verb + path + ordinal of turn).
- Last line: last agent message, truncated to ~80 chars.
- Right-hand metrics: cumulative tokens / cost / session duration.

### Controls
- Top filter chips: `All` / `Running` / `Idle` / `Crashed`. Default = All.
- Sort: last-activity timestamp desc (no UI toggle in v1).

### Interaction
- Click row → `setActiveSession(id)` + `setTopView("workspace")`. One-way; to come back, click the top-bar button again.

### New / changed files
- `packages/web/src/components/mission-control/mission-control.tsx` (~150 lines).
- Extract activity derivation from `ActivityBar` into `useSessionActivity(sessionId)` hook (shared).
- `App.tsx` — branch on `topView === "mission-control"`.
- Top-bar — new icon button.

## 2. Cost & Perf

### Data layer — turn snapshots

Add to each session in `ui-store`:

```ts
turnSnapshots: Array<{
  turnIndex: number;
  userTs: number;
  endTs?: number;
  startTokensIn: number;
  startTokensOut: number;
  startCost: number;
  endTokensIn?: number;
  endTokensOut?: number;
  endCost?: number;
}>;
```

Lifecycle:
- On `user_message` → push new snapshot with current cumulative values as `start*`.
- On agent-turn completion (last `agent_message_complete` before next user message, or stop event) → fill in `end*` + `endTs`.
- In-progress turn (no `end*`) → only display duration + tool count; never display tokens/cost (avoids 0.001 → 0.003 → 0.007 flicker).

### Renderer 1 — Inspector "Perf" tab

- Session overview: total tokens / total cost / session duration / avg cost per turn / total turns.
- Per-turn table (most recent 50): `#` | duration | Δ tokens | Δ cost | heaviest tool name.
- Top tools ranking (top 10, by total wall-clock time desc): tool name | total time | call count.

### Renderer 2 — Conversation per-turn chip

A compact row at the end of each user turn:
- Completed turn: `⏱ 4.2s · 📝 1.2k tok · 💰 $0.018 · 🔧 read_file` (click to expand tool-time breakdown).
- In-progress turn: `⏱ 4.2s · 🔧 3 ops` (no token/cost numbers).

### New / changed files
- `packages/web/src/components/inspector/perf/index.tsx`
- `packages/web/src/components/conversation/turn-perf-row.tsx`
- `packages/web/src/lib/perf-aggregate.ts` — pure functions (snapshot diffs, top-tools ranking).
- `ui-store.ts` — `turnSnapshots`, snapshot push/finalize logic, `inspectorTab` adds `"perf"`.

## 3. Data flow / error handling

- Mission Control is a pure derived view — no new WS ops.
- Cost & Perf reuses existing `usage_update` + message stream; no server-side changes.
- Lazy-load interaction: hydrate returns only the last 300 messages, so `turnSnapshots` cover only loaded turns. After `load_older_messages` succeeds, rebuild snapshots best-effort from the new range.
- If cumulative counters go backwards (rare; server reset), the diff shows "—" instead of a negative number.

## 4. Out of scope (YAGNI)

- Cost trend charts (line/bar).
- Cross-session cost comparison beyond the right-hand metrics in Mission Control.
- CSV export.
- Sort toggle / search box in Mission Control (revisit if session count grows past ~30).
