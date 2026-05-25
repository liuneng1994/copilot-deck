# Copilot instructions for this repository

## Build, test, and lint commands

- Install dependencies with `pnpm install` using Node.js 22+.
- Start the isolated development stack with `pnpm dev`. This runs the server on port `4010`, the Vite web app on port `5174`, and uses `~/.copilot-deck-dev` so it does not collide with an installed `copilot-deck`.
- Run package dev servers directly with `pnpm --filter @agent-view/server dev` and `pnpm --filter @agent-view/web dev`; Vite proxies `/api` and `/ws` to `AGENT_VIEW_SERVER_PORT` or `4000`.
- Build everything with `pnpm build`. This builds server/web/shared first, then bundles the published CLI package.
- Typecheck with `pnpm typecheck`, or a single workspace with `pnpm --filter @agent-view/web typecheck`, `pnpm --filter @agent-view/server typecheck`, etc.
- Lint/format with Biome: `pnpm lint` and `pnpm format`.
- Run the CLI smoke test with `pnpm build` first, then `pnpm smoke:cli`.
- Run all Playwright e2e tests with `pnpm exec playwright test e2e\tests`.
- Run the current single e2e test with `pnpm exec playwright test e2e\tests\files-v2.spec.ts -g "Files Tab v2"`.

## High-level architecture

This is a pnpm workspace for a browser UI around GitHub Copilot CLI over ACP:

- `packages/shared` is the contract layer. It exports the curated model list and typed `ClientToServer` / `ServerToClient` WebSocket protocol. When adding or changing wire messages, update shared types first, then server handlers and the web bridge/store.
- `packages/server` is a Fastify app. `src/main.ts` wires REST routes, `/ws`, static web serving for bundled CLI mode, extension watchers, file watchers, `Store`, `ProcessHost`, and `SessionManager`.
- `SessionManager` owns live Copilot child processes keyed by `${cwd}::${model}`, session lifecycle, reattach/fork/import, model overrides, sticky permission decisions, traces, prompt attachment caps, and pre-prompt git checkpoints. Each `CopilotAgent` wraps `copilot --acp --stdio` and an ACP `ClientSideConnection`.
- ACP `sessionUpdate` notifications are mirrored into SQLite by `acp/persist.ts` and broadcast over WebSocket. Persistence is best-effort so UI streaming can continue even if a local DB write fails.
- `Store` uses `better-sqlite3` with WAL and manages `sessions`, `messages`, `tool_calls`, `session_files`, `permissions`, `trace_events`, `checkpoints`, and `messages_fts`. The data directory defaults to `~/.copilot-deck`, with legacy `AGENT_VIEW_DB` and `COPILOT_DECK_HOME` overrides.
- `packages/web` is a Vite + React app using Zustand. `lib/ws-client.ts` owns reconnecting WebSocket transport; `lib/ws-bridge.ts` translates typed server/ACP messages into `stores/ui-store.ts` and slices such as `files-slice.ts`. REST calls cover file previews, git actions, search, history, storage, extensions, and checkpoints.
- `packages/cli` is the published `copilot-deck` npm bin. It launches the bundled server/web assets, picks a port near `4173`, writes a pid file under the resolved data directory, supports detached mode, and exposes doctor/status/stop/version/upgrade/data-dir commands.
- Extension support is split between server parsers/routes under `packages/server/src/extensions` and web settings panels. MCP servers, Copilot plugins, marketplaces, and skills can be user/workspace/plugin scoped.

## Key conventions

- TypeScript is strict ESM. Node-side local imports in server/CLI/shared source use `.js` specifiers even when importing `.ts` files.
- Biome enforces two-space indentation, double quotes, semicolons, organized imports, and a 100-character line width. The repo intentionally allows explicit `any` and non-null assertions.
- Server REST and WS payloads should use types from `@agent-view/shared` where they cross the web/server boundary.
- WebSocket message handling is deliberately split: `main.ts` owns connection lifecycle and special cases such as background tasks, while `ws-handlers.ts` maps regular `ClientToServer["type"]` values to handlers.
- The web client treats SQLite/server state as authoritative for sessions, messages, tool calls, checkpoints, permissions, and reviewed files. Local storage is used for UI-only state such as drafts, prompt history, panes, filters, and preferences.
- File APIs must stay scoped to an active or hydrated session cwd. Use `assertWithinCwd` for file reads/writes/open-in-editor paths, and keep paths absolute at API boundaries where existing routes expect them.
- Files tab data is git-driven: dirty/staged/untracked state comes from git status, generated files are classified by `files-overview/classify.ts`, and agent attribution is overlaid from recorded tool locations/session files.
- E2E tests avoid the real Copilot CLI. The Playwright test creates a temporary git repo, temporary SQLite DB, and fake ACP-compatible `copilot` script via `COPILOT_CLI_PATH`.
- Prompt flow details matter: non-slash prompts create git checkpoints before agent work; forks inject prior context through a one-shot `fork_prefix`; render hints can be injected as `AGENTS.md`, as a first-prompt prefix, or disabled.
