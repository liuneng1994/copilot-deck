import { Copy, Send } from "lucide-react";
import { useState } from "react";
import { useUIStore } from "../../../stores/ui-store";

/**
 * Render a shell-cmd block (detected: bash/sh fences whose lines start with `$ `).
 * Each line gets Copy + "Send to composer" actions. We deliberately do NOT execute
 * commands — they're handed back to the composer so the user (and the agent's own
 * permission flow) own the run.
 */
export function ShellInline({
  commands,
  sessionId,
  full: _full,
}: {
  commands: { cmd: string; cwd?: string }[];
  sessionId: string;
  full?: boolean;
}) {
  const setDraft = useUIStore((s) => s.setDraft);
  const bumpComposerLoad = useUIStore((s) => s.bumpComposerLoad);
  const draft = useUIStore((s) => s.drafts[sessionId] ?? "");
  const [copied, setCopied] = useState<number | null>(null);
  const [sent, setSent] = useState<number | null>(null);

  const copy = (cmd: string, i: number) => {
    navigator.clipboard?.writeText(cmd).then(() => {
      setCopied(i);
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1200);
    });
  };
  const send = (cmd: string, i: number) => {
    const next = draft ? `${draft.replace(/\s+$/, "")}\n${cmd}` : `Run:\n\n\`${cmd}\``;
    setDraft(sessionId, next);
    bumpComposerLoad(sessionId);
    setSent(i);
    setTimeout(() => setSent((s) => (s === i ? null : s)), 1200);
  };

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border bg-panel font-mono text-xs">
      <ol className="divide-y divide-border/60">
        {commands.map((c, i) => (
          <li
            key={`${i}-${c.cmd.slice(0, 24)}`}
            className="group flex items-center gap-2 px-2 py-1.5 hover:bg-border/20"
          >
            <span className="select-none text-muted-foreground">$</span>
            <span className="min-w-0 flex-1 truncate text-foreground" title={c.cmd}>
              {c.cmd}
            </span>
            <button
              type="button"
              onClick={() => copy(c.cmd, i)}
              className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-border/40 hover:text-foreground group-hover:opacity-100"
              title={copied === i ? "Copied" : "Copy command"}
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => send(c.cmd, i)}
              className={
                sent === i
                  ? "rounded p-1 text-accent opacity-100 transition-opacity"
                  : "rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-border/40 hover:text-accent group-hover:opacity-100"
              }
              title={sent === i ? "Sent to composer ✓" : "Send to composer (will not auto-execute)"}
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
