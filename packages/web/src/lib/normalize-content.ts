import type { ToolCallContentBlock } from "../stores/ui-store";

interface RawBlock {
  type?: string;
  kind?: string;
  path?: string;
  oldText?: string;
  newText?: string;
  text?: string;
  content?: { type?: string; text?: string } | string;
  [k: string]: unknown;
}

/**
 * Map an ACP/server raw content block onto the normalized `ToolCallContentBlock`
 * shape the UI consumes. Used by both the live WS bridge and the hydrate path
 * (SQLite-persisted tool_call.content is stored as raw ACP JSON).
 */
export function normalizeContentBlock(raw: RawBlock): ToolCallContentBlock {
  const t =
    raw.kind ?? raw.type ?? (typeof raw.content === "object" ? raw.content?.type : undefined);
  let kind: ToolCallContentBlock["kind"] = "other";
  if (t === "diff") kind = "diff";
  else if (t === "terminal" || t === "terminal_output") kind = "terminal";
  else if (t === "text") kind = "text";
  else if (t === "image") kind = "image";

  // ACP often wraps output in `{ type: "content", content: { type: "text", text } }`.
  // Inherit the kind from the inner block so we don't fall through to the raw-JSON
  // default renderer for what is plainly text.
  if (kind === "other" && raw.content && typeof raw.content === "object") {
    const innerType = raw.content.type;
    if (innerType === "text") kind = "text";
    else if (innerType === "image") kind = "image";
  }

  const block: ToolCallContentBlock = { kind, raw };
  if (kind === "terminal" && typeof raw.terminalId === "string") {
    block.terminalId = raw.terminalId;
  }
  if (kind === "diff") {
    block.path = typeof raw.path === "string" ? raw.path : undefined;
    block.oldText = typeof raw.oldText === "string" ? raw.oldText : undefined;
    block.newText = typeof raw.newText === "string" ? raw.newText : undefined;
  }
  const inner = raw.content;
  if (
    inner &&
    typeof inner === "object" &&
    inner.type === "text" &&
    typeof inner.text === "string"
  ) {
    block.text = inner.text;
  } else if (typeof raw.text === "string") {
    block.text = raw.text;
  }
  return block;
}

export function normalizeContentBlocks(arr: unknown): ToolCallContentBlock[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((b) => normalizeContentBlock(b as RawBlock));
}
