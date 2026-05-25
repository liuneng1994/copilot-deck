import { Paperclip, RotateCcw, Send, Square, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BUILTIN_BY_NAME,
  BUILTIN_COMMANDS,
  type BuiltinCommand,
  parseSlash,
} from "../../lib/builtin-commands";
import { cn } from "../../lib/cn";
import { sendWs } from "../../lib/ws-client";
import { useCheckpointStore } from "../../stores/checkpoint-store";
import { formatWorksetPrompt } from "../../stores/files-slice";
import { type MessageAttachment, type SessionState, useUIStore } from "../../stores/ui-store";
import { Button } from "../ui/button";
import { Textarea } from "../ui/input";
import { MentionPopover } from "./mention-popover";
import { QueuedPromptsBar } from "./queued-prompts-bar";
import { type SlashItem, SlashPopover } from "./slash-popover";

const MAX_PER_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 16 * 1024 * 1024;

/** Internal composer state for an attached image — carries both base64 (for send) and dataUrl (for preview). */
interface PendingAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  /** base64 payload without `data:...;base64,` prefix. */
  data: string;
  /** data: URL for inline preview. */
  dataUrl: string;
}

function fileToAttachment(file: File): Promise<PendingAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const idx = dataUrl.indexOf(",");
      const data = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
      resolve({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name || "image",
        mimeType: file.type || "image/png",
        size: file.size,
        data,
        dataUrl,
      });
    };
    reader.readAsDataURL(file);
  });
}

