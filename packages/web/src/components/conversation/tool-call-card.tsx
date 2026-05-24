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
import { cn } from "../../lib/cn";
import { useUIStore } from "../../stores/ui-store";
import type { ToolCallContentBlock, ToolCallState } from "../../stores/ui-store";
import { AcpTerminalInline } from "./acp-terminal-inline";
import { DiffView } from "./diff-view";
import { FileLink } from "./file-link";
import { ClassifiedToolText, ImageBlock, TerminalBlock } from "./tool-content";

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
  const compact = useUIStore((s) => s.compactView);
  // In compact mode we default-collapse everything (including failures) —
  // the user opted into less noise. Otherwise default to open while running.
  const [open, setOpen] = useState(!compact && call.status !== "completed");
  const v = statusVisual(call.status);
  const k = (call.kind || "").toLowerCase();
  // Copilot's fleet "task" tool spawns a sub-agent; we surface that visually
  // so users don't mistake it for a regular shell call.
  const isFleetSubagent = k === "task" || k.endsWith(":task");
  const looksShell =
    k.includes("execute") ||
    k.includes("terminal") ||
    k.includes("bash") ||
    k.includes("shell") ||
    typeof extractCommand(call.rawInput) === "string";
  const shellCommand = looksShell ? extractCommand(call.rawInput) : undefined;

  return (
    <div className="my-1 overflow-hidden rounded-lg border border-border bg-panel-elevated text-xs">
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
        {isFleetSubagent && (
          <span className="shrink-0 rounded-sm border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-primary">
            subagent
          </span>
        )}
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
          {shellCommand !== undefined ? (
            <div className="mb-2 overflow-hidden rounded border border-border bg-background">
              <div className="border-b border-border bg-panel-elevated px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                command
              </div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[11px] leading-snug text-foreground">
                <span className="select-none text-muted-foreground">$ </span>
                {shellCommand}
              </pre>
            </div>
          ) : (
            call.rawInput != null && (
              <details className="mb-2">
                <summary className="cursor-pointer text-[11px] text-muted-foreground">
                  Input
                </summary>
                <pre className="mt-1 max-h-40 overflow-auto rounded bg-background p-2 font-mono text-[11px] text-foreground">
                  {jsonOrText(call.rawInput)}
                </pre>
              </details>
            )
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
            <ContentBlock
              key={`${call.id}:${i}`}
              block={block}
              sessionId={call.sessionId}
              callId={`${call.id}:${i}`}
              forceTerminal={looksShell}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ContentBlock({
  block,
  sessionId,
  callId,
  forceTerminal,
}: {
  block: ToolCallContentBlock;
  sessionId: string;
  callId: string;
  forceTerminal?: boolean;
}) {
  if (block.kind === "diff") {
    return (
      <div className="mb-2">
        <DiffView path={block.path} oldText={block.oldText} newText={block.newText} />
      </div>
    );
  }
  if (block.kind === "terminal") {
    if (block.terminalId) {
      return <AcpTerminalInline terminalId={block.terminalId} fallbackText={block.text} />;
    }
    const text = block.text ?? jsonOrText(block.raw);
    return <TerminalBlock text={text} />;
  }
  if (block.kind === "text") {
    const text = block.text ?? jsonOrText(block.raw);
    if (forceTerminal) return <TerminalBlock text={text} />;
    return <ClassifiedToolText text={text} sessionId={sessionId} callId={callId} />;
  }
  if (block.kind === "image") {
    return <ImageBlock raw={block.raw} />;
  }
  if (block.kind === "json") {
    const text =
      typeof block.raw === "string" ? block.raw : `\`\`\`json\n${jsonOrText(block.raw)}\n\`\`\``;
    return <ClassifiedToolText text={text} sessionId={sessionId} callId={callId} />;
  }
  if (forceTerminal) {
    return <TerminalBlock text={jsonOrText(block.raw ?? block)} />;
  }
  return (
    <pre className="mb-2 max-h-40 overflow-auto rounded bg-background p-2 font-mono text-[11px] text-muted-foreground">
      {jsonOrText(block.raw ?? block)}
    </pre>
  );
}

function extractCommand(input: unknown): string | undefined {
  if (input == null || typeof input !== "object") return undefined;
  const r = input as Record<string, unknown>;
  for (const k of ["command", "cmd", "shell_command", "script"]) {
    if (typeof r[k] === "string" && (r[k] as string).length > 0) return r[k] as string;
  }
  return undefined;
}

function jsonOrText(v: unknown) {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
