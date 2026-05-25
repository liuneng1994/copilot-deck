# Project Intelligence Workbench design

## Problem

Copilot Deck already has a strong agent conversation loop and a git-driven Files tab for touched
files, diffs, restore, and preview. That is enough after an agent has changed code, but it is weak
before the task starts: users cannot efficiently inspect the existing codebase, select the relevant
symbols/tests, and carry that context into the prompt. This is especially painful for Java and C++
backends where the useful unit of work is often a class, method, function, test, or build target
rather than a single recently modified file.

## Goals

- Provide a backend-friendly workbench that is symbol-first but still degrades to file browsing.
- Let users build an explicit context workset that is visible before sending a prompt.
- Keep the first implementation small and reliable: heuristic symbols, related test discovery,
  context chips, and the existing file preview/diff surfaces.
- Preserve the current changed-files workflow; the new workbench supplements it instead of replacing
  it.

## Design standard: Occam's razor

This design uses Occam's razor as the selection and review standard: **如无必要，勿增实体**.

Applied to this workbench:

- Reuse the existing Files inspector, file index, file preview, grep, git review, Zustand store, and
  Composer instead of introducing a separate IDE-like workspace.
- Add new tabs only where they close a real workflow gap: `symbols` for locating backend code,
  `tests` for validation discovery, and `context` for making the prompt workset explicit.
- Keep the MVP heuristic and replaceable: no LSP daemon, no persistent workset database, no call graph
  service, and no new build runner until the user path proves those entities are necessary.
- Any future entity must remove more complexity than it adds. For example, jdtls/clangd should only be
  introduced when heuristic symbols and naming-based tests no longer provide enough signal.

## Non-goals for the MVP

- Full IDE replacement, editing, or refactoring UI.
- Full LSP integration, call hierarchy, or semantic project indexing.
- Language-specific build execution orchestration beyond suggested validation commands.

## User workflow

1. The user opens a Copilot Deck session in a Java/C++/TypeScript project.
2. In Inspector > Files, the user switches to `symbols` and searches for a class/function/method.
3. The user opens a symbol, previews the source, and adds the symbol to the context workset.
4. The user switches to `tests`, sees related test files by naming convention, and adds tests to the
   workset.
5. The composer shows context chips. On send, the prompt is prefixed with a compact "Use this
   workset" block listing symbols, files, tests, and suggested validation.
6. The agent modifies files. The user reviews touched files in `files`/changed-files mode and can
   return to `context` to see the original workset.

## Information architecture

The Files inspector becomes a lightweight workbench with these modes:

| Mode | Purpose |
|---|---|
| `files` | Existing git/touched-files review workflow. |
| `code` | Existing-code file browser and preview for all project files. |
| `symbols` | Search classes, functions, methods, interfaces, and structs. |
| `tests` | Discover related tests for the current selection/workset. |
| `context` | Show and edit the active workset that will be sent to the agent. |
| `search` | Existing repository grep. |
| `timeline` | Existing agent file touch timeline. |

## Workset model

The MVP stores the workset client-side in Zustand. It is intentionally per browser session rather
than persisted to SQLite because it is prompt-composition state, similar to drafts.

```ts
type WorksetItem =
  | { id: string; kind: "file"; path: string; label: string }
  | { id: string; kind: "symbol"; path: string; label: string; startLine: number; endLine: number }
  | { id: string; kind: "test"; path: string; label: string; testName?: string }
  | { id: string; kind: "buildTarget"; label: string; command: string };
```

The prompt prefix uses paths/symbol line ranges by default, not full file contents. This matches Copilot CLI's
ability to inspect files and avoids overfilling the model context.

## Backend APIs

### `GET /api/workbench/symbols`

Query: `cwd`, `q`, `limit`.

The route validates `cwd` with existing path-safety logic, indexes project files using the existing
file index, reads supported source files, extracts heuristic outlines, flattens them, and returns
matched symbols:

```ts
interface WorkbenchSymbol {
  id: string;
  name: string;
  kind: string;
  path: string; // relative to cwd
  startLine: number;
  endLine: number;
}
```

MVP symbol extraction supports TypeScript/JavaScript/Python/Go/Rust from existing code, plus Java
and C/C++ heuristics. Later LSP integration can replace the implementation without changing the UI
shape.

### `GET /api/workbench/tests`

Query: `cwd`, `path`, `symbol`, `limit`.

The route returns likely related tests using naming conventions:

- Java: `FooTest.java`, `FooTests.java`, `FooIT.java`.
- C/C++: `foo_test.cc`, `foo_test.cpp`, `test_foo.cpp`.
- TypeScript/JavaScript: `foo.test.ts`, `foo.spec.tsx`.

It also returns suggested commands when a nearby build system is detected:

- Gradle: `./gradlew test --tests '*FooTest'`
- Maven: `mvn test -Dtest=FooTest`
- CMake/CTest: `ctest -R foo`
- pnpm/Vitest/Playwright style projects can be expanded later.

## Web UI behavior

### Symbols mode

- Search box reuses the Files toolbar query.
- Results show kind, symbol name, relative path, and line range.
- Clicking a symbol previews its file.
- `+ Symbol` adds the symbol and line range to the workset.
- `+ File` adds the file.
- `Tests` switches to tests mode for the selected symbol/file.

### Tests mode

- Uses current selected file and the workset to discover related tests.
- `+ Test` adds a test file.
- Suggested validation commands can be copied or added to the workset as build targets.

### Context mode

- Lists active workset items.
- Allows removing items and clearing the workset.
- Shows the exact compact prompt prefix that will be prepended.

### Composer integration

When the active workset is non-empty, the composer renders context chips above the textarea. On send,
the user prompt becomes:

```text
Use this workset:
- Symbol: OrderService#createOrder at services/order/OrderService.java:84-132
- Test: services/order/OrderServiceTest.java
- Validate: ./gradlew test --tests '*OrderServiceTest'

Task:
<user prompt>
```

The message shown in the conversation also includes this prefix, making the context visible and
auditable.

## Closed-loop e2e test

The e2e test creates a temporary backend-like Java project and a fake ACP Copilot binary. It verifies:

1. A session can be created for the fixture project.
2. The user can search for `OrderService#createOrder` in `symbols`.
3. The user can add the symbol and related test to context.
4. The composer shows context chips.
5. Sending a prompt includes the workset prefix; the fake agent echoes that it saw
   `OrderService#createOrder` and the related test.
6. The fake agent emits a tool-call diff touching `OrderService.java`; the existing Files review
   loop shows the touched file.

## Future work

- Replace heuristics with jdtls/clangd LSP symbol, definition, references, and call hierarchy.
- Persist named worksets per session.
- Add "include contents" mode for selected symbols only if path/range prompts are insufficient.
- Attach diagnostics/test failures as first-class workset items.
- Detect module-specific commands (`mvn -pl`, `gradle :module:test`, CMake targets) instead of only
  root-level suggestions.
