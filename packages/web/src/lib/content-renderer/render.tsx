import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "../../components/conversation/code-block";
import { LinkifyPaths } from "../../components/conversation/file-link";
import { useArtifactStore } from "../../stores/artifact-store";
import { HtmlSandbox } from "./renderers/html-sandbox";
import { JsonInline } from "./renderers/json-tree";
import { MathBlock } from "./renderers/katex";
import { MermaidInline } from "./renderers/mermaid";
import { ShellInline } from "./renderers/shell";
import { SvgSafe } from "./renderers/svg-safe";
import { TableInline } from "./renderers/table";
import { shouldHoist } from "./thresholds";
import type { ContentItem } from "./types";

function linkifyChildren(children: ReactNode): ReactNode {
  if (typeof children === "string") return <LinkifyPaths>{children}</LinkifyPaths>;
  if (Array.isArray(children)) {
    return children.map((c, i) =>
      typeof c === "string" ? (
        <LinkifyPaths key={`lp-${i}-${c.slice(0, 12)}`}>{c}</LinkifyPaths>
      ) : (
        c
      ),
    );
  }
  return children;
}

function MarkdownText({ text }: { text: string }) {
  return (
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
            <a href={href} {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}>
              {children}
            </a>
          );
        },
        // Suppress GFM table rendering — table items are pulled out by classify()
        // and rendered with the interactive TableInline component instead.
        table() {
          return null;
        },
        p({ children }) {
          return <p>{linkifyChildren(children)}</p>;
        },
        li({ children }) {
          return <li>{linkifyChildren(children)}</li>;
        },
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

/**
 * Render a single classified content item. Streamed messages call this once per
 * item produced by `classify(text)`. Hoist-worthy items are upserted into the
 * artifact store and the inline node becomes a thumbnail with an "open" button.
 */
export function renderContent({
  item,
  sessionId,
  msgId,
  full,
}: {
  item: ContentItem;
  sessionId: string;
  msgId: string;
  full?: boolean;
}): ReactNode {
  const hoisted = !full && shouldHoist(item);
  if (hoisted) {
    // Side-effect upsert — keeping it here means callers (MessageBubble, ToolCallCard)
    // don't need to know about the policy.
    useArtifactStore.getState().upsertFromItem(sessionId, msgId, item);
  }

  switch (item.kind) {
    case "text":
      return <MarkdownText key={item.id} text={item.text} />;

    case "code":
      return (
        <div key={item.id}>
          <CodeBlock code={item.text} lang={item.lang} />
        </div>
      );

    case "table":
      return (
        <TableInline
          key={item.id}
          id={item.id}
          header={item.header}
          rows={item.rows}
          hoisted={hoisted}
          sessionId={sessionId}
          full={full}
        />
      );

    case "csv":
      return (
        <TableInline
          key={item.id}
          id={item.id}
          header={item.header}
          rows={item.rows}
          hoisted={hoisted}
          sessionId={sessionId}
          full={full}
        />
      );

    case "mermaid":
      return (
        <MermaidInline
          key={item.id}
          id={item.id}
          src={item.src}
          hoisted={hoisted}
          sessionId={sessionId}
          full={full}
        />
      );

    case "math":
      return <MathBlock key={item.id} tex={item.tex} />;

    case "json":
      return (
        <JsonInline
          key={item.id}
          id={item.id}
          value={item.value}
          raw={item.raw}
          lines={item.lines}
          hoisted={hoisted}
          sessionId={sessionId}
          full={full}
        />
      );

    case "html":
      return <HtmlSandbox key={item.id} src={item.src} full={full} />;
    case "svg":
      return <SvgSafe key={item.id} src={item.src} full={full} />;

    case "shell":
      return (
        <ShellInline key={item.id} commands={item.commands} sessionId={sessionId} full={full} />
      );
  }
}
