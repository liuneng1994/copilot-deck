# Prompt Queue: Type & Queue While Agent Is Responding

Date: 2026-05-24
Status: Approved, ready to implement

## Problem

While the agent is streaming, the composer is locked: the textarea is
`disabled` and Send is replaced with Stop. Users can't draft their
next instruction until the current turn finishes — a poor fit for the
"think while it works" agentic workflow.

## Design

### Data (ui-store)

```ts
interface QueuedPrompt {
  id: string;
  text: string;
  attachments?: MessageAttachment[];
  ts: number;
}

queuedPrompts: Record<string /* sessionId */, QueuedPrompt[]>
enqueuePrompt(sid, prompt)
removeQueued(sid, id)
clearQueue(sid)
```

In-memory only — no persistence (refresh discards).

### Drain trigger

In `setSessionStatus(sid, next)`: when `prev === "streaming"` and
`next` is anything else (idle, error, cancelled), check the queue:
- if non-empty, pop the head, append it as a user message, set status
  back to `streaming`, send via WS.
- if `next === "awaiting_perm"`, do **not** drain (will retry once
  permission is resolved → status flips again).

### UX

1. Textarea always enabled (except `detached` / `reloading` / `crashed`).
2. Streaming placeholder:
   `"Agent responding — your next prompt will queue. ⌘↵ to enqueue"`.
3. Send button morphs to `"Queue"` when streaming (secondary style,
   distinct from primary Send). Stop button stays adjacent:
   `[Stop] [Queue]`.
4. New `QueuedPromptsBar` above the composer, only shown when
   `queue.length > 0`:
   ```
   🕒 Queued (2): "fix the typo…" ×  "add tests for auth" ×   [Clear all]
   ```
   Each item shows first 50 chars; ✕ removes it; "Clear all" empties.
5. When `awaiting_perm`, bar shows "paused — waiting on permission".

### Edge cases

- **Slash built-ins**: still run immediately; never enqueued.
- **Stop current turn**: queue preserved (user stopped this turn, not
  future intent). Explicit "Clear all" needed to discard.
- **Detached / crashed**: enqueue blocked; existing queue rendered
  greyed-out with "session detached" label.
- **Fan-out broadcast**: each session has its own queue. For a busy
  target session the prompt enqueues; for an idle one it sends
  immediately (existing behaviour, just now via per-session route).

### Keyboard

- Enter / ⌘↵: same as today — `send()` which now internally enqueues
  if streaming.
- Esc while streaming: Stop (unchanged); does NOT affect the queue.

## Out of scope

- Reorder / edit queued items (just remove + re-add).
- Persisting queue across reloads.
- Server-side queue (Copilot CLI is single-prompt anyway).
