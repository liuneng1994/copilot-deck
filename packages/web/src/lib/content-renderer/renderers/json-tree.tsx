import { ExternalLink } from "lucide-react";
import { Suspense, lazy, useEffect, useState } from "react";
import { useArtifactStore } from "../../../stores/artifact-store";

const JsonView = lazy(() => import("react-json-view-lite").then((m) => ({ default: m.JsonView })));
let stylesCache: Record<string, string> | null = null;
let stylesPromise: Promise<Record<string, string>> | null = null;
function loadDarkStyles(): Promise<Record<string, string>> {
  if (!stylesPromise) {
    stylesPromise = import("react-json-view-lite").then((m) => {
      stylesCache = m.darkStyles as unknown as Record<string, string>;
      return stylesCache;
    });
  }
  return stylesPromise;
}

/**
 * Folded JSON tree view (inline) / full tree (artifact).
 *
 * react-json-view-lite is loaded lazily so first paint of a normal message
 * isn't blocked on it. While loading we render a one-line placeholder.
 */
export function JsonInline({
  id,
  value,
  raw,
  lines,
  hoisted,
  sessionId,
  full,
}: {
  id: string;
  value: unknown;
  raw: string;
  lines: number;
  hoisted: boolean;
  sessionId: string;
  full?: boolean;
}) {
  const focus = useArtifactStore((s) => s.focus);

  if (value === undefined) {
    return (
      <pre className="my-2 overflow-auto rounded-md border border-border bg-panel p-2 text-xs">
        {raw}
      </pre>
    );
  }

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border bg-panel-elevated px-2 py-1 text-[11px] text-muted-foreground">
        <span className="font-mono">json · {lines} lines</span>
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
      <div
        className={
          full ? "max-h-[70vh] overflow-auto p-2 text-xs" : "max-h-48 overflow-auto p-2 text-xs"
        }
      >
        <Suspense fallback={<span className="font-mono text-muted-foreground">loading…</span>}>
          <JsonAsync value={value} />
        </Suspense>
      </div>
    </div>
  );
}

function JsonAsync({ value }: { value: unknown }) {
  const [styles, setStyles] = useState<Record<string, string> | null>(stylesCache);
  useEffect(() => {
    if (styles) return;
    let cancelled = false;
    loadDarkStyles().then((s) => {
      if (!cancelled) setStyles(s);
    });
    return () => {
      cancelled = true;
    };
  }, [styles]);
  if (!styles) {
    return <span className="font-mono text-muted-foreground">loading…</span>;
  }
  return <JsonView data={value as object} style={styles as never} />;
}
