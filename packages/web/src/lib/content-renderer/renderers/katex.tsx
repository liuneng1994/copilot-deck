import { useEffect, useState } from "react";

let katexPromise: Promise<typeof import("katex").default> | null = null;
function loadKatex() {
  if (!katexPromise) {
    katexPromise = Promise.all([
      import("katex"),
      // CSS as side-effect import so KaTeX glyphs render with correct fonts.
      import("katex/dist/katex.min.css"),
    ]).then(([m]) => m.default);
  }
  return katexPromise;
}

/** Block math `$$…$$` renderer. Inline math is not classified yet. */
export function MathBlock({ tex }: { tex: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadKatex()
      .then((k) => {
        if (cancelled) return;
        try {
          setHtml(k.renderToString(tex, { displayMode: true, throwOnError: false }));
          setErr(null);
        } catch (e) {
          setErr((e as Error).message);
        }
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [tex]);
  if (err) {
    return <pre className="my-2 text-xs text-rose-300">math: {err}</pre>;
  }
  if (!html) {
    return <pre className="my-2 font-mono text-xs text-muted-foreground">$$ {tex} $$</pre>;
  }
  return (
    <div
      className="my-2 overflow-auto text-center"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: katex output is sanitised
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
