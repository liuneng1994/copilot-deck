import { ChevronDown, ChevronRight, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { ansiToHtml } from "../../lib/ansi";
import { cn } from "../../lib/cn";
import { classify } from "../../lib/content-renderer/classify";
import { renderContent } from "../../lib/content-renderer/render";

const TOP_LINES = 30;
const BOTTOM_LINES = 12;

/**
 * Terminal output viewer with middle-fold for long stdout. The first N and last
 * M lines are always visible; the middle collapses behind an expander chip.
 * "copy" button on the header copies the *full* text regardless of fold state.
 */
export function TerminalBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => text.replace(/\n$/, "").split(/\n/), [text]);
  const hiddenCount = Math.max(0, lines.length - TOP_LINES - BOTTOM_LINES);
  const showFold = !expanded && hiddenCount > 6;
  const visible = showFold
    ? [...lines.slice(0, TOP_LINES), ...lines.slice(lines.length - BOTTOM_LINES)]
    : lines;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };

  return (
    <div className="mb-2 overflow-hidden rounded border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border bg-panel-elevated px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>terminal · {lines.length} lines</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded p-1 hover:bg-muted hover:text-foreground"
          title="Copy full output"
        >
          <Copy className={cn("h-3 w-3", copied && "text-success")} />
        </button>
      </div>
      <div className="max-h-72 overflow-auto p-2 font-mono text-[11px] leading-snug text-foreground">
        {showFold ? (
          <>
            <FoldChunk lines={visible.slice(0, TOP_LINES)} />
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="my-1 block w-full rounded border border-dashed border-border bg-panel py-1 text-center text-[10px] uppercase tracking-wider text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              … {hiddenCount} hidden line{hiddenCount === 1 ? "" : "s"} · expand
            </button>
            <FoldChunk lines={visible.slice(TOP_LINES)} />
          </>
        ) : (
          <FoldChunk lines={visible} />
        )}
      </div>
    </div>
  );
}

function FoldChunk({ lines }: { lines: string[] }) {
  const html = useMemo(() => ansiToHtml(lines.join("\n")), [lines]);
  return (
    <div
      className="whitespace-pre-wrap break-words"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: ansiToHtml escapes XML
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * Pipe a text payload from a tool result through the same classifier the chat
 * bubbles use, so tables / json / mermaid in tool output get the rich rendering
 * treatment (including auto-hoist to the artifact pane).
 */
export function ClassifiedToolText({
  text,
  sessionId,
  callId,
}: {
  text: string;
  sessionId: string;
  callId: string;
}) {
  const items = useMemo(() => classify(text), [text]);
  if (items.length === 0) return null;
  return <>{items.map((it) => renderContent({ item: it, sessionId, msgId: `tool:${callId}` }))}</>;
}

/**
 * Inline image content block — supports both data URLs and absolute URLs.
 * Falls back to a small `<pre>` if neither is available.
 */
export function ImageBlock({ raw }: { raw: unknown }) {
  let src: string | undefined;
  if (typeof raw === "string") src = raw;
  else if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (typeof r.url === "string") src = r.url;
    else if (typeof r.data === "string") {
      const mime = typeof r.mimeType === "string" ? r.mimeType : "image/png";
      src = `data:${mime};base64,${r.data}`;
    }
  }
  if (!src) {
    return (
      <pre className="mb-2 max-h-40 overflow-auto rounded bg-background p-2 font-mono text-[11px] text-muted-foreground">
        {JSON.stringify(raw, null, 2)}
      </pre>
    );
  }
  return (
    <div className="mb-2 overflow-hidden rounded border border-border bg-background">
      <button
        type="button"
        onClick={() => window.open(src, "_blank", "noopener,noreferrer")}
        className="block w-full"
      >
        <img src={src} alt="tool output" className="max-h-72 w-auto cursor-zoom-in" />
      </button>
    </div>
  );
}
