import { ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useArtifactStore } from "../../../stores/artifact-store";
import { cn } from "../../cn";

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const m = mod.default;
      m.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "strict",
        htmlLabels: false,
        flowchart: { htmlLabels: false },
      });
      return m;
    });
  }
  return mermaidPromise;
}

/**
 * Lazy-rendered Mermaid diagram. The library is heavy (~400 KB) so the import
 * deferred until the first diagram is mounted. SecurityLevel "strict" plus
 * htmlLabels disabled blocks the obvious XSS vectors.
 */
export function MermaidInline({
  id,
  src,
  hoisted,
  sessionId,
  full,
}: {
  id: string;
  src: string;
  hoisted: boolean;
  sessionId: string;
  full?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showSrc, setShowSrc] = useState(false);
  const focus = useArtifactStore((s) => s.focus);
  const renderId = `mermaid-${id.replace(/[^a-z0-9]/gi, "")}`;

  useEffect(() => {
    let cancelled = false;
    loadMermaid()
      .then(async (m) => {
        try {
          const { svg } = await m.render(`${renderId}-${Date.now()}`, src);
          if (cancelled) return;
          if (ref.current) ref.current.innerHTML = svg;
          setErr(null);
        } catch (e) {
          if (!cancelled) setErr((e as Error).message);
        }
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [src, renderId]);

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border bg-panel-elevated px-2 py-1 text-[11px] text-muted-foreground">
        <span className="font-mono">mermaid diagram</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowSrc((v) => !v)}
            className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider hover:bg-muted hover:text-foreground"
          >
            {showSrc ? "diagram" : "source"}
          </button>
          {!full && hoisted && (
            <button
              type="button"
              onClick={() => focus(sessionId, `${sessionId}:${id}`)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider hover:bg-muted hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3" />
              open
            </button>
          )}
        </div>
      </div>
      <div className={cn("overflow-auto bg-background p-3", full ? "max-h-[70vh]" : "max-h-48")}>
        {showSrc ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
            {src}
          </pre>
        ) : err ? (
          <div className="text-xs text-rose-300">mermaid render failed: {err}</div>
        ) : (
          <div ref={ref} className="flex justify-center [&_svg]:max-w-full" />
        )}
      </div>
    </div>
  );
}
