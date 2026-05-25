import { type ReactNode, useEffect } from "react";
import { CodeBlock } from "../../components/conversation/code-block";
import { useArtifactStore } from "../../stores/artifact-store";
import { MarkdownText } from "./markdown";
import { HtmlSandbox } from "./renderers/html-sandbox";
import { JsonInline } from "./renderers/json-tree";
import { MathBlock } from "./renderers/katex";
import { MermaidInline } from "./renderers/mermaid";
import { ShellInline } from "./renderers/shell";
import { SvgSafe } from "./renderers/svg-safe";
import { TableInline } from "./renderers/table";
import { shouldHoist } from "./thresholds";
import type { ContentItem } from "./types";

/**
 * Side-effect: upsert every hoist-worthy item into the artifact store. Called
 * from a `useEffect` in the host component (MessageBubble's ClassifiedBody)
 * so it doesn't trigger setState during render.
 */
export function useHoistArtifacts(items: ContentItem[], sessionId: string, msgId: string): void {
  useEffect(() => {
    const upsert = useArtifactStore.getState().upsertFromItem;
    for (const item of items) {
      if (shouldHoist(item)) upsert(sessionId, msgId, item);
    }
  }, [items, sessionId, msgId]);
}

/**
 * Render a single classified content item. Streamed messages call this once per
 * item produced by `classify(text)`. Hoist-worthy items become a thumbnail with
 * an "open" button; the actual upsert into the artifact store is a separate
 * side-effect performed by `useHoistArtifacts` (so render stays pure).
 */
export function renderContent({
  item,
  sessionId,
  msgId: _msgId,
  full,
}: {
  item: ContentItem;
  sessionId: string;
  msgId: string;
  full?: boolean;
}): ReactNode {
  const hoisted = !full && shouldHoist(item);

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
