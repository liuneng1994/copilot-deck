# Files Tab — Git-Driven Refactor

**Date**: 2026-05-24
**Status**: approved
**Decisions**: β (git-primary + agent badge) · A (work-tree focused scope) · A (non-repo = empty state)

## Problem

The Files tab currently merges two unrelated streams:

1. Live `git status --porcelain` (dirty / untracked) — naturally drains on commit.
2. **Agent-touched files** derived from the persistent `tool_calls` SQLite table — never drains; entries linger forever as long as the session exists.

This means after `git commit`, files the agent touched **stay visible in the Files tab** even though the working tree is clean. There is no TTL, no commit-hash linkage, and `reviewed_at` only adds a checkmark — it does not hide the entry.

## Goal

Files tab becomes a focused **work-tree inspector** with `git status` as the single source of truth. The "this file was touched by Copilot in this session" information survives only as a non-list-changing badge.

## Design

### Backend

`buildOverview` in `packages/server/src/files-overview/route.ts`:

- **Drop** synthesis of `FileEntry` rows from `aggregateTouched` results.
- **Keep** `aggregateTouched` to compute a `Set<rel>` of agent-touched paths in this cwd. Return as a separate top-level `agentTouched: string[]` field on the overview response.
- List composition becomes: iterate `gitStatus.files`, map each to a `FileEntry` with `source: "dirty" | "untracked" | "staged"`.
- Non-repo (`isRepo: false`): return `{ touched: [], agentTouched: [] }`; client renders empty state.

Stats fields (`added`, `removed`, `callCount`, `lastTouchAt`) on `FileEntry` are no longer populated from tool_calls. They become optional and unset for plain git rows. They may still be populated downstream by the client side per-file diff hover if useful — out of scope here.

### Shared types

`packages/shared/src/index.ts`:

- `FileEntry.source` is narrowed: remove the `"agent"` variant. Allowed values: `"dirty" | "untracked" | "staged"`.
- The `FilesOverview` response type gains `agentTouched: string[]` (relative paths).
- This is a **breaking wire change** but the wire is purely internal between this monorepo's server and web; no external consumers.

### Web

`packages/web/src/components/inspector/files/index.tsx` and `file-row.tsx`:

- Read `agentTouched` from the overview response. Cache as a `Set` on the store.
- In `FileRow`, if `entry.rel ∈ agentTouched`, render a small 🤖 icon (lucide `Bot`) next to the filename with tooltip "Touched by Copilot this session".
- Remove the "source: agent" branch in row rendering (no more `agent` badge style — git status decoration takes over).
- When `isRepo === false`, render an empty state inside the Files panel: a small icon plus copy "Not a git repository — initialize git to track changes here." No fallback list.

### Preserved

- `markReviewed` / `reviewed_at` semantics (still useful before commit lands).
- diff preview, reveal-in-editor, copy path, grep panel, tree panel — unchanged.
- `session_files` table — still backs the reviewed checkmark.

### Removed

- `aggregateTouched` building synthetic `FileEntry` rows (agentic source).
- Web rendering branch for `source: "agent"`.
- The "non-repo fallback to agent-touched" implicit code path.

## Verification

1. **Live test**: In a git repo, ask Copilot to edit a file → Files tab shows it with 🤖 badge → `git add . && git commit -m test` → entry disappears.
2. **User edit**: Manually edit a file (no agent involvement) → entry appears, no badge.
3. **Non-repo**: Create a session whose cwd is not a git repo → Files tab shows empty state.
4. **Reviewed flag**: Mark a dirty file reviewed → checkmark still toggles. Commit → entry disappears (reviewed flag becomes irrelevant for now-clean file).

## Out of Scope

- Tree view, log view, blame, hunk staging (covered in design-doc options B / C / D).
- Migrating `reviewed_at` to a per-commit anchor.
- New `git status` granularity (e.g., per-hunk status).

## Estimated Effort

~150 LOC. One commit.
