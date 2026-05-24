# Copilot-Triggered Background Tasks + Fleet Visibility — Design

Date: 2026-05-25
Status: Approved (brainstorm); awaiting implementation plan.

## Problem

Today, when Copilot CLI (running as ACP server inside deck) decides to run a
daemon-style command — `npm run dev`, `vite`, `uvicorn`, anything that doesn't
exit — the whole prompt turn hangs forever. Two root causes:

1. **deck declines the ACP terminal extension.** `copilot-agent.ts` sends
   `terminal: false` in `initialize`, so Copilot falls back to its internal
   `bash` tool, which in ACP mode loses its native `mode: "async"` / `detach`
   shortcut and just runs synchronously.
2. **ACP has no `is_background` field.** The protocol's `createTerminal` only
   supports "spawn and wait for exit"; there is no way for an agent to tell the
   client "this is a daemon, don't block on it."

Comparable agent CLIs (Claude Code's `Bash.run_in_background`, Gemini CLI's
`run_shell_command.is_background`, Copilot CLI's internal `bash` async mode)
all solve this at the model layer, but none of that surfaces through ACP.
deck must polyfill it client-side.

A related but separate gap: Copilot's `/fleet` mode spawns parallel
subagents via a `task` tool. ACP has no nested-session concept, so today
deck just shows an opaque `task` tool call with no visibility into the
subagent.

## Goals

1. Daemon commands invoked by Copilot no longer hang the turn.
2. User controls when a foreground terminal becomes a background task —
   no opaque heuristics.
3. Background output survives a deck reload and is browseable.
4. Foreground terminals live in the conversation, background ones live in
   the Tasks tab. State change = location change.
5. Surface fleet subagents read-only in the conversation so the user can
   tell what Copilot is fanning out.

## Non-Goals

- Adding an `is_background` field to the ACP protocol or asking agents to
  send one. We work with what ACP defines today.
- Automatic daemon-detection heuristics. No regex on `npm run dev`, no
  port-listen sniffing, no "30 seconds elapsed → auto-background." These
  guess wrong and silently change user intent.
- A `/bg <cmd>` slash command for user-started bg tasks. The existing
  `bg_task_start` WS path already covers this.
- Two-way fleet control: cancelling subagents, calling `read_agent` on the
  user's behalf, exposing subagent turn streams. ACP doesn't model this and
  faking it with synthetic prompts would pollute history.
- Treating subagents as first-class deck sessions in the session list. The
  subagent runs inside the Copilot CLI process; we have no ACP channel to
  it.

## Architecture

### 1. Enable ACP terminal extension

`copilot-agent.ts` flips `terminal: true` and registers the five required
client methods: `createTerminal`, `terminalOutput`, `waitForTerminalExit`,
`releaseTerminal`, `killTerminal`. All five delegate to a single
**ProcessHost** singleton (see §2). This makes deck the terminal owner;
Copilot stops spawning execute commands in-process and routes them through
us.

**Verification gate (do before merging):** capture a real Copilot session
with `terminal: true` and confirm Copilot CLI 1.0.53 actually issues
`createTerminal` calls instead of falling back to its internal bash. A
declared capability isn't a guarantee of use. If Copilot ignores it, the
whole approach is moot and we revisit.

### 2. Unified ProcessHost

Today's `BgTaskManager` (165 lines, `child_process.spawn` with `shell:true`,
in-memory 64 KB tail buffer, 1 h auto-reap) becomes the foundation for a
single **ProcessHost** that owns every shell process deck spawns. One
process model, one event stream, one storage path.

Each process is one entry with these fields:

| field | values |
|---|---|
| `origin` | `"acp-terminal"` \| `"user-bg"` |
| `mode` | `"foreground"` \| `"background"` |
| `acpTerminalId` | non-null when `origin === "acp-terminal"` |
| `sessionId` | ACP session that created it (or initiated `bg_task_start`) |
| `status` | `starting` \| `running` \| `exited` \| `error` \| `released` |

WS messages already in shared (`bg_task_start`, `bg_task_update`,
`bg_task_output`, `bg_task_stop`) stay; we add `terminal_*` mirror events
carrying the same shape plus `acpTerminalId` so the web client can map them
to conversation cards.

Spawning: same `child_process.spawn(..., {shell: true})` we use today. No
node-pty. Copilot's CLI already strips colors when `FORCE_COLOR=0`; we keep
that env policy for both origins.

### 3. ACP terminal method semantics

- **`createTerminal`**: ProcessHost spawns; entry starts as
  `{origin: "acp-terminal", mode: "foreground", status: starting}`; returns
  a new `acpTerminalId` (UUID). The matching deck `processId` is recorded
  so we can look it up by either key.
- **`terminalOutput`**: read the tail buffer (capped at the ACP
  `outputByteLimit`, default 64 KB) plus an `exitStatus` if the process has
  ended. If the user has moved the terminal to background, we synthesize
  exit status (see below) on first read after the move.
- **`waitForTerminalExit`**: returns a promise that resolves on real exit
  **or** on user "move to background." In the latter case we resolve with
  `{exitCode: 0, signal: null}` and append a deck-injected line to the
  buffer:

  ```
  [deck] Moved to background as task <task-id>. Process continues; check the Tasks tab.
  ```

  Copilot sees a clean exit plus an informational line and continues its
  turn. The actual process keeps running under ProcessHost; its further
  output is no longer visible to Copilot.
- **`releaseTerminal`**: if `mode === "foreground"`, kill the process and
  drop the entry. If `mode === "background"`, leave the process alone
  (release only the ACP id mapping — the entry is now owned by the user via
  the Tasks tab).
