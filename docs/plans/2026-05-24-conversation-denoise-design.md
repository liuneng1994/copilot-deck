# Conversation Denoise: Tool Grouping + Reasoning Highlight

Date: 2026-05-24
Status: Approved, ready to implement

## Problem

In long agent turns the timeline is dominated by tool-call cards
(`grep`, `view`, `edit`, …). The model's actual prose — its plan,
its reasoning between steps, its summary — is visually buried. Users
want to see "what is the model thinking / what problem is it solving"
at a glance, not "the model called 17 tools".

## Goals

1. Drastically reduce visual weight of tool calls without losing access.
2. Promote agent reasoning prose so it reads like a narrative.
3. Pure client-side; no extra LLM calls, no server protocol changes.

Non-goals: cross-turn plan view, two-pane layout, server-side summarization.

## Design

### Module A — Tool group folding

A new component `tool-group-card.tsx`. Before render, a small reducer
in `conversation.tsx` walks the timeline and collapses **runs of ≥2
adjacent tool calls within the same agent turn**, with no intervening
agent text, into a single group node.

Visual (folded, default):

```
🔧 5 operations · 3 read · 2 edit · src/auth.ts (+2 more)         ▸
```

- Status: all-success → muted; any failure → red border; in-flight → blue pulse.
- Tools requiring permission or that have failed are **excluded from
  the group** and rendered individually so the user never misses them.
- Click `▸` expands inline to the existing `tool-call-card` list.
- Expand state is component-local (not persisted) — fold by default each load.

### Module B — Reasoning highlight

In `message-bubble.tsx` agent branch: split text on `\n\n`. For each
paragraph, run a cheap heuristic; matched paragraphs render in a
`<ReasoningBlock>` (3px left accent bar, slightly larger leading,
subtle tinted background).

Heuristics (any match):

1. Markdown header: starts with `##` or `###`.
2. Plan list: paragraph is a sequence of `1. `, `2. `, … or `- [ ]`.
3. Lead-verb regex (case-insensitive) at paragraph start:
   `(let me|i'll|i will|i'm going to|now i|first,|next,|finally|让我|我会|我将|接下来|首先|然后|最后|现在)`.
4. **First and last paragraphs** of each agent message are always highlighted
   (opening plan / closing summary).

A toggle in the session header (`🧠 Highlight reasoning`) persists to
localStorage (`agent-view:reasoning-highlight:v1`, default ON). When OFF,
heuristic is skipped and prose renders flat.

### Data flow

No store changes. Both modules are pure render-layer transforms on the
existing `messages[]` and `toolCalls{}` already in `ui-store`.

### Edge cases

- A tool group whose status changes (e.g. last call fails mid-stream)
  re-renders with red border; user sees the new status without expanding.
- If reasoning highlight is enabled and the **whole** message is one
  paragraph, it's treated as reasoning (first==last).
- `turn-diff-summary` (existing) renders **after** any tool group in
  that turn — unchanged.

### Testing

Manual: a long Copilot turn with mixed reads/edits/grep + prose. Verify:
- Tool groups appear and fold/expand.
- Failed tool stays out of the group.
- Reasoning blocks appear on opening and closing prose; toggle works
  and persists across reload.
- No regression in single-tool turns (no group should form).

## Out of scope

- LLM-based per-turn summary
- Two-column layout
- Server-side aggregation
