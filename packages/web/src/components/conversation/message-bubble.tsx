import { Bot, User } from "lucide-react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../../lib/cn";
import type { Message } from "../../stores/ui-store";
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
}: {
  message: Message;
  streaming?: boolean;
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
    <div className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
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
      <div
        className={cn(
          "max-w-[80%] rounded-xl border px-3.5 py-2.5 text-sm",
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
        </div>
      </div>
    </div>
  );
}
