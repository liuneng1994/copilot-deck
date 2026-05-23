import { diffLines } from "diff";
import { ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { highlightToHtml } from "../../lib/shiki";
import { cn } from "../../lib/cn";

interface DiffRow {
  kind: "add" | "del" | "ctx";
  text: string;
  oldNo?: number;
  newNo?: number;
}

function langFromPath(p?: string): string {
  if (!p) return "text";
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "ts",
    tsx: "tsx",
    js: "js",
    jsx: "jsx",
    mjs: "js",
    cjs: "js",
    json: "json",
    md: "md",
    py: "py",
    sh: "bash",
    bash: "bash",
    yml: "yaml",
    yaml: "yaml",
    go: "go",
    rs: "rust",
    html: "html",
    css: "css",
    toml: "toml",
    sql: "sql",
  };
  return map[ext] ?? "text";
}

function computeRows(oldText: string, newText: string): DiffRow[] {
  const parts = diffLines(oldText, newText);
  const rows: DiffRow[] = [];
  let oldNo = 1;
  let newNo = 1;
  for (const p of parts) {
    const lines = p.value.split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    for (const line of lines) {
      if (p.added) {
        rows.push({ kind: "add", text: line, newNo: newNo++ });
      } else if (p.removed) {
        rows.push({ kind: "del", text: line, oldNo: oldNo++ });
      } else {
        rows.push({ kind: "ctx", text: line, oldNo: oldNo++, newNo: newNo++ });
      }
    }
  }
  return rows;
}

function extractLinesFromHtml(html: string): string[] {
  // Shiki returns <pre><code><span class="line">...</span>\n<span ...>... lines
  const m = /<code[^>]*>([\s\S]*)<\/code>/.exec(html);
  const body = m?.[1] ?? html;
  // Split on the line span boundaries; Shiki emits one `<span class="line">…</span>` per line.
  const out: string[] = [];
  const re = /<span class="line">([\s\S]*?)<\/span>/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(body))) {
    out.push(mm[1]);
  }
  if (out.length === 0) {
    // Fallback: split text node by newlines
    out.push(body);
  }
  return out;
}

export function DiffView({
  path,
  oldText,
  newText,
}: {
  path?: string;
  oldText?: string;
  newText?: string;
}) {
  const [view, setView] = useState<"unified" | "split">("unified");
  const rows = useMemo(
    () => computeRows(oldText ?? "", newText ?? ""),
    [oldText, newText],
  );
  const adds = rows.filter((r) => r.kind === "add").length;
  const dels = rows.filter((r) => r.kind === "del").length;
  const lang = useMemo(() => langFromPath(path), [path]);

  // Highlight old + new separately so each row maps to one styled <span>.
  const [oldHtml, setOldHtml] = useState<string[] | null>(null);
  const [newHtml, setNewHtml] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      highlightToHtml(oldText ?? "", lang),
      highlightToHtml(newText ?? "", lang),
    ])
      .then(([o, n]) => {
        if (cancelled) return;
        setOldHtml(extractLinesFromHtml(o));
        setNewHtml(extractLinesFromHtml(n));
      })
      .catch(() => {
        if (!cancelled) {
          setOldHtml(null);
          setNewHtml(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [oldText, newText, lang]);

  const renderRow = (r: DiffRow, i: number) => {
    const bg =
      r.kind === "add"
        ? "bg-success/15"
        : r.kind === "del"
          ? "bg-destructive/15"
          : "";
    const sign = r.kind === "add" ? "+" : r.kind === "del" ? "−" : " ";
    const html =
      r.kind === "add"
        ? newHtml?.[(r.newNo ?? 1) - 1]
        : r.kind === "del"
          ? oldHtml?.[(r.oldNo ?? 1) - 1]
          : oldHtml?.[(r.oldNo ?? 1) - 1] ?? newHtml?.[(r.newNo ?? 1) - 1];
    return (
      <div
        key={i}
        className={cn(
          "grid grid-cols-[36px_36px_14px_1fr] font-mono text-[12px] leading-[1.5]",
          bg,
        )}
      >
        <span className="select-none border-r border-border/40 px-1 text-right text-[10px] text-muted-foreground">
          {r.oldNo ?? ""}
        </span>
        <span className="select-none border-r border-border/40 px-1 text-right text-[10px] text-muted-foreground">
          {r.newNo ?? ""}
        </span>
        <span className="select-none px-1 text-muted-foreground">{sign}</span>
        {html ? (
          <span dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <span>{r.text}</span>
        )}
      </div>
    );
  };

  const renderSplit = (r: DiffRow, i: number) => {
    const leftBg = r.kind === "del" ? "bg-destructive/15" : "";
    const rightBg = r.kind === "add" ? "bg-success/15" : "";
    const leftHtml = r.kind !== "add" ? oldHtml?.[(r.oldNo ?? 1) - 1] : "";
    const rightHtml = r.kind !== "del" ? newHtml?.[(r.newNo ?? 1) - 1] : "";
    return (
      <div
        key={i}
        className="grid grid-cols-[36px_1fr_36px_1fr] font-mono text-[12px] leading-[1.5]"
      >
        <span className={cn("select-none border-r border-border/40 px-1 text-right text-[10px] text-muted-foreground", leftBg)}>
          {r.oldNo ?? ""}
        </span>
        <span className={cn("border-r border-border/40 px-2", leftBg)}>
          {leftHtml != null ? (
            <span dangerouslySetInnerHTML={{ __html: leftHtml }} />
          ) : (
            <span>{r.kind !== "add" ? r.text : ""}</span>
          )}
        </span>
        <span className={cn("select-none border-r border-border/40 px-1 text-right text-[10px] text-muted-foreground", rightBg)}>
          {r.newNo ?? ""}
        </span>
        <span className={cn("px-2", rightBg)}>
          {rightHtml != null ? (
            <span dangerouslySetInnerHTML={{ __html: rightHtml }} />
          ) : (
            <span>{r.kind !== "del" ? r.text : ""}</span>
          )}
        </span>
      </div>
    );
  };

  return (
    <div className="overflow-hidden rounded-md border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border bg-panel/60 px-2.5 py-1 text-[11px]">
        <div className="flex items-center gap-2 truncate">
          <span className="truncate font-mono text-foreground">{path ?? "(diff)"}</span>
          <span className="shrink-0 text-muted-foreground">
            <span className="text-success">+{adds}</span>
            <span className="mx-0.5">/</span>
            <span className="text-destructive">−{dels}</span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => setView(view === "unified" ? "split" : "unified")}
            className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {view === "unified" ? "Split" : "Unified"}
          </button>
          {path && (
            <a
              href={`/api/open-in-editor?path=${encodeURIComponent(path)}`}
              onClick={(e) => {
                e.preventDefault();
                fetch(`/api/open-in-editor?path=${encodeURIComponent(path)}`, {
                  method: "POST",
                }).catch(() => undefined);
              }}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Open in editor"
            >
              <ExternalLink className="h-3 w-3" />
              Open
            </a>
          )}
        </div>
      </div>
      <div className="max-h-[480px] overflow-auto">
        {rows.length === 0 ? (
          <div className="px-2.5 py-2 text-[11px] text-muted-foreground">(no changes)</div>
        ) : view === "unified" ? (
          rows.map(renderRow)
        ) : (
          rows.map(renderSplit)
        )}
      </div>
    </div>
  );
}
