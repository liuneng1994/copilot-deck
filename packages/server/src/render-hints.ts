import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Render-hint injection: nudge the agent toward output formats that the
 * web UI's content-renderer pipeline can render richly (tables, mermaid,
 * csv, json, math, shell-with-$, html, svg).
 *
 * Two delivery modes are supported per session:
 *
 * - `agents_md`: append a marker block to `<cwd>/AGENTS.md` (copilot CLI
 *   reads this natively on every prompt — zero token cost beyond the file
 *   contents and survives session restarts).
 * - `prompt`:   prepend the hint to the *first* user prompt of the session
 *   (the agent remembers the convention for subsequent turns).
 * - `off`:      no injection.
 */
export type RenderHintMode = "agents_md" | "prompt" | "off";

export const DEFAULT_RENDER_HINT_MODE: RenderHintMode = "prompt";

export const RENDER_HINT_BEGIN = "<!-- agent-view: rich-render BEGIN -->";
export const RENDER_HINT_END = "<!-- agent-view: rich-render END -->";

/**
 * Canonical hint body. Kept short — every byte costs tokens.
 * If you tweak this, also update docs/plans/2026-05-23-center-pane-rich-rendering-design.md.
 */
export const RENDER_HINT_BODY = `## Output formatting

This conversation is rendered in a UI that interactively visualises certain content kinds. Prefer them when the content fits.

- **Tabular data** (more than 2 rows of comparable items): use GitHub-Flavoured Markdown tables.
- **Diagrams / flows / state machines / sequence**: emit a fenced \`\`\`mermaid block.
- **Math equations**: use \`$$ ... $$\` for block math, \`$ ... $\` for inline.
- **Raw datasets** the user may chart (numeric columns over time / category): use a fenced \`\`\`csv block.
- **Structured data** intended to be parsed: use a fenced \`\`\`json block (well-formed; 2-space indent).
- **Runnable shell commands** the user might want to copy/run: use a fenced \`\`\`bash block where every command line starts with \`$ \` (one command per line). Pasted output or non-runnable scripts should *not* use the \`$ \` prefix.
- **HTML previews** (small self-contained snippets to display): \`\`\`html. Do not use for code samples.
- **SVG illustrations**: \`\`\`svg.

For ordinary prose, code samples, file paths, and tool output, format as usual. Do not wrap every response in a special block.`;

export function buildHintBlock(): string {
  return `${RENDER_HINT_BEGIN}\n${RENDER_HINT_BODY}\n${RENDER_HINT_END}`;
}

/**
 * Build the prefix prepended to the first user prompt under `prompt` mode.
 * Wrapped in an HTML comment + visible header so the agent sees it and the
 * user can also tell why the prompt looks longer than they typed.
 */
export function buildPromptPrefix(): string {
  return [
    "<!-- system-note injected by agent-view -->",
    RENDER_HINT_BODY,
    "<!-- end system-note -->",
    "",
    "",
  ].join("\n");
}

export function prefixFirstPrompt(userText: string): string {
  return `${buildPromptPrefix()}${userText}`;
}

/**
 * Create or update the marked block inside `<cwd>/AGENTS.md`.
 * Existing content outside the BEGIN/END markers is preserved verbatim.
 * Idempotent: running twice produces the same file.
 */
export async function upsertAgentsMd(cwd: string): Promise<{
  filePath: string;
  created: boolean;
  updated: boolean;
}> {
  const filePath = path.join(cwd, "AGENTS.md");
  const block = buildHintBlock();
  let existing: string | null = null;
  try {
    existing = await fs.readFile(filePath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  if (existing === null) {
    await fs.writeFile(filePath, `${block}\n`, "utf8");
    return { filePath, created: true, updated: false };
  }

  if (existing.includes(RENDER_HINT_BEGIN) && existing.includes(RENDER_HINT_END)) {
    const re = new RegExp(
      `${escapeRe(RENDER_HINT_BEGIN)}[\\s\\S]*?${escapeRe(RENDER_HINT_END)}`,
      "g",
    );
    const next = existing.replace(re, block);
    if (next === existing) {
      return { filePath, created: false, updated: false };
    }
    await fs.writeFile(filePath, next, "utf8");
    return { filePath, created: false, updated: true };
  }

  const sep = existing.endsWith("\n") ? "\n" : "\n\n";
  await fs.writeFile(filePath, `${existing}${sep}${block}\n`, "utf8");
  return { filePath, created: false, updated: true };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
