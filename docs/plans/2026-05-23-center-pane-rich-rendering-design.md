# Center Pane Rich Rendering — Design

Date: 2026-05-23
Status: Approved

## Goal

Upgrade the central conversation pane from "markdown + code blocks" to a multi-modal
renderer that gives Copilot CLI / ACP agent output the same readability ceiling as
Claude Artifacts and ChatGPT Canvas, while keeping the chat flow uncluttered.

Coverage targets:
- Inline rich rendering (tables / Mermaid / KaTeX / JSON tree / collapse / shell-cmd)
- Tool-call result specialised renderers (ls/grep/bash/edit/web_fetch/image)
- An artifact split pane to the right of the chat (Claude-style) for long content

## Non-Goals

- Server-side artifact protocol. ACP does not model artifacts; the client classifies.
- Embedding a real browser/runtime — HTML preview is sandboxed iframe only.
- Replacing the inspector (Plan/Files/Tools/Term). Artifact pane lives in the centre
  column, independent of the inspector.

## Architecture

```
packages/web/src/
└─ lib/
   └─ content-renderer/
      ├─ classify.ts          // markdown AST + tool-result walker → ContentItem[]
      ├─ types.ts             // ContentItem discriminated union
      ├─ thresholds.ts        // size triggers / forced types
      └─ renderers/
         ├─ table.tsx         // TanStack Table (sort/filter/resize/CSV export)
         ├─ mermaid.tsx       // lazy import, srcdoc fallback
         ├─ katex.tsx
         ├─ json-tree.tsx
         ├─ shell-cmd.tsx     // copy + run-in-term (permission-gated)
         ├─ csv-chart.tsx     // CSV → recharts
         ├─ html-sandbox.tsx
         └─ code-collapse.tsx
└─ stores/
   └─ artifact-store.ts       // zustand slice: { id, sessionId, type, title, sourceMsgId, payload }
└─ components/
   ├─ artifact/
   │  ├─ artifact-pane.tsx    // tabs + body + footer (centre-pane right split)
   │  ├─ artifact-tab.tsx
   │  └─ artifact-body.tsx
   ├─ conversation/
   │  ├─ message-bubble.tsx   // (modified) calls classify(), inserts thumbs
   │  ├─ tool-call-card.tsx   // (modified) dispatch table by kind/name
   │  └─ thumbnails/
   │     ├─ table-thumb.tsx
   │     ├─ mermaid-thumb.tsx
   │     ├─ json-thumb.tsx
   │     └─ code-thumb.tsx
   └─ layout/
      └─ centre-pane.tsx      // (modified) <Chat | Artifact> split, resizable
```

## Content Classification

Single walker over the markdown mdast tree + raw tool-result objects, producing
`ContentItem`s with metadata. Renderer dispatch lives in one place so heuristics
stay co-located.

```ts
type ContentItem =
  | { kind: "text"; text: string }
  | { kind: "code"; lang?: string; text: string; lines: number }
  | { kind: "table"; rows: string[][]; header: string[] }
  | { kind: "mermaid"; src: string }
  | { kind: "math"; tex: string; display: boolean }
  | { kind: "json"; value: unknown; lines: number }
  | { kind: "csv"; rows: string[][]; header: string[] }
  | { kind: "html"; src: string }
  | { kind: "svg"; src: string }
  | { kind: "shell"; commands: { cmd: string; cwd?: string }[] };
```

### Hoist policy (matrix)

| Kind | Inline | Hoist trigger | Artifact view |
|---|---|---|---|
| table | TanStack thumb (3-row preview) | rows ≥ 8 | full table + sort/filter/resize/CSV export/search |
| csv | thumb + chart icon | always | table + auto-chart tab (Recharts) |
| mermaid | rendered thumb (img-via-svg) + chip | always | live mermaid + source toggle + zoom |
| math | inline KaTeX | never | — |
| json | folded tree (root + key count) | lines ≥ 80 | tree + path search + copy |
| html | not inline (security) | always | sandboxed iframe |
| svg | thumb | always | inline SVG + raw source toggle |
| code | CodeBlock + line nums + fold (> 40 lines collapses middle) | lines ≥ 60 | full text + line nums + copy + download |
| shell | "copy" / "run in term" buttons (perm-gated) | never | — |

Thumbnails are clickable: they call `artifactStore.focus(id)`, which opens the
artifact pane and selects the tab. A "↗ open" icon on every rich block opens
even items below the auto-hoist threshold.

## Tool-Call Result Renderers

`tool-call-card.tsx` becomes a dispatcher keyed off `kind` + `name`:

