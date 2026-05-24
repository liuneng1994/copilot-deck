import { Bot, Copy, GitBranch, History, Pencil, RefreshCw, User } from "lucide-react";
import { Fragment, type ReactNode, useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { classify } from "../../lib/content-renderer/classify";
import { renderContent, useHoistArtifacts } from "../../lib/content-renderer/render";
import { sendWs } from "../../lib/ws-client";
import { useCheckpointStore } from "../../stores/checkpoint-store";
import { type Message, useUIStore } from "../../stores/ui-store";
import { confirmDialog } from "../overlays/confirm-dialog";
import { ReasoningBlock, looksLikeReasoning } from "./reasoning-block";

function relativeTime(ts: number) {
  const d = Date.now() - ts;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return new Date(ts).toLocaleString();
}

/** Walk markdown children, replacing plain-string nodes with linkified spans. */
function _linkifyChildren(_children: ReactNode): ReactNode {
  return _children;
}

function ClassifiedBody({
  text,
  sessionId,
  msgId,
  streaming,
  highlight,
  isAgent,
}: {
  text: string;
  sessionId: string;
  msgId: string;
  streaming?: boolean;
  highlight: boolean;
  isAgent: boolean;
}) {
  // Group input text into paragraph chunks, then classify each chunk
  // independently so we can wrap reasoning-looking paragraphs with a
  // ReasoningBlock without disturbing code fences / tables (those never
  // contain a blank line between fence open/close, so splitting on
  // `\n\n` is safe with respect to them).
  const chunks = useMemo(() => splitIntoChunks(text), [text]);
  const classifiedChunks = useMemo(
    () => chunks.map((c, i) => ({ ...c, items: classify(c.text), idx: i })),
    [chunks],
  );
  const allItems = useMemo(
    () => classifiedChunks.flatMap((c) => c.items),
    [classifiedChunks],
  );
  useHoistArtifacts(allItems, sessionId, msgId);

  if (allItems.length === 0) {
    return streaming ? <span className="text-muted-foreground">…</span> : null;
  }

  const lastIdx = classifiedChunks.length - 1;
  return (
    <>
      {classifiedChunks.map((chunk) => {
        const rendered = chunk.items.map((it) => renderContent({ item: it, sessionId, msgId }));
        const shouldHighlight =
          highlight &&
          isAgent &&
          chunk.kind === "prose" &&
          (chunk.idx === 0 || chunk.idx === lastIdx || looksLikeReasoning(chunk.text));
        if (!shouldHighlight) {
          return <Fragment key={`p-${chunk.idx}`}>{rendered}</Fragment>;
        }
        return (
          <ReasoningBlock
            key={`p-${chunk.idx}`}
            variant={chunk.idx === lastIdx && chunk.idx > 0 ? "summary" : "default"}
          >
            {rendered}
          </ReasoningBlock>
        );
      })}
    </>
  );
}

interface Chunk {
  text: string;
  /** "prose" chunks are candidates for reasoning highlight. Code/table/etc
   * chunks (anything containing a non-text classified item) are not. */
  kind: "prose" | "rich";
}

/**
 * Split message text into paragraph chunks while keeping fenced code blocks
 * intact (we never split inside ``` … ```). Returns chunks marked as
 * "prose" (pure text, candidate for reasoning highlight) or "rich" (contains
 * code / tables / etc — render as-is).
 */
function splitIntoChunks(text: string): Chunk[] {
  if (!text) return [];
  const out: Chunk[] = [];
  // First, isolate fenced code blocks so paragraph splitting can't slice them.
  const fence = /(^|\n)([ \t]{0,3})(`{3,}|~{3,})[ \t]*([^\n]*)\n([\s\S]*?)\n[ \t]{0,3}\3[ \t]*(?=\n|$)/g;
  let cursor = 0;
  for (;;) {
    const m = fence.exec(text);
    if (!m) break;
    const start = m.index + (m[1] ? 1 : 0);
    if (start > cursor) splitProse(text.slice(cursor, start), out);
    out.push({ text: text.slice(start, fence.lastIndex), kind: "rich" });
    cursor = fence.lastIndex;
  }
  if (cursor < text.length) splitProse(text.slice(cursor), out);
  return out.filter((c) => c.text.trim().length > 0);
}

function splitProse(text: string, out: Chunk[]): void {
  const paragraphs = text.split(/\n{2,}/);
  for (const p of paragraphs) {
    const t = p.replace(/^\n+|\n+$/g, "");
    if (!t) continue;
    out.push({ text: t, kind: "prose" });
  }
}

export function MessageBubble({
  message,
  streaming,
  sessionId,
}: {
  message: Message;
  streaming?: boolean;
  sessionId: string;
}) {
  if (message.role === "system") {
    return (
      <div className="my-1 flex items-center gap-2 px-2 text-[11px] text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        <span className="font-mono">{message.text}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    );
  }

  const isUser = message.role === "user";
  const reasoningHighlight = useUIStore((s) => s.reasoningHighlight);
  return (
    <div
      data-msg-id={message.id}
      className={cn("group/msg flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}
    >
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
          isUser
            ? "border-primary/30 bg-primary/10 text-primary"
            : "border-success/30 bg-success/10 text-success",
        )}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div className="relative max-w-[80%]">
        <div
          className={cn(
            "rounded-xl border px-3.5 py-2.5 text-sm",
            isUser
              ? "border-primary/30 bg-primary/10 text-foreground"
              : "border-border bg-panel-elevated text-foreground",
          )}
        >
          <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>{isUser ? "you" : "agent"}</span>
            <span>·</span>
            <span>{relativeTime(message.ts)}</span>
          </div>
          <div className="prose prose-sm max-w-none dark:prose-invert prose-pre:m-0 prose-pre:bg-transparent prose-pre:border-0 prose-pre:p-0 prose-code:before:content-none prose-code:after:content-none">
            {message.attachments && message.attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2 not-prose">
                {message.attachments.map((att) => (
                  <a
                    key={att.id}
                    href={att.dataUrl}
                    target="_blank"
                    rel="noreferrer"
                    title={`${att.name} · ${(att.size / 1024).toFixed(0)} KB`}
                    className="block h-24 w-24 overflow-hidden rounded-md border border-border bg-muted transition hover:opacity-90"
                  >
                    <img src={att.dataUrl} alt={att.name} className="h-full w-full object-cover" />
                  </a>
                ))}
              </div>
            )}
            <ClassifiedBody
              text={message.text}
              sessionId={sessionId}
              msgId={message.id}
              streaming={streaming}
              highlight={reasoningHighlight}
              isAgent={!isUser}
            />
            {streaming && (
              <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-success align-middle" />
            )}
            {!streaming && message.stopReason === "cancelled" && (
              <div className="mt-2 inline-flex items-center gap-1 rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warn">
                cancelled
              </div>
            )}
            {!streaming && message.stopReason === "error" && (
              <div className="mt-2 inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-700 dark:text-rose-300">
                error
              </div>
            )}
          </div>
        </div>
        {!streaming && <MessageToolbar message={message} sessionId={sessionId} isUser={isUser} />}
      </div>
    </div>
  );
}

function MessageToolbar({
  message,
  sessionId,
  isUser,
}: {
  message: Message;
  sessionId: string;
  isUser: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const setDraft = useUIStore((s) => s.setDraft);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };

  const onEditUser = () => {
    setDraft(sessionId, message.text);
    useUIStore.getState().bumpComposerLoad(sessionId);
  };

  /**
   * Regenerate: re-issue the prior user prompt (the user prompt immediately
   * preceding this agent message). We look it up at click time from the live
   * store so the latest text wins.
   */
  const onRegenerate = () => {
    const state = useUIStore.getState();
    const sess = state.sessions[sessionId];
    if (!sess) return;
    const myIdx = sess.messages.findIndex((m) => m.id === message.id);
    if (myIdx <= 0) return;
    let priorUser: Message | undefined;
    for (let i = myIdx - 1; i >= 0; i--) {
      const m = sess.messages[i];
      if (m && m.role === "user") {
        priorUser = m;
        break;
      }
    }
    if (!priorUser) return;
    state.appendUserMessage(sessionId, priorUser.text);
    state.setSessionStatus(sessionId, "streaming");
    state.pushPromptHistory(sessionId, priorUser.text);
    sendWs({ type: "prompt", sessionId, text: priorUser.text });
  };

  return (
    <div
      className={cn(
        "pointer-events-none absolute -top-2.5 flex gap-0.5 rounded-md border border-border bg-panel-elevated p-0.5 opacity-0 shadow-sm transition-opacity group-hover/msg:pointer-events-auto group-hover/msg:opacity-100",
        isUser ? "left-2" : "right-2",
      )}
    >
      <ToolbarButton onClick={onCopy} title={copied ? "Copied!" : "Copy message"}>
        <Copy className={cn("h-3 w-3", copied && "text-success")} />
      </ToolbarButton>
      {isUser ? (
        <>
          <ToolbarButton onClick={onEditUser} title="Edit & resend">
            <Pencil className="h-3 w-3" />
          </ToolbarButton>
          <RestoreCheckpointButton sessionId={sessionId} messageId={message.id} />
        </>
      ) : (
        <ToolbarButton onClick={onRegenerate} title="Regenerate from prior user prompt">
          <RefreshCw className="h-3 w-3" />
        </ToolbarButton>
      )}
      <ForkFromHereButton sessionId={sessionId} messageId={message.id} />
    </div>
  );
}

function ToolbarButton({
  onClick,
  title,
  children,
  disabled,
}: {
  onClick: () => void;
  title: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
    >
      {children}
    </button>
  );
}

function RestoreCheckpointButton({
  sessionId,
  messageId,
}: {
  sessionId: string;
  messageId: string;
}) {
  const checkpoint = useCheckpointStore((s) => s.findByMessage(sessionId, messageId));
  const setNotice = useUIStore((s) => s.setNotice);
  const [busy, setBusy] = useState(false);

  if (!checkpoint) return null;

  const onRestore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { paths, total } = await useCheckpointStore.getState().preview(checkpoint.id);
      const sample = paths.slice(0, 8).join("\n");
      const ageMin = Math.max(0, Math.round((Date.now() - checkpoint.createdAt) / 60_000));
      const description =
        total === 0
          ? "No files differ from this checkpoint — nothing to restore."
          : `Restoring will overwrite ${total} file${total === 1 ? "" : "s"} in your worktree from a snapshot taken ${ageMin}m ago.\n\n${sample}${total > paths.length ? `\n…and ${total - paths.length} more` : ""}`;
      const ok = await confirmDialog({
        title: "Restore from checkpoint?",
        description,
        confirmLabel: total === 0 ? "OK" : "Restore",
        cancelLabel: "Cancel",
        tone: "danger",
      });
      if (!ok || total === 0) return;
      const result = await useCheckpointStore
        .getState()
        .restore(sessionId, checkpoint.id, { removeAdded: false });
      setNotice({
        id: `ckpt-restore-${Date.now()}`,
        kind: "info",
        text: `Restored ${result.changed.length} file${result.changed.length === 1 ? "" : "s"} from checkpoint.`,
        ts: Date.now(),
      });
    } catch (err) {
      setNotice({
        id: `ckpt-restore-err-${Date.now()}`,
        kind: "warn",
        text: `Checkpoint restore failed: ${err instanceof Error ? err.message : String(err)}`,
        ts: Date.now(),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolbarButton
      onClick={onRestore}
      title="Restore worktree to the snapshot taken before this prompt"
      disabled={busy}
    >
      <History className={cn("h-3 w-3", busy && "animate-pulse")} />
    </ToolbarButton>
  );
}

function ForkFromHereButton({
  sessionId,
  messageId,
}: {
  sessionId: string;
  messageId: string;
}) {
  const setNotice = useUIStore((s) => s.setNotice);
  const [busy, setBusy] = useState(false);

  const onFork = async () => {
    if (busy) return;
    const ok = await confirmDialog({
      title: "Fork session from here?",
      description:
        "Creates a new session in the same workspace. The conversation up to this point will be condensed into a 'Previous context' prefix and prepended to your next prompt in the new session.",
      confirmLabel: "Fork",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    setBusy(true);
    try {
      sendWs({ type: "fork_session", sessionId, messageId });
      setNotice({
        id: `fork-${Date.now()}`,
        kind: "info",
        text: "Forking session…",
        ts: Date.now(),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ToolbarButton
      onClick={onFork}
      title="Fork a new session from this point with condensed prior context"
      disabled={busy}
    >
      <GitBranch className={cn("h-3 w-3", busy && "animate-pulse")} />
    </ToolbarButton>
  );
}
