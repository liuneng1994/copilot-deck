# Copilot-friendly Conversation Denoise v2: Compact view + Activity bar

Date: 2026-05-24
Status: Approved, ready to implement
Supersedes: the "Reasoning highlight" half of 2026-05-24-conversation-denoise-design.md

## Why a second pass

The paragraph-level reasoning highlight from v1 collapsed because
Copilot CLI's streamed prose has no paragraph separators — chunks
arrive as a running monologue ("…queue state:Good. Now let me…").
Any heuristic that wraps "paragraphs" wraps the entire turn.

Instead, give the user direct control + a live indicator of what the
agent is currently doing.

## Module F — Compact view

Global persisted toggle `compactView` (localStorage key
`agent-view:compact-view:v1`, default OFF). When ON:

- `ToolCallCard`: renders a single-line chip — icon, title, file
  hint, status badge. Click to expand restores the current full body.
  Default state in compact mode is collapsed.
- `ToolGroupCard`: unaffected (it's already a single chip).
- `MessageBubble` agent text: bumps to `text-[15px]` (from default
  ~14px) for slightly more prominence; no color change.

Toggle lives in the session-header `⋯` menu as
`🗒 Compact view: on/off`.

## Module E — Sticky "currently doing" activity bar

In `Conversation`, when `session.status === "streaming"`:

- Render a thin sticky bar at the top of the conversation viewport
  showing the most recent in-progress (or, if none, most recent
  started) tool call for that session:
  `🔧 editing src/auth.ts · 3rd op this turn`
- Bar shows kind icon (read/edit/search/shell/fetch), short label,
  short file hint, and a tiny "Nth op this turn" counter (counted
  back to the most recent user message).
- Disappears immediately when status leaves streaming.

This is positional (top of conversation, above the timeline) and
non-blocking — text still scrolls under it.

## Data

No store schema changes beyond `compactView: boolean` +
`setCompactView`.

## Out of scope

- Reasoning highlight, narration dimming, step parsing — all
  abandoned as too fragile against Copilot output style.
- Activity bar history / clickability — just a passive indicator.
