import { ChevronDown, ChevronRight, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { ansiToHtml } from "../../lib/ansi";
import { cn } from "../../lib/cn";
import { classify } from "../../lib/content-renderer/classify";
import { renderContent, useHoistArtifacts } from "../../lib/content-renderer/render";

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
    <div className="mb-2 overflow-hidden rounded border border-zinc-700/60 bg-[#0d1117] shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-700/60 bg-zinc-900/80 px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-flex gap-1">
            <span className="h-2 w-2 rounded-full bg-rose-400/70" />
            <span className="h-2 w-2 rounded-full bg-amber-300/70" />
            <span className="h-2 w-2 rounded-full bg-emerald-400/70" />
          </span>
          <span className="ml-1">terminal · {lines.length} lines</span>
        </span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded p-1 text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-100"
          title="Copy full output"
        >
          <Copy className={cn("h-3 w-3", copied && "text-emerald-400")} />
        </button>
      </div>
      <div className="max-h-72 overflow-auto p-2 font-mono text-[11px] leading-snug text-[#e6edf3]">
        {showFold ? (
          <>
            <FoldChunk lines={visible.slice(0, TOP_LINES)} />
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="my-1 block w-full rounded border border-dashed border-zinc-700/60 bg-zinc-800/40 py-1 text-center text-[10px] uppercase tracking-wider text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-100"
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

/**
 * Heuristic colorization for terminal output that arrived without ANSI SGR
 * codes (some tools strip color when stdout is not a TTY, even with
 * FORCE_COLOR). We add inline spans for: error/warn/info/ok prefixes, diff
 * +/- lines, and `path:line:col` location markers. Cheap and additive —
 * runs after ansi-to-html so any real SGR colors take precedence.
 */
const ANSI_RE = /\x1b\[/;
function colorizePlain(html: string): string {
  return html
    .split("\n")
    .map((line) => {
      // Diff markers (--- / +++ headers also caught here but harmless)
      if (/^[+][^+]/.test(line))
        return `<span style="color:#a6e3a1">${line}</span>`;
      if (/^[-][^-]/.test(line))
        return `<span style="color:#f38ba8">${line}</span>`;
      // Severity prefixes
      const sev = line.match(/^(\s*)(error|err|fatal|fail|failed|panic)(:|\s)/i);
      if (sev) return `<span style="color:#f38ba8">${line}</span>`;
      const warn = line.match(/^(\s*)(warn|warning)(:|\s)/i);
      if (warn) return `<span style="color:#f9e2af">${line}</span>`;
      const info = line.match(/^(\s*)(info|note|debug)(:|\s)/i);
      if (info) return `<span style="color:#8ab4f8">${line}</span>`;
      const ok = line.match(/^(\s*)(ok|success|passed|done)(:|\s)/i);
      if (ok) return `<span style="color:#a6e3a1">${line}</span>`;
      // path:line[:col] markers — dim the surroundings, highlight the path
      return line.replace(
        /(^|\s)([\w./\-]+\.[a-zA-Z0-9]+):(\d+)(?::(\d+))?/g,
        (_m, pre, p, l, c) =>
          `${pre}<span style="color:#94e2d5">${p}</span>:<span style="color:#f9e2af">${l}</span>${
            c ? `:<span style="color:#f9e2af">${c}</span>` : ""
          }`,
      );
    })
    .join("\n");
}

function FoldChunk({ lines }: { lines: string[] }) {
  const html = useMemo(() => {
    const raw = lines.join("\n");
    const converted = ansiToHtml(raw);
    // If the raw text had no ANSI codes at all, layer cheap heuristic
    // colorization on top (ansi-to-html escaped XML, so &lt; etc. are safe).
    return ANSI_RE.test(raw) ? converted : colorizePlain(converted);
  }, [lines]);
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
  const msgId = `tool:${callId}`;
  useHoistArtifacts(items, sessionId, msgId);
  if (items.length === 0) return null;
  return <>{items.map((it) => renderContent({ item: it, sessionId, msgId }))}</>;
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
