import { Check, Copy, TerminalSquare } from "lucide-react";
import { useMemo, useState } from "react";
import { ansiToHtml, stripAnsi } from "../../lib/ansi";
import type { SessionState, ToolCallContentBlock, ToolCallState } from "../../stores/ui-store";

interface Entry {
  callId: string;
  title: string;
  ts: number;
  status: string;
  command?: string;
  output?: string;
  /** Streamed terminal-kind segments, if any (rarely populated by Copilot CLI). */
  segments: ToolCallContentBlock[];
}

function extractText(b: ToolCallContentBlock): string {
  if (typeof b.text === "string") return b.text;
  if (b.raw && typeof b.raw === "object") {
    const r = b.raw as Record<string, unknown>;
    if (typeof r.text === "string") return r.text;
    if (r.content && typeof r.content === "object") {
      const c = r.content as { text?: unknown };
      if (typeof c.text === "string") return c.text;
    }
    if (typeof r.output === "string") return r.output;
  }
  return "";
}

function extractCommand(input: unknown): string | undefined {
  if (input == null || typeof input !== "object") return undefined;
  const r = input as Record<string, unknown>;
  for (const k of ["command", "cmd", "shell_command", "script"]) {
    if (typeof r[k] === "string" && (r[k] as string).length > 0) return r[k] as string;
  }
  return undefined;
}

function extractOutput(output: unknown): string | undefined {
  if (output == null) return undefined;
  if (typeof output === "string") return output;
  if (typeof output === "object") {
    const r = output as Record<string, unknown>;
    if (typeof r.content === "string") return r.content;
    if (typeof r.stdout === "string") {
      const stderr = typeof r.stderr === "string" ? r.stderr : "";
      return stderr ? `${r.stdout}\n--- stderr ---\n${stderr}` : (r.stdout as string);
    }
    if (typeof r.output === "string") return r.output;
  }
  return undefined;
}

interface Props {
  session: SessionState;
  toolCalls: Record<string, ToolCallState>;
}

export function TerminalTab({ session, toolCalls }: Props) {
  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    for (const id of session.toolCallIds) {
      const call = toolCalls[id];
      if (!call) continue;
      const segs = call.content.filter((b) => b.kind === "terminal");
      const command = extractCommand(call.rawInput);
      const k = (call.kind || "").toLowerCase();
      const looksTerminal =
        segs.length > 0 ||
        !!command ||
        k.includes("terminal") ||
        k.includes("execute") ||
        k.includes("bash") ||
        k.includes("shell");
      if (!looksTerminal) continue;
      out.push({
        callId: call.id,
        title: call.title || call.kind,
        ts: call.ts,
        status: call.status,
        command,
        output: extractOutput(call.rawOutput),
        segments: segs,
      });
    }
    return out.sort((a, b) => a.ts - b.ts);
  }, [session.toolCallIds, toolCalls]);

  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
        Aggregated terminal output will appear here when the agent runs commands.
      </div>
    );
  }

  return (
    <div className="space-y-2 px-1 py-1 text-[11px]">
      {entries.map((e) => {
        const streamed = e.segments.map(extractText).join("");
        const body = streamed || e.output || "";
        return (
          <div key={e.callId} className="overflow-hidden rounded border border-border bg-[#0d1117]">
            <div className="flex items-center justify-between border-b border-border bg-panel-elevated px-2 py-1 text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <TerminalSquare className="h-3 w-3" />
                <span className="font-mono">{e.title}</span>
              </span>
              <span className="text-[10px]">{e.status}</span>
            </div>
            {e.command && (
              <div className="group flex items-center justify-between border-b border-border bg-panel-elevated/30 px-2 py-1 font-mono text-emerald-300">
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-muted-foreground">$ </span>
                  {e.command}
                </span>
                <CopyButton text={e.command} title="Copy command" />
              </div>
            )}
            {body ? (
              <div className="relative group">
                <div
                  className="max-h-[40vh] overflow-auto whitespace-pre-wrap break-words bg-transparent px-2 py-2 font-mono text-[11px] leading-snug text-foreground"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: ansi-to-html escapes XML
                  dangerouslySetInnerHTML={{ __html: ansiToHtml(body) }}
                />
                <div className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <CopyButton text={stripAnsi(body)} title="Copy output (no ANSI)" />
                </div>
              </div>
            ) : (
              <div className="px-2 py-2 text-[10px] text-muted-foreground">
                (no output captured)
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CopyButton({ text, title }: { text: string; title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {}
      }}
      className="ml-2 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      title={title}
    >
      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}