- **`killTerminal`**: send SIGTERM, then SIGKILL after 2 s.

### 4. Foreground-to-background transition

UI button on the foreground terminal card. Click → web sends a new WS
message `terminal_move_to_background({processId})`. Server:

1. Mark the entry `mode = "background"`.
2. Resolve the pending `waitForTerminalExit` for this acpTerminalId with
   the synthetic exit + injected text.
3. Future `terminalOutput` calls return the buffer with that final exit
   status.
4. Emit `bg_task_update` so the Tasks tab shows the entry.

The UI removes the card from the conversation (state change = position
change) and the card reappears in the Tasks tab. The original conversation
keeps a small inert "Moved to background → task #abc" chip in the timeline
so the history is honest about what happened.

### 5. 3-second "looks long-running" hint

On the foreground card client-side: `setTimeout(highlight, 3000)`. After 3
s of `running` status the "Move to background" button highlights and a
small toast appears: "This command is still running. Move it to the
background?" No server-side logic, no auto-action.

### 6. Disk persistence

Logs stream to `<deck-data-dir>/terminals/<processId>.log` (UTF-8, append).
Mirror, not replace, the in-memory tail. Reading priority:

- UI live mode → in-memory tail buffer (existing behavior).
- UI "Show full log" or reload after restart → file.

Cleanup: on startup, delete files older than 7 days; cap directory to 200
most-recent files (matches `MAX_TASKS`). No SQLite changes.

### 7. UI placement

| state | location |
|---|---|
| Foreground ACP terminal | Embedded in conversation as a tool-call-style card (header, scrolling output, "Move to background" button) |
| Background (post-move) | Inspector → Tasks tab; conversation shows static "moved to bg" chip |
| User-started `bg_task_start` | Inspector → Tasks tab (unchanged from today) |
| Fleet subagent (read-only) | Embedded in conversation as a new "Subagent" card (see §8) |

### 8. Fleet Level 1 (subagent visibility)

When deck observes a `session/update` `tool_call` with `name === "task"`
(or whatever Copilot's exact tool name is — verify in a live capture), the
web renders it as a Subagent card instead of a generic tool call. The card
shows:

- `agent_type` (`explore` / `general-purpose` / `code-review` / etc.) as
  an icon
- truncated `prompt` from `rawInput`
- live status from `tool_call_update` events: `running` / `done` /
  `failed`
- on completion, expandable section with the result text from the
  tool_call_update content

Pure presentational. No `read_agent` calls, no cancellation, no
nested-session UI. Reusable component placed next to the existing tool-call
renderer.

## Data Flow Examples

### Copilot starts `npm run dev`, user backgrounds it

1. Copilot → `createTerminal({command: "npm run dev"})`
2. ProcessHost spawns child, returns `acpTerminalId`. Entry created
   `{mode: foreground, status: starting}`.
3. Copilot → `waitForTerminalExit({acpTerminalId})`. Promise stored.
4. Output streams via `terminalOutput` polling + our WS push. Conversation
   card shows live output.
5. 3 s elapses → button highlights client-side.
6. User clicks "Move to background."
7. Server flips `mode = background`, resolves the
   `waitForTerminalExit` promise with `exit 0` + appended `[deck] Moved
   to background...` line.
8. Copilot receives clean exit, continues turn, sees the deck note in its
   tool output context window.
9. UI: card disappears from conversation, replaced by inert chip; entry
   appears in Tasks tab. Process keeps running, logs keep streaming to
   file and tail.

### Copilot uses fleet

1. Copilot → `session/update` tool_call: `{name: "task", rawInput:
   {agent_type: "explore", prompt: "...", mode: "background"}}`
2. Web renders the Subagent card (running spinner, agent type icon,
   prompt summary).
3. Copilot's subagent finishes internally; Copilot emits `tool_call_update`
   with content.
4. Card flips to "done" and shows the summarized result.

## Error Handling

- **`createTerminal` spawn fails:** respond with ACP error (use existing
  `respondErr` pattern from session-manager).
- **Process exits before `waitForTerminalExit` is called:** existing
  BgTaskManager already buffers exit status; reuse that.
- **Move to background while process has already exited:** no-op except UI
  state cleanup.
- **deck restart while background process is still alive:** child process
  is killed by SIGHUP (child has shell:true, no detach). Acceptable for
  v1; we don't promise survival across deck restarts. Document this.
- **Disk full / log write fails:** swallow the error after first warning,
  keep streaming to memory only. Do not crash the process.

## Testing Strategy

Reuse existing patterns (vitest in `packages/server`, no e2e setup yet).

- Unit tests for ProcessHost: spawn → output → exit, move-to-background
  resolves pending waiter, kill terminates real process, log file matches
  buffer.
- Mock ACP requests in a small harness that calls
  `createTerminal` → `waitForTerminalExit` and asserts synthetic exit text
  after a move.
- Smoke test the fleet card with a recorded `tool_call` fixture (no need
  to launch real Copilot in CI).

Manual verification gate before merging:
1. Real Copilot session: run a daemon command, verify it goes through
   `createTerminal`, verify "move to background" + Copilot continues
   reasoning.
2. Real Copilot fleet: trigger `/fleet` + a task that spawns subagents,
   verify card renders and updates.

## Out of Scope (Future Work)

- Persistent background processes across deck restarts (would need detach
  + reparenting; significant complexity)
- Auto-detection heuristics (revisit only if user feedback demands)
- Fleet Level 2 (read_agent polling, cancellation)
- Migrating `BgTaskManager` to PTY for richer output (cursor codes, TUIs)
