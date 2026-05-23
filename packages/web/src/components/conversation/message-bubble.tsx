import { Bot, Copy, Pencil, RefreshCw, User } from "lucide-react";
import { type ReactNode, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../../lib/cn";
import { sendWs } from "../../lib/ws-client";
import { type Message, useUIStore } from "../../stores/ui-store";
import { CodeBlock } from "./code-block";
import { LinkifyPaths } from "./file-link";

function relativeTime(ts: number) {
  const d = Date.now() - ts;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return new Date(ts).toLocaleString();
}

/** Walk markdown children, replacing plain-string nodes with linkified spans. */
function linkifyChildren(children: ReactNode): ReactNode {
  if (typeof children === "string") return <LinkifyPaths>{children}</LinkifyPaths>;
  if (Array.isArray(children)) {
    return children.map((c, i) => {
      if (typeof c !== "string") return c;
      return <LinkifyPaths key={`lp-${i}-${c.slice(0, 16)}`}>{c}</LinkifyPaths>;
    });
  }
  return children;
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
  return (
    <div className={cn("group/msg flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
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
          <div className="prose prose-invert prose-sm max-w-none prose-pre:m-0 prose-pre:bg-transparent prose-pre:border-0 prose-pre:p-0 prose-code:before:content-none prose-code:after:content-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ className, children }) {
                  const codeStr = String(children ?? "").replace(/\n$/, "");
                  const match = /language-([\w-]+)/.exec(className ?? "");
                  const inline = !match && !codeStr.includes("\n");
                  return <CodeBlock code={codeStr} lang={match?.[1]} inline={inline} />;
                },
                pre({ children }) {
                  return <>{children}</>;
                },
                a({ href, children }) {
                  const external = typeof href === "string" && /^https?:\/\//i.test(href);
                  return (
                    <a
                      href={href}
                      {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
                    >
                      {children}
                    </a>
                  );
                },
                p({ children }) {
                  return <p>{linkifyChildren(children)}</p>;
                },
                li({ children }) {
                  return <li>{linkifyChildren(children)}</li>;
                },
              }}
            >
              {message.text || (streaming ? "…" : "")}
            </ReactMarkdown>
            {streaming && (
              <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-success align-middle" />
            )}
            {!streaming && message.stopReason === "cancelled" && (
              <div className="mt-2 inline-flex items-center gap-1 rounded border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warn">
                cancelled
              </div>
            )}
            {!streaming && message.stopReason === "error" && (
              <div className="mt-2 inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-rose-300">
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
        <ToolbarButton onClick={onEditUser} title="Edit & resend">
          <Pencil className="h-3 w-3" />
        </ToolbarButton>
      ) : (
        <ToolbarButton onClick={onRegenerate} title="Regenerate from prior user prompt">
          <RefreshCw className="h-3 w-3" />
        </ToolbarButton>
      )}
    </div>
  );
}

function ToolbarButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}
