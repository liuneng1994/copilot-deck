import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "../../components/conversation/code-block";
import { LinkifyPaths } from "../../components/conversation/file-link";

function normalizeBreakTags(text: string): string {
  return text.replace(/<br\s*\/?>/gi, "  \n");
}

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

const markdownComponents = {
  code({ className, children }: { className?: string; children?: ReactNode }) {
    const codeStr = String(children ?? "").replace(/\n$/, "");
    const match = /language-([\w-]+)/.exec(className ?? "");
    const inline = !match && !codeStr.includes("\n");
    return <CodeBlock code={codeStr} lang={match?.[1]} inline={inline} />;
  },
  pre({ children }: { children?: ReactNode }) {
    return <>{children}</>;
  },
  a({ href, children }: { href?: string; children?: ReactNode }) {
    const external = typeof href === "string" && /^https?:\/\//i.test(href);
    return (
      <a href={href} {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}>
        {children}
      </a>
    );
  },
  table() {
    return null;
  },
  p({ children }: { children?: ReactNode }) {
    return <p>{linkifyChildren(children)}</p>;
  },
  li({ children }: { children?: ReactNode }) {
    return <li>{linkifyChildren(children)}</li>;
  },
};

const inlineMarkdownComponents = {
  ...markdownComponents,
  p({ children }: { children?: ReactNode }) {
    return <span>{linkifyChildren(children)}</span>;
  },
};

export function MarkdownText({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {normalizeBreakTags(text)}
    </ReactMarkdown>
  );
}

export function MarkdownInline({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={inlineMarkdownComponents}>
      {normalizeBreakTags(text)}
    </ReactMarkdown>
  );
}
