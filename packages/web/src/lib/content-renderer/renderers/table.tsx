import { ArrowDownUp, ExternalLink, Filter } from "lucide-react";
import { useMemo, useState } from "react";
import { useArtifactStore } from "../../../stores/artifact-store";
import { cn } from "../../cn";

/**
 * Interactive table renderer used both inline (thumbnail mode) and in the
 * artifact pane (full mode). Full mode adds click-to-sort, filter input,
 * sticky header, and CSV download.
 */
export function TableInline({
  id,
  header,
  rows,
  hoisted,
  sessionId,
  full,
}: {
  id: string;
  header: string[];
  rows: string[][];
  hoisted: boolean;
  sessionId: string;
  full?: boolean;
}) {
  const focus = useArtifactStore((s) => s.focus);
  const [sortIdx, setSortIdx] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filter, setFilter] = useState("");
  const [showFilter, setShowFilter] = useState(false);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return rows;
    return rows.filter((r) => r.some((c) => c.toLowerCase().includes(f)));
  }, [rows, filter]);

  const sorted = useMemo(() => {
    if (sortIdx === null) return filtered;
    const arr = filtered.slice();
    arr.sort((a, b) => {
      const av = a[sortIdx] ?? "";
      const bv = b[sortIdx] ?? "";
      const an = Number(av);
      const bn = Number(bv);
      const cmp =
        Number.isFinite(an) && Number.isFinite(bn) && av !== "" && bv !== ""
          ? an - bn
          : av.localeCompare(bv);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [filtered, sortIdx, sortDir]);

  const previewLimit = full ? sorted.length : 3;
  const shown = sorted.slice(0, previewLimit);
  const hiddenCount = sorted.length - shown.length;

  const toggleSort = (i: number) => {
    if (sortIdx !== i) {
      setSortIdx(i);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortIdx(null);
    }
  };

  const exportCsv = () => {
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = [header.map(esc).join(","), ...sorted.map((r) => r.map(esc).join(","))];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `table-${id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border bg-panel">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-panel-elevated px-2 py-1 text-[11px] text-muted-foreground">
        <span className="font-mono">
          table · {rows.length} row{rows.length === 1 ? "" : "s"} · {header.length} col
        </span>
        <div className="flex items-center gap-1">
          {full && (
            <button
              type="button"
              onClick={() => setShowFilter((v) => !v)}
              className={cn("rounded p-1 hover:bg-muted", showFilter && "bg-muted text-foreground")}
              title="Filter rows"
            >
              <Filter className="h-3 w-3" />
            </button>
          )}
          {full && (
            <button
              type="button"
              onClick={exportCsv}
              className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider hover:bg-muted hover:text-foreground"
              title="Download as CSV"
            >
              csv
            </button>
          )}
          {!full && hoisted && (
            <button
              type="button"
              onClick={() => focus(sessionId, `${sessionId}:${id}`)}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider hover:bg-muted hover:text-foreground"
              title="Open in artifact pane"
            >
              <ExternalLink className="h-3 w-3" />
              open
            </button>
          )}
        </div>
      </div>
      {full && showFilter && (
        <input
          // biome-ignore lint/a11y/noAutofocus: revealing the input intends focus
          autoFocus
          placeholder="filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full border-b border-border bg-transparent px-2 py-1 text-xs outline-none placeholder:text-muted-foreground/60"
        />
      )}
      <div className={cn("overflow-auto", full && "max-h-[60vh]")}>
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-panel-elevated">
            <tr>
              {header.map((h, i) => (
                <th
                  key={`h-${i}-${h}`}
                  onClick={() => full && toggleSort(i)}
                  onKeyDown={(e) => {
                    if (full && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      toggleSort(i);
                    }
                  }}
                  className={cn(
                    "border-b border-border px-2 py-1 text-left font-medium",
                    full && "cursor-pointer select-none hover:bg-muted",
                  )}
                >
                  <span className="inline-flex items-center gap-1">
                    {h}
                    {full && sortIdx === i && (
                      <ArrowDownUp
                        className={cn(
                          "h-3 w-3 transition-transform",
                          sortDir === "desc" && "rotate-180",
                        )}
                      />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, ri) => (
              <tr key={`r-${ri}-${r[0] ?? ""}`} className="odd:bg-muted/20">
                {header.map((_, ci) => (
                  <td
                    key={`c-${ri}-${ci}-${r[ci] ?? ""}`}
                    className="border-b border-border/50 px-2 py-1 align-top font-mono"
                  >
                    {r[ci] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hiddenCount > 0 && (
        <div className="flex items-center justify-between border-t border-border bg-panel-elevated px-2 py-1 text-[10px] text-muted-foreground">
          <span>
            + {hiddenCount} more row{hiddenCount === 1 ? "" : "s"}
          </span>
          {!full && hoisted && (
            <button
              type="button"
              onClick={() => focus(sessionId, `${sessionId}:${id}`)}
              className="text-primary hover:underline"
            >
              view all →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
