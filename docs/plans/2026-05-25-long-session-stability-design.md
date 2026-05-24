# Long Session Stability: Virtualization + Lazy History

Date: 2026-05-25
Status: Approved, ready to implement
Scope: A (timeline virtualization) + B (memory/persistence/lazy-load)
Out of scope: C (session compact via fork) — deferred

## Problem

Long sessions (200+ turns, thousands of tool calls) suffer:
1. UI jank — `items.map(...)` mounts everything; scroll & input lag
2. Silent message truncation — ui-store FIFO drops oldest after 2000
3. `toolCalls` grows unbounded per session
4. Hydration payload grows linearly with history

`compactView` toggle is a CSS-only escape hatch and does not address any
of the above. CLI-side LLM context cannot be controlled from the server
(no ACP API), so that risk is left to a future Compact-via-Fork feature.

## Layer A — Timeline virtualization

- Library: `@tanstack/react-virtual` (~3KB, headless, modern React)
- `Conversation` is rewritten around `useVirtualizer`:
  - `count = items.length`
  - `estimateSize = () => 120` (rough; measure mode handles real heights)
  - `overscan = 8`
  - Scroll element = the existing `data-conversation-root` div
- "Follow tail / pinned / jump to latest" preserved:
  - `pinned` becomes "user scrolled away from the last virtual index"
  - `scrollToBottom` becomes `virtualizer.scrollToIndex(items.length - 1)`
  - `pendingCount` ticks when items grow while pinned
- `ActivityBar` unchanged (it's positionally pinned, not in the list)

## Layer B — Memory + persistence + lazy history

### Server

New `store` methods:
- `countMessages(sessionId): number`
- `listMessagesPaged(sessionId, { beforeTs?, limit }): PersistedMessage[]`
  — returns most-recent `limit` messages with `ts < beforeTs` (or
  most-recent overall when `beforeTs` is undefined), in ascending order
- `listToolCallsInRange(sessionId, { fromTs, toTs }): PersistedToolCall[]`

`hydrate()` change:
- Sessions in the hydrate payload carry only the **last 300 messages**
  and only the tool_calls whose `ts >= earliestLoadedMessage.ts`
- Each hydrated session also carries:
  - `totalMessages: number`
  - `earliestLoadedTs: number | null`

WS protocol additions (`@agent-view/shared`):
- C2S: `{ type: "load_older_messages", sessionId, beforeTs, limit }`
- S2C: `{ type: "older_messages", sessionId, messages: [...],
  toolCalls: [...], earliestLoadedTs, hasMore }`

### Client (ui-store)

- New per-session fields stored on `SessionState`:
  - `totalMessages: number` — authoritative count from server
  - `earliestLoadedTs: number | null`
  - `historyLoading: boolean`
- Action `loadOlderMessages(sessionId)`:
  - sends WS op with current `earliestLoadedTs`
  - on response, prepends messages, merges toolCalls
- `toolCalls` cap per session: **500**, FIFO oldest evicted on every
  upsert that overflows
- `messages` cap per session: kept at current 2000 ceiling as safety
  valve — but no longer truncates silently; once a session exceeds it
  via user-driven `loadOlderMessages`, the prepend is rejected with a
  notice ("Loaded enough history; clear and reopen to see more"). In
  practice rare; the 300 default + 500 tool calls keeps sessions well
  under any per-tab budget.

### UI

- New `LoadOlderBar` rendered as the first virtual item when
  `session.totalMessages > session.messages.length`:
  - Shows "N earlier messages · Load older"
  - Click → `loadOlderMessages(session.id)`
  - Spinner while `historyLoading`
- "Load older" preserves scroll anchor: after prepend, virtualizer
  scrolls so the previously-first item stays in view

## Migration / compatibility

Both server and web ship together; no protocol negotiation needed.
Hydrated sessions without `totalMessages` (e.g. from old persisted
snapshot in localStorage) default to `messages.length`.

## Testing strategy

- Manual: open a synthetic session with 600 messages → confirm initial
  render < 200ms, smooth scroll, "Load older" works, tool grouping
  still triggers when scrolling into a dense region.
- Existing tests: ensure WS protocol changes don't break ws-bridge
  fixtures.
