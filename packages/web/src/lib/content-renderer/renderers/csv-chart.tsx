import { useEffect, useMemo, useState } from "react";

type RechartsMod = typeof import("recharts");

// Cache the dynamic import so multiple charts share one network round-trip.
let rechartsPromise: Promise<RechartsMod> | null = null;
function loadRecharts(): Promise<RechartsMod> {
  if (!rechartsPromise) rechartsPromise = import("recharts");
  return rechartsPromise;
}

type Mode = "line" | "bar";

/**
 * Render a CSV table as a chart. Auto-detects numeric columns and uses the
 * first non-numeric column as the X axis (falling back to row index).
 *
 * Recharts (~120 KB gz) is loaded on demand, only when this component mounts.
 */
export function CsvChart({ header, rows }: { header: string[]; rows: string[][] }) {
  const [mode, setMode] = useState<Mode>("line");
  const [R, setR] = useState<RechartsMod | null>(null);

  useEffect(() => {
    let live = true;
    loadRecharts().then((m) => {
      if (live) setR(m);
    });
    return () => {
      live = false;
    };
  }, []);

  const { xKey, numericCols, data, ok } = useMemo(() => analyse(header, rows), [header, rows]);

  if (!ok) {
    return (
      <div className="rounded-md border border-border bg-panel p-4 text-xs text-muted-foreground">
        No numeric columns detected — chart view is unavailable for this data.
      </div>
    );
  }

  const palette = ["#8ab4f8", "#a6e3a1", "#f9e2af", "#f38ba8", "#cba6f7", "#94e2d5"];

  return (
    <div className="flex h-full min-h-[320px] flex-col gap-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">View</span>
        {(["line", "bar"] as const).map((m) => (
          <button
            type="button"
            key={m}
            onClick={() => setMode(m)}
            className={`rounded border px-2 py-0.5 transition-colors ${
              mode === m
                ? "border-accent/60 bg-accent/15 text-accent"
                : "border-border bg-panel text-muted-foreground hover:text-foreground"
            }`}
          >
            {m}
          </button>
        ))}
        <span className="ml-auto text-muted-foreground">
          x: <span className="text-foreground">{xKey}</span> · {numericCols.length} numeric col
          {numericCols.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {R ? (
          <R.ResponsiveContainer width="100%" height="100%">
            {mode === "line" ? (
              <R.LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <R.CartesianGrid stroke="#1f2630" />
                <R.XAxis dataKey={xKey} stroke="#7a8595" />
                <R.YAxis stroke="#7a8595" />
                <R.Tooltip
                  contentStyle={{
                    background: "#11151a",
                    border: "1px solid #1f2630",
                    fontSize: 12,
                  }}
                />
                <R.Legend wrapperStyle={{ fontSize: 12 }} />
                {numericCols.map((c, i) => (
                  <R.Line
                    key={c}
                    type="monotone"
                    dataKey={c}
                    stroke={palette[i % palette.length]}
                    dot={false}
                  />
                ))}
              </R.LineChart>
            ) : (
              <R.BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <R.CartesianGrid stroke="#1f2630" />
                <R.XAxis dataKey={xKey} stroke="#7a8595" />
                <R.YAxis stroke="#7a8595" />
                <R.Tooltip
                  contentStyle={{
                    background: "#11151a",
                    border: "1px solid #1f2630",
                    fontSize: 12,
                  }}
                />
                <R.Legend wrapperStyle={{ fontSize: 12 }} />
                {numericCols.map((c, i) => (
                  <R.Bar key={c} dataKey={c} fill={palette[i % palette.length]} />
                ))}
              </R.BarChart>
            )}
          </R.ResponsiveContainer>
        ) : (
          <div className="text-xs text-muted-foreground">Loading chart…</div>
        )}
      </div>
    </div>
  );
}

function isNumericish(v: string): boolean {
  if (v == null || v === "") return false;
  const cleaned = v.replace(/[,_\s%$]/g, "");
  return cleaned !== "" && !Number.isNaN(Number(cleaned));
}
function toNumber(v: string): number {
  return Number(v.replace(/[,_\s%$]/g, ""));
}

function analyse(header: string[], rows: string[][]) {
  if (header.length === 0 || rows.length === 0) {
    return { xKey: "i", numericCols: [] as string[], data: [], ok: false as const };
  }
  const numericMask = header.map((_, ci) => {
    let num = 0;
    let total = 0;
    for (const r of rows) {
      const v = r[ci] ?? "";
      if (v === "") continue;
      total++;
      if (isNumericish(v)) num++;
    }
    return total > 0 && num / total >= 0.8;
  });
  const numericCols = header.filter((_, i) => numericMask[i]);
  if (numericCols.length === 0) {
    return { xKey: "i", numericCols, data: [], ok: false as const };
  }
  const xIdx = numericMask.findIndex((m) => !m);
  const xKey = xIdx >= 0 ? (header[xIdx] ?? "i") : "i";
  const data = rows.map((r, i) => {
    const o: Record<string, string | number> = {};
    o[xKey] = xIdx >= 0 ? (r[xIdx] ?? String(i)) : i;
    for (const c of numericCols) {
      const idx = header.indexOf(c);
      const v = r[idx] ?? "";
      o[c] = isNumericish(v) ? toNumber(v) : 0;
    }
    return o;
  });
  return { xKey, numericCols, data, ok: true as const };
}
