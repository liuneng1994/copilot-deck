import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { ansiToHtml } from "../../lib/ansi";
import { cn } from "../../lib/cn";
import type { ToolCallContentBlock, ToolCallState } from "../../stores/ui-store";
import { DiffView } from "./diff-view";
import { FileLink } from "./file-link";

function statusVisual(s: ToolCallState["status"]) {
  switch (s) {
    case "in_progress":
      return {
        icon: <Loader2 className="h-3 w-3 animate-spin" />,
        label: "running",
        cls: "text-warning border-warning/30 bg-warning/10",
      };
    case "completed":
      return {
        icon: <CheckCircle2 className="h-3 w-3" />,
        label: "done",
        cls: "text-success border-success/30 bg-success/10",
      };
    case "failed":
      return {
        icon: <AlertCircle className="h-3 w-3" />,
        label: "failed",
        cls: "text-destructive border-destructive/30 bg-destructive/10",
      };
    default:
      return {
        icon: <Clock className="h-3 w-3" />,
        label: "pending",
        cls: "text-muted-foreground border-border bg-muted",
      };
  }
}

function elapsed(c: ToolCallState) {
  const end = c.finishedAt ?? Date.now();
  const ms = end - c.startedAt;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}

export function ToolCallCard({ call }: { call: ToolCallState }) {
  const [open, setOpen] = useState(call.status !== "completed");
  const v = statusVisual(call.status);

  return (
    <div className="mx-10 my-1 overflow-hidden rounded-lg border border-border bg-panel-elevated text-xs">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/40"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <Wrench className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="truncate font-mono text-[12px] text-foreground">{call.title}</span>
        {call.inputSummary && (
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {call.inputSummary}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">{elapsed(call)}</span>
          <span
            className={cn(
              "flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px]",
              v.cls,
            )}
          >
            {v.icon}
            {v.label}
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-border bg-panel/60 p-3">
          {call.rawInput != null && (
            <details className="mb-2">
              <summary className="cursor-pointer text-[11px] text-muted-foreground">Input</summary>
              <pre className="mt-1 max-h-40 overflow-auto rounded bg-background p-2 font-mono text-[11px] text-foreground">
                {jsonOrText(call.rawInput)}
              </pre>
            </details>
          )}
          {Array.isArray(call.locations) && call.locations.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-muted-foreground">Locations:</span>
              {call.locations.map((loc, i) => (
                <FileLink
                  key={`${loc.path}:${loc.line ?? ""}:${i}`}
                  path={loc.path}
                  line={loc.line}
                />
              ))}
            </div>
          )}
          {call.content.length === 0 && call.status === "pending" && (
            <p className="text-[11px] text-muted-foreground">Awaiting agent…</p>
          )}
          {call.content.map((block, i) => (
            <ContentBlock key={`${call.id}:${i}`} block={block} />
          ))}
        </div>
      )}
    </div>
  );
}

function ContentBlock({ block }: { block: ToolCallContentBlock }) {
  if (block.kind === "diff") {
    return (
      <div className="mb-2">
        <DiffView path={block.path} oldText={block.oldText} newText={block.newText} />
      </div>
    );
  }
  if (block.kind === "terminal") {
    const text = block.text ?? jsonOrText(block.raw);
    return (
      <div
        className="mb-2 max-h-72 overflow-auto rounded bg-background p-2 font-mono text-[11px] leading-snug text-foreground whitespace-pre-wrap break-words"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: ansi-to-html escapes XML
        dangerouslySetInnerHTML={{ __html: ansiToHtml(text) }}
      />
    );
  }
  if (block.kind === "text") {
    return (
      <pre className="mb-2 max-h-72 overflow-auto rounded bg-background p-2 font-mono text-[11px] text-foreground whitespace-pre-wrap break-words">
        {block.text ?? jsonOrText(block.raw)}
      </pre>
    );
  }
  return (
    <pre className="mb-2 max-h-40 overflow-auto rounded bg-background p-2 font-mono text-[11px] text-muted-foreground">
      {jsonOrText(block.raw ?? block)}
    </pre>
  );
}

function jsonOrText(v: unknown) {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
