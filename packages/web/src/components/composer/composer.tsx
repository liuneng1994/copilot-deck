import { Paperclip, RotateCcw, Send, Square } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BUILTIN_BY_NAME,
  BUILTIN_COMMANDS,
  type BuiltinCommand,
  parseSlash,
} from "../../lib/builtin-commands";
import { sendWs } from "../../lib/ws-client";
import { type SessionState, useUIStore } from "../../stores/ui-store";
import { Button } from "../ui/button";
import { Textarea } from "../ui/input";
import { MentionPopover } from "./mention-popover";
import { type SlashItem, SlashPopover } from "./slash-popover";

export function Composer({ session }: { session: SessionState }) {
  const draft = useUIStore((s) => s.drafts[session.id] ?? "");
  const setDraft = useUIStore((s) => s.setDraft);
  const pushHistory = useUIStore((s) => s.pushPromptHistory);
  const loadEpoch = useUIStore((s) => s.composerLoadEpoch[session.id] ?? 0);
  const [text, setTextLocal] = useState(draft);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const setStatus = useUIStore((s) => s.setSessionStatus);
  const appendUser = useUIStore((s) => s.appendUserMessage);
  // History recall: -1 = composing fresh; 0..N-1 = recalled from the end.
  const historyIdxRef = useRef<number>(-1);

  // Restore draft when switching sessions OR when an external action bumps
  // the load epoch (e.g. Edit & resend from a message bubble). loadEpoch is
  // intentional even though it isn't read inside the effect body — every bump
  // must re-run the restore-from-store + caret-to-end behaviour below.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    const d = useUIStore.getState().drafts[session.id] ?? "";
    setTextLocal(d);
    historyIdxRef.current = -1;
    if (d && taRef.current) {
      // Move focus + caret to end so the user can keep typing.
      const ta = taRef.current;
      setTimeout(() => {
        ta.focus();
        ta.setSelectionRange(d.length, d.length);
      }, 0);
    }
  }, [session.id, loadEpoch]);

  const setText = (next: string | ((t: string) => string)) => {
    setTextLocal((prev) => {
      const v = typeof next === "function" ? next(prev) : next;
      // Persist draft outside of the state updater to avoid the
      // "setState while rendering another component" warning.
      queueMicrotask(() => setDraft(session.id, v));
      return v;
    });
  };

  /** Move through this session's prompt history. dir: -1=older, +1=newer. */
  const recallHistory = (dir: -1 | 1): boolean => {
    const list = useUIStore.getState().promptHistory[session.id] ?? [];
    if (list.length === 0) return false;
    const cur = historyIdxRef.current;
    let nextIdx: number;
    if (dir === -1) {
      nextIdx = cur === -1 ? list.length - 1 : Math.max(0, cur - 1);
    } else {
      if (cur === -1) return false;
      nextIdx = cur + 1;
      if (nextIdx >= list.length) {
        historyIdxRef.current = -1;
        setText("");
        return true;
      }
    }
    historyIdxRef.current = nextIdx;
    setTextLocal(list[nextIdx] ?? "");
    setDraft(session.id, list[nextIdx] ?? "");
    return true;
  };

  const streaming = session.status === "streaming";
  const awaitingPerm = session.status === "awaiting_perm";
  const reloading = session.status === "reloading";
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
  const slashOpen = !!slashContext && !streaming && !reloading;
  const mentionOpen = !!mentionContext && !!session.cwd && !streaming && !reloading && !slashOpen;

  // biome-ignore lint/correctness/useExhaustiveDependencies: auto-resize triggers when text mutates, not its read-only props
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    const max = 12 * 20;
    ta.style.height = `${Math.min(ta.scrollHeight, max)}px`;
  }, [text]);

  /** Execute a built-in command and clear the composer. */
  const runBuiltin = async (cmd: BuiltinCommand, args: string) => {
    const consumed = await cmd.run(args, { sessionId: session.id });
    if (consumed) setText("");
  };

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed || streaming || reloading) return;
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
    pushHistory(session.id, trimmed);
    historyIdxRef.current = -1;
    setText("");
    setDraft(session.id, "");
  };

  const cancel = () => {
    sendWs({ type: "cancel", sessionId: session.id });
    useUIStore.getState().markLastAgentStopped(session.id, "cancelled");
    setStatus(session.id, "idle");
  };

  /** Resend the most recent user prompt in this session. */
  const retryLast = () => {
    if (streaming || awaitingPerm || reloading || detached) return;
    const state = useUIStore.getState();
    const sess = state.sessions[session.id];
    if (!sess) return;
    let prior: string | null = null;
    for (let i = sess.messages.length - 1; i >= 0; i--) {
      const m = sess.messages[i];
      if (m && m.role === "user") {
        prior = m.text;
        break;
      }
    }
    if (!prior) return;
    appendUser(session.id, prior);
    setStatus(session.id, "streaming");
    pushHistory(session.id, prior);
    sendWs({ type: "prompt", sessionId: session.id, text: prior });
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
        {detached && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            <span>
              Session detached — the Copilot child process exited. Reattach to resume the same
              conversation context.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 border-warn/40 text-warn hover:bg-warn/15 hover:text-warn"
              onClick={() => sendWs({ type: "reattach_session", sessionId: session.id })}
            >
              <RotateCcw size={12} />
              Reattach
            </Button>
          </div>
        )}
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
                      : reloading
                        ? "Reloading session…"
                        : "Type a prompt, /command, or @file. ⌘↵ to send"
              }
              disabled={streaming || awaitingPerm || reloading || detached}
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
                } else if (e.key === "ArrowUp" && !e.shiftKey) {
                  // Recall older prompt only when caret is at the start.
                  const ta = e.currentTarget;
                  if (ta.selectionStart === 0 && ta.selectionEnd === 0) {
                    if (recallHistory(-1)) e.preventDefault();
                  }
                } else if (e.key === "ArrowDown" && !e.shiftKey) {
                  const ta = e.currentTarget;
                  if (ta.selectionStart === ta.value.length) {
                    if (recallHistory(1)) e.preventDefault();
                  }
                } else if (e.key !== "ArrowUp" && e.key !== "ArrowDown") {
                  // User typed something else — exit history-recall mode so subsequent
                  // arrow keys behave normally.
                  historyIdxRef.current = -1;
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
                    type <kbd className="rounded bg-muted px-1 py-0.5 text-[9px]">/</kbd> for{" "}
                    {agentCommands.length + builtinItems.length} commands
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground">
                  · <kbd className="rounded bg-muted px-1 py-0.5 text-[9px]">@</kbd> for files
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground">
                  {streaming ? "Esc to stop" : reloading ? "reloading…" : "⌘↵ send"}
                </span>
                {streaming ? (
                  <Button size="sm" variant="destructive" onClick={cancel} className="h-7 gap-1.5">
                    <Square className="h-3 w-3" />
                    Stop
                  </Button>
                ) : (
                  <>
                    <RetryButton onClick={retryLast} sessionId={session.id} />
                    <Button
                      size="sm"
                      onClick={send}
                      disabled={!text.trim() || awaitingPerm || reloading || detached}
                      className="h-7 gap-1.5"
                    >
                      <Send className="h-3 w-3" />
                      Send
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Small retry button rendered only when the active session has a prior user
 * prompt that can be re-issued. Subscribes to message count so it appears as
 * soon as the first prompt lands.
 */
function RetryButton({ sessionId, onClick }: { sessionId: string; onClick: () => void }) {
  const hasUser = useUIStore((s) => {
    const sess = s.sessions[sessionId];
    if (!sess) return false;
    return sess.messages.some((m) => m.role === "user");
  });
  if (!hasUser) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={onClick}
      className="h-7 gap-1.5"
      title="Resend the last user prompt"
    >
      <RotateCcw className="h-3 w-3" />
      Retry
    </Button>
  );
}
