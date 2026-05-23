import type { ContentItem, ContentKind } from "./types";

/**
 * Hoist policy from docs/plans/2026-05-23-center-pane-rich-rendering-design.md.
 *
 * - type-forced: always hoist (inline experience is poor or unsafe)
 * - size-thresholded: hoist when the item exceeds a row/line count
 * - inline-only: never auto-hoist; user can still open via the ↗ button
 */
const FORCED_TYPES: ReadonlySet<ContentKind> = new Set(["mermaid", "html", "svg", "csv"]);

const NEVER_HOIST: ReadonlySet<ContentKind> = new Set(["text", "math", "shell"]);

export const TABLE_HOIST_ROWS = 8;
export const CODE_HOIST_LINES = 60;
export const JSON_HOIST_LINES = 80;

/** Whether the item should be auto-hoisted to the artifact pane. */
export function shouldHoist(item: ContentItem): boolean {
  if (NEVER_HOIST.has(item.kind)) return false;
  if (FORCED_TYPES.has(item.kind)) return true;
  switch (item.kind) {
    case "table":
      return item.rows.length >= TABLE_HOIST_ROWS;
    case "code":
      return item.lines >= CODE_HOIST_LINES;
    case "json":
      return item.lines >= JSON_HOIST_LINES;
    default:
      return false;
  }
}

/** Whether the item supports being opened in the artifact pane at all. */
export function isHoistable(item: ContentItem): boolean {
  return !NEVER_HOIST.has(item.kind);
}
