import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import { type SupportedLang, highlightToHtml } from "../../lib/shiki";
import { useUserPrefs } from "../../stores/user-prefs-store";

const COLLAPSE_THRESHOLD = 40;

function resolveTheme(theme: "light" | "dark" | "system") {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function CodeBlock({
  code,
  lang,
  inline,
}: {
  code: string;
  lang?: string;
  inline?: boolean;
}) {
  const normalizedLang = (lang ?? "text").toLowerCase().replace(/^language-/, "");
  const theme = useUserPrefs((s) => s.theme);
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">(() => resolveTheme(theme));
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const lineCount = code.split("\n").length;
  const isLong = lineCount > COLLAPSE_THRESHOLD;
  const [expanded, setExpanded] = useState(!isLong);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      setResolvedTheme(theme === "system" ? (media.matches ? "dark" : "light") : theme);
    apply();
    if (theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    if (inline) return;
    let cancelled = false;
    highlightToHtml(code, normalizedLang as SupportedLang, resolvedTheme)
      .then((h) => {
        if (!cancelled) setHtml(h);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, normalizedLang, inline, resolvedTheme]);

  if (inline) {
    return (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">
        {code}
      </code>
    );
  }

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border bg-background text-[13px]">
      <div className="flex items-center justify-between border-b border-border bg-panel/60 px-2.5 py-1">
        <div className="flex items-center gap-2">
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted"
              title={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
          )}
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {normalizedLang || "text"}
          </span>
          <span className="text-[10px] text-muted-foreground">· {lineCount} lines</span>
        </div>
        <button
          type="button"
          onClick={onCopy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className={cn("shiki-host overflow-auto", expanded ? "max-h-[480px]" : "max-h-32")}>
        {html ? (
          <div
            // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki produces sanitized highlight HTML
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className="m-0 p-3 font-mono text-[12.5px] text-foreground">{code}</pre>
        )}
      </div>
    </div>
  );
}