export function Composer({ session }: { session: SessionState }) {
  const draft = useUIStore((s) => s.drafts[session.id] ?? "");
  const setDraft = useUIStore((s) => s.setDraft);
  const pushHistory = useUIStore((s) => s.pushPromptHistory);
  const loadEpoch = useUIStore((s) => s.composerLoadEpoch[session.id] ?? 0);
  const [text, setTextLocal] = useState(draft);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const setStatus = useUIStore((s) => s.setSessionStatus);
  const appendUser = useUIStore((s) => s.appendUserMessage);
  // Fan-out selection (broadcast).
  const fanoutSelection = useUIStore((s) => s.fanoutSelection);
  const clearFanout = useUIStore((s) => s.clearFanoutSelection);
  const sessionsMap = useUIStore((s) => s.sessions);
  const worksetItems = useUIStore((s) => s.worksetItems);
  const removeWorksetItem = useUIStore((s) => s.removeWorksetItem);
  const clearWorksetItems = useUIStore((s) => s.clearWorksetItems);
  // History recall: -1 = composing fresh; 0..N-1 = recalled from the end.
  const historyIdxRef = useRef<number>(-1);

  // Pending image attachments for the next send. Lives only in the composer —
  // we attach them at send time, then clear.
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalAttachedBytes = useMemo(() => pending.reduce((sum, p) => sum + p.size, 0), [pending]);

  const reportNotice = (text: string, kind: "info" | "warn" = "warn") => {
    useUIStore.getState().setNotice({
      id: `att-${Date.now()}`,
      kind,
      text,
      ts: Date.now(),
    });
  };

  /** Add image files to the pending list, enforcing size caps. */
  const addFiles = async (files: File[] | FileList) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) return;
    const accepted: PendingAttachment[] = [];
    let running = totalAttachedBytes;
    for (const f of list) {
      if (f.size > MAX_PER_IMAGE_BYTES) {
        reportNotice(`"${f.name}" exceeds the 8 MB per-image limit and was skipped.`);
        continue;
      }
      if (running + f.size > MAX_TOTAL_IMAGE_BYTES) {
        reportNotice(`Total attachments would exceed 16 MB — "${f.name}" was skipped.`);
        continue;
      }
      try {
        const att = await fileToAttachment(f);
        accepted.push(att);
        running += f.size;
      } catch (err) {
        console.error("attachment read failed", err);
        reportNotice(`Could not read "${f.name}".`);
      }
    }
    if (accepted.length > 0) {
      setPending((prev) => [...prev, ...accepted]);
    }
  };

  const removePending = (id: string) => {
    setPending((prev) => prev.filter((p) => p.id !== id));
  };

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
    const hasAttachments = pending.length > 0;
    if ((!trimmed && !hasAttachments) || reloading || detached) return;
    // Intercept built-in slash commands before they go to the agent.
    const parsed = trimmed ? parseSlash(trimmed) : null;
    if (parsed) {
      const builtin = BUILTIN_BY_NAME.get(parsed.name);
      if (builtin) {
        if (hasAttachments) {
          reportNotice("Slash commands do not accept attachments — clear them first.");
          return;
        }
        void runBuiltin(builtin, parsed.args);
        return;
      }
    }
    // Snapshot attachments now so we can clear local state immediately.
    const sendAttachments = pending;
    const wireAttachments = sendAttachments.map((p) => ({
      id: p.id,
      name: p.name,
      mimeType: p.mimeType,
      size: p.size,
      data: p.data,
    }));
    const localAttachments: MessageAttachment[] = sendAttachments.map((p) => ({
      id: p.id,
      name: p.name,
      mimeType: p.mimeType,
      size: p.size,
      dataUrl: p.dataUrl,
    }));
    const promptText = formatWorksetPrompt(worksetItems, trimmed);

    // If the active session is currently busy, enqueue instead of sending.
    // Slash-built-ins above are excluded — they always run immediately.
    // Fan-out is disabled while busy (it only matters for the active session).
    const activeBusy = streaming || awaitingPerm;
    if (activeBusy && fanoutSelection.length < 2) {
      useUIStore.getState().enqueuePrompt(session.id, {
        text: promptText,
        localAttachments: localAttachments.length > 0 ? localAttachments : undefined,
        wireAttachments: wireAttachments.length > 0 ? wireAttachments : undefined,
      });
      if (trimmed) pushHistory(session.id, trimmed);
      historyIdxRef.current = -1;
      setText("");
      setDraft(session.id, "");
      setPending([]);
      return;
    }

    // Fan-out: if ≥2 sessions selected, broadcast to all of them. Slash
    // commands are excluded above; permission-blocked / detached / reloading
    // sessions are skipped (they'll just no-op).
    const broadcastTargets =
      fanoutSelection.length >= 2 ? fanoutSelection.filter((id) => sessionsMap[id]) : [session.id];
    for (const sid of broadcastTargets) {
      const target = sessionsMap[sid];
      if (!target) continue;
      if (target.detached || target.status === "reloading") continue;
      // Busy fan-out target: enqueue rather than skip silently.
      if (target.status === "streaming" || target.status === "awaiting_perm") {
        useUIStore.getState().enqueuePrompt(sid, {
          text: promptText,
          localAttachments: localAttachments.length > 0 ? localAttachments : undefined,
          wireAttachments: wireAttachments.length > 0 ? wireAttachments : undefined,
        });
        continue;
      }
      appendUser(sid, promptText, localAttachments.length > 0 ? localAttachments : undefined);
      setStatus(sid, "streaming");
      sendWs({
        type: "prompt",
        sessionId: sid,
        text: promptText,
        attachments: wireAttachments.length > 0 ? wireAttachments : undefined,
      });
      setTimeout(() => useCheckpointStore.getState().invalidate(sid), 400);
    }
    if (trimmed) pushHistory(session.id, trimmed);
    historyIdxRef.current = -1;
    setText("");
    setDraft(session.id, "");
    setPending([]);
    if (broadcastTargets.length > 1) {
      useUIStore.getState().setNotice({
        id: `fanout-${Date.now()}`,
        kind: "info",
        text: `Broadcast to ${broadcastTargets.length} sessions.`,
        ts: Date.now(),
      });
    }
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
    setTimeout(() => useCheckpointStore.getState().invalidate(session.id), 400);
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
    <div className="relative border-t border-border bg-panel/60 px-4 pt-2 pb-3">
      <QueuedPromptsBar session={session} />
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {fanoutSelection.length >= 2 && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-foreground">
            <span>
              Broadcast mode: this prompt will be sent to{" "}
              <strong className="font-semibold">{fanoutSelection.length} sessions</strong> (skipping
              streaming / detached ones).
            </span>
            <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => clearFanout()}>
              Clear
            </Button>
          </div>
        )}
        {detached && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            <span>
              Session detached — the Copilot child process exited. Reattach to resume the same
              conversation context.
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 border-warn/40 text-warn hover:bg-warn/15 hover:text-warn disabled:opacity-60"
              disabled={!!session.reattaching}
              onClick={() => {
                useUIStore.getState().setReattaching(session.id, true);
                sendWs({ type: "reattach_session", sessionId: session.id });
                // Safety net: clear the spinner if the server never replies
                // (e.g. dropped WS), so the user can retry.
                window.setTimeout(() => {
                  const s = useUIStore.getState().sessions[session.id];
                  if (s?.reattaching) useUIStore.getState().setReattaching(session.id, false);
                }, 15_000);
              }}
            >
              <RotateCcw size={12} className={cn(session.reattaching && "animate-spin")} />
              {session.reattaching ? "Reattaching…" : "Reattach"}
            </Button>
          </div>
        )}
        <div
          className="relative"
          onDragEnter={(e) => {
            if (Array.from(e.dataTransfer.types).includes("Files")) {
              e.preventDefault();
              setDragOver(true);
            }
          }}
          onDragOver={(e) => {
            if (Array.from(e.dataTransfer.types).includes("Files")) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              setDragOver(true);
            }
          }}
          onDragLeave={(e) => {
            // Only clear when leaving the actual container, not bubbling from children.
            if (e.currentTarget === e.target) setDragOver(false);
          }}
          onDrop={(e) => {
            if (Array.from(e.dataTransfer.types).includes("Files")) {
              e.preventDefault();
              setDragOver(false);
              const files = Array.from(e.dataTransfer.files).filter((f) =>
                f.type.startsWith("image/"),
              );
              if (files.length > 0) void addFiles(files);
            }
          }}
        >
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
          {dragOver && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent/10 text-xs text-accent">
              Drop images to attach
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (files && files.length > 0) void addFiles(files);
              // Reset so the same file can be picked again later.
              e.target.value = "";
            }}
          />
          <div className="rounded-xl border border-border bg-panel-elevated focus-within:ring-2 focus-within:ring-ring">
            {worksetItems.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-3 pt-3 pb-2 text-[10px]">
                <span className="mr-1 uppercase tracking-wider text-muted-foreground">Context</span>
                {worksetItems.slice(0, 8).map((item) => (
                  <span
                    key={item.id}
                    className="inline-flex max-w-[14rem] items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-primary"
                    title={item.label}
                  >
                    <span className="truncate">{item.label}</span>
                    <button
                      type="button"
                      onClick={() => removeWorksetItem(item.id)}
                      className="rounded-full hover:bg-primary/20"
                      aria-label={`Remove ${item.label} from context`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))}
                {worksetItems.length > 8 ? (
                  <span className="text-muted-foreground">+{worksetItems.length - 8} more</span>
                ) : null}
                <button
                  type="button"
                  onClick={clearWorksetItems}
                  className="ml-auto rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  Clear
                </button>
              </div>
            )}
            {pending.length > 0 && (
              <div className="flex flex-wrap items-start gap-2 border-b border-border/60 px-3 pt-3 pb-2">
                {pending.map((p) => (
                  <div
                    key={p.id}
                    className="group relative h-16 w-16 overflow-hidden rounded-md border border-border bg-muted"
                    title={`${p.name} · ${(p.size / 1024).toFixed(0)} KB`}
                  >
                    <img src={p.dataUrl} alt={p.name} className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removePending(p.id)}
                      className="absolute right-0.5 top-0.5 hidden h-4 w-4 items-center justify-center rounded-full bg-overlay/70 text-overlay-fg hover:bg-overlay/90 group-hover:flex"
                      aria-label={`Remove ${p.name}`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
                <span className="ml-1 self-center text-[10px] text-muted-foreground">
                  {pending.length} image{pending.length === 1 ? "" : "s"} ·{" "}
                  {(totalAttachedBytes / 1024).toFixed(0)} KB
                </span>
              </div>
            )}
            <Textarea
              ref={taRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                const items = Array.from(e.clipboardData.items ?? []);
                const files: File[] = [];
                for (const it of items) {
                  if (it.kind === "file") {
                    const f = it.getAsFile();
                    if (f?.type.startsWith("image/")) files.push(f);
                  }
                }
                if (files.length > 0) {
                  e.preventDefault();
                  void addFiles(files);
                }
              }}
              aria-label="Message composer"
              placeholder={
                detached
                  ? "Session detached — create a new session to continue"
                  : reloading
                    ? "Reloading session…"
                    : streaming || awaitingPerm
                      ? "Agent is responding — your next prompt will queue. ⌘↵ to enqueue"
                      : "Type a prompt, /command, or @file. ⌘↵ to send"
              }
              disabled={reloading || detached}
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
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Attach images"
                  aria-label="Attach images"
                  disabled={reloading || detached}
                  onClick={() => fileInputRef.current?.click()}
                >
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
                  {streaming || awaitingPerm
                    ? "⌘↵ queue · Esc stop"
                    : reloading
                      ? "reloading…"
                      : "⌘↵ send"}
                </span>
                {streaming || awaitingPerm ? (
                  <>
                    {streaming && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={cancel}
                        className="h-7 gap-1.5"
                      >
                        <Square className="h-3 w-3" />
                        Stop
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={send}
                      disabled={(!text.trim() && pending.length === 0) || reloading || detached}
                      className="h-7 gap-1.5"
                      title="Add to queue — will send when agent is done"
                    >
                      <Send className="h-3 w-3" />
                      Queue
                    </Button>
                  </>
                ) : (
                  <>
                    <RetryButton onClick={retryLast} sessionId={session.id} />
                    <Button
                      size="sm"
                      onClick={send}
                      disabled={(!text.trim() && pending.length === 0) || reloading || detached}
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
