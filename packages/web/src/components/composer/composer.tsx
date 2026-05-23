import { Paperclip, Send, Square } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Textarea } from "../ui/input";
import { sendWs } from "../../lib/ws-client";
import { useUIStore, type SessionState } from "../../stores/ui-store";
import { SlashPopover, type SlashItem } from "./slash-popover";
import { MentionPopover } from "./mention-popover";
import {
  BUILTIN_COMMANDS,
  BUILTIN_BY_NAME,
  parseSlash,
  type BuiltinCommand,
} from "../../lib/builtin-commands";

export function Composer({ session }: { session: SessionState }) {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const setStatus = useUIStore((s) => s.setSessionStatus);
  const appendUser = useUIStore((s) => s.appendUserMessage);

  const streaming = session.status === "streaming";
  const awaitingPerm = session.status === "awaiting_perm";
  const detached = !!session.detached;

  // Slash popover state: open whenever the active token starts with `/`.
  const slashContext = useMemo(() => {
    const m = /(?:^|\s)\/([\w-]*)$/.exec(text);
    if (!m) return null;
    return { query: m[1], prefixLength: m[0].length };
  }, [text]);

  // Mention popover state: open whenever the active token starts with `@`.
  const mentionContext = useMemo(() => {
    const m = /(?:^|\s)@([\w./\-]*)$/.exec(text);
    if (!m) return null;
    return { query: m[1], prefixLength: m[0].length };
  }, [text]);

  const agentCommands = session.availableCommands ?? [];
  const builtinItems = useMemo<SlashItem[]>(
    () =>
      BUILTIN_COMMANDS.map((b) => ({
        name: b.name,
        description: b.description,
        source: "builtin" as const,
        category: b.category,
      })),
    [],
  );
  // Popover open whenever we have any slash context — we always have built-ins.
  const slashOpen = !!slashContext && !streaming;
  const mentionOpen = !!mentionContext && !!session.cwd && !streaming && !slashOpen;

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    const max = 12 * 20;
    ta.style.height = Math.min(ta.scrollHeight, max) + "px";
  }, [text]);

  /** Execute a built-in command and clear the composer. */
  const runBuiltin = async (cmd: BuiltinCommand, args: string) => {
    const consumed = await cmd.run(args, { sessionId: session.id });
    if (consumed) setText("");
  };

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    // Intercept built-in slash commands before they go to the agent.
    const parsed = parseSlash(trimmed);
    if (parsed) {
      const builtin = BUILTIN_BY_NAME.get(parsed.name);
      if (builtin) {
        void runBuiltin(builtin, parsed.args);
        return;
      }
    }
    appendUser(session.id, trimmed);
    setStatus(session.id, "streaming");
    sendWs({ type: "prompt", sessionId: session.id, text: trimmed });
    setText("");
  };

  const cancel = () => {
    sendWs({ type: "cancel", sessionId: session.id });
    setStatus(session.id, "idle");
  };

  /** Replace the active /token with /name (or run immediately for built-ins). */
  const pickSlash = (item: SlashItem) => {
    if (!slashContext) return;
    if (item.source === "builtin") {
      const builtin = BUILTIN_BY_NAME.get(item.name);
      if (builtin) {
        void runBuiltin(builtin, "");
        return;
      }
    }
    const startIdx = text.length - slashContext.prefixLength;
    const leading = text.slice(0, startIdx);
    const inserted = `${leading}${leading && !leading.endsWith(" ") ? " " : ""}/${item.name} `;
    setText(inserted);
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const pickMention = (file: string) => {
    if (!mentionContext) return;
    const startIdx = text.length - mentionContext.prefixLength;
    const leading = text.slice(0, startIdx);
    const inserted = `${leading}${leading && !leading.endsWith(" ") ? " " : ""}@${file} `;
    setText(inserted);
    requestAnimationFrame(() => taRef.current?.focus());
  };

  return (
    <div className="relative border-t border-border bg-panel/60 px-4 py-3">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <div className="relative">
          <SlashPopover
            open={slashOpen}
            commands={agentCommands}
            builtins={builtinItems}
            query={slashContext?.query ?? ""}
            onPick={pickSlash}
            onClose={() => setText((t) => t.replace(/\/[\w-]*$/, ""))}
          />
          <MentionPopover
            open={mentionOpen}
            cwd={session.cwd}
            query={mentionContext?.query ?? ""}
            onPick={pickMention}
            onClose={() => setText((t) => t.replace(/@[\w./\-]*$/, ""))}
          />
          <div className="rounded-xl border border-border bg-panel-elevated focus-within:ring-2 focus-within:ring-ring">
            <Textarea
              ref={taRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                detached
                  ? "Session detached — create a new session to continue"
                  : streaming
                    ? "Agent is responding… press Esc to stop"
                    : awaitingPerm
                      ? "Waiting for permission decision…"
                      : "Type a prompt, /command, or @file. ⌘↵ to send"
              }
              disabled={streaming || awaitingPerm || detached}
              rows={1}
              className="min-h-[44px] resize-none border-0 bg-transparent px-4 py-3 text-sm shadow-none focus-visible:ring-0"
              onKeyDown={(e) => {
                // Let popovers handle nav keys when either is open.
                if (
                  (slashOpen || mentionOpen) &&
                  ["ArrowUp", "ArrowDown", "Enter", "Tab", "Escape"].includes(e.key)
                ) {
                  return;
                }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  send();
                } else if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                } else if (e.key === "Escape" && streaming) {
                  e.preventDefault();
                  cancel();
                }
              }}
            />
            <div className="flex items-center justify-between gap-2 border-t border-border px-2.5 py-1.5">
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" title="Attach (todo)">
                  <Paperclip className="h-3.5 w-3.5" />
                </Button>
                {(agentCommands.length > 0 || true) && (
                  <span className="text-[10px] text-muted-foreground">
                    type <kbd className="rounded bg-muted px-1 py-0.5 text-[9px]">/</kbd> for {agentCommands.length + builtinItems.length} commands
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground">
                  · <kbd className="rounded bg-muted px-1 py-0.5 text-[9px]">@</kbd> for files
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">
                  {streaming ? "Esc to stop" : "⌘↵ send"}
                </span>
                {streaming ? (
                  <Button size="sm" variant="destructive" onClick={cancel} className="h-7 gap-1.5">
                    <Square className="h-3 w-3" />
                    Stop
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={send}
                    disabled={!text.trim() || awaitingPerm || detached}
                    className="h-7 gap-1.5"
                  >
                    <Send className="h-3 w-3" />
                    Send
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