| Kind / name | Renderer |
|---|---|
| `read` / `view` | file chip with line range, click → inspector files tab, preview body folded |
| `ls` / `glob` / `find` | grid of file cards (icon + size + relative path), click → inspector |
| `grep` | grouped by file, each match as `path:line  snippet` row, click → jump |
| `bash` / `execute` | stdout / stderr tabs, exit-code badge, long output (>40 lines) collapses middle, copy/run-again buttons |
| `edit` / `write` | existing diff view + 3-way toggle (diff / before / after) |
| `web_fetch` | link card (favicon + title + word count), full body hoisted to artifact |
| image output | thumbnail + lightbox |

Existing diff rendering stays as-is; we wrap it in the new dispatcher.

## Artifact Pane

- **Placement**: centre pane is wrapped in a resizable horizontal split. Right side
  starts at width 0; the first hoist event animates it open to 40 % of centre-pane
  width. Drag handle persists user width per session.
- **Tabs**: artifacts queue as tabs at the top of the pane. Active tab is sticky.
  Close removes from view; the source chip in the message re-opens it. Pin keeps
  across messages.
- **Body**: type-specific renderer with full feature set (the artifact view in the
  matrix above). Top-right has "fullscreen", "open in new window", "download" actions.
- **Footer**: link back to source message ("from agent · 2m ago") + scroll.
- **Per session**: `artifactStore` keys by `sessionId`. Switching sessions swaps the
  visible queue.

## State / Data Flow

1. `MessageBubble.render`:
   - Calls `classify(message.text)` → `ContentItem[]`
   - For each item: if `shouldHoist(item)`, call `artifactStore.upsertFromContent(sessionId, msgId, item)`; otherwise render inline directly. In either case, the bubble emits the inline node returned by `renderInline(item)` (which is the thumbnail for hoisted items).
2. Tool results follow the same path through `tool-call-card.tsx`.
3. `ArtifactPane` subscribes to `artifactStore.bySession(activeSessionId)`.
4. Artifact payloads live only in-memory; the raw message text remains the source of
   truth (in SQLite via the existing persistence path). On session re-hydrate the
   classifier re-runs lazily as messages render — no schema changes.

## Security

- HTML / SVG content rendered in sandboxed `<iframe sandbox srcdoc>` with
  `allow-same-origin` and `allow-scripts` both off (so SVG with `<script>` cannot
  execute). For SVG we additionally strip `<script>` / `on*` attributes via a
  whitelist DOMParser pass before rendering.
- Shell "run" button is hard-gated through the existing permission flow: clicking
  emits a `permission_request` to the server and only sends the bash payload after
  the user approves. Default policy stays "ask".
- Mermaid initialised with `securityLevel: "strict"`, `htmlLabels: false`.
- All renderers use lazy imports so first-message TTI is unaffected.

## Tech Choices

| Concern | Pick | Why |
|---|---|---|
| Tables | `@tanstack/react-table` v8 | Headless, lightweight, already friendly with React |
| Mermaid | `mermaid` v11 (lazy) | Industry standard |
| Math | `katex` + `rehype-katex` + `remark-math` | Plays well with existing react-markdown pipeline |
| JSON tree | `react-json-view-lite` | 5 KB, no deps, themable |
| CSV parse | `papaparse` | Small, robust |
| Charts | `recharts` (lazy, artifact-only) | SVG, no canvas, mature |
| HTML sandbox | native `<iframe sandbox srcdoc>` | No deps |

## Testing

- Vitest unit per renderer: classifier outputs the right items; hoist policy fires.
- Playwright e2e:
  - Markdown with a 12-row table → thumb in bubble + artifact tab opens
  - `bash` tool with 200-line stdout → middle collapses, expand restores
  - Mermaid block → svg renders in artifact, source toggle round-trips
  - Drag artifact pane handle → width persists per session
  - Shell-cmd "run" requires permission approval before WS send
- Smoke baseline (must hold after each commit): root > 30 000, errs 0, 4xx 0.

## Phasing (commits)

Single coherent design ships across 5 commits to keep diffs reviewable:

1. `feat(render): content classifier + artifact store skeleton + split pane shell`
2. `feat(render): inline table/mermaid/katex/json-tree renderers + thumbnails`
3. `feat(render): tool-call renderer dispatch (ls/grep/bash/web_fetch/image)`
4. `feat(render): artifact pane tabs/body + per-type artifact views`
5. `feat(render): csv→chart, html sandbox, shell-cmd run button (perm-gated)`

## Open Questions / Deferred

- Artifact persistence across reloads: deliberately deferred. Re-classifying on the
  fly is cheap; saving artifact tabs to SQLite buys little.
- "Export artifact to file in cwd" — could be useful but is out of scope for this
  pass; the `download` button covers the user-side need.
- Inline charts (in chat bubble, not artifact): considered but rejected; chart
  rendering is heavy and the artifact pane is one click away.
