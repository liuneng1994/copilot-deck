import { Braces, FilePlus2, FlaskConical, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../../lib/cn";
import type { WorkbenchSymbol } from "../../../stores/files-slice";
import { useUIStore } from "../../../stores/ui-store";

interface SymbolsResponse {
  symbols?: WorkbenchSymbol[];
  error?: string;
}

export function SymbolsBrowser({ cwd }: { cwd: string }) {
  const hasCwd = cwd.trim().length > 0;
  const query = useUIStore((s) => s.filters.query);
  const selectedFilePath = useUIStore((s) => s.selectedFilePath);
  const setSelectedFilePath = useUIStore((s) => s.setSelectedFilePath);
  const setFocusedSymbol = useUIStore((s) => s.setFocusedSymbol);
  const setFilesViewMode = useUIStore((s) => s.setFilesViewMode);
  const addWorksetItem = useUIStore((s) => s.addWorksetItem);
  const [symbols, setSymbols] = useState<WorkbenchSymbol[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken is an explicit refresh signal.
  useEffect(() => {
    if (!hasCwd) {
      setSymbols([]);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ cwd, q: query.trim(), limit: "80" });
    setLoading(true);
    setError(null);
    fetch(`/api/workbench/symbols?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as SymbolsResponse;
        if (!response.ok)
          throw new Error(body.error ?? `${response.status} ${response.statusText}`);
        return body.symbols ?? [];
      })
      .then(setSymbols)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setSymbols([]);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cwd, hasCwd, query, reloadToken]);

  const focusSymbol = (symbol: WorkbenchSymbol) => {
    setFocusedSymbol(symbol);
    setSelectedFilePath(symbol.path);
  };

  const addSymbol = (symbol: WorkbenchSymbol) => {
    focusSymbol(symbol);
    addWorksetItem({
      id: `symbol:${symbol.id}`,
      kind: "symbol",
      path: symbol.path,
      label: `${symbol.kind} ${symbol.name}`,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
    });
  };

  const addFile = (symbol: WorkbenchSymbol) => {
    focusSymbol(symbol);
    addWorksetItem({
      id: `file:${symbol.path}`,
      kind: "file",
      path: symbol.path,
      label: symbol.path,
    });
  };

  if (error) {
    return (
      <div className="space-y-2 px-3 py-3 text-[12px]">
        <div className="font-medium text-destructive">Unable to load symbols</div>
        <div className="text-muted-foreground">{error}</div>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-foreground hover:bg-muted"
          onClick={() => setReloadToken((value) => value + 1)}
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      </div>
    );
  }

  if (!hasCwd) {
    return (
      <div className="px-3 py-3 text-[11px] text-muted-foreground">
        Create or select a session with a workspace folder before loading symbols.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{loading ? "Indexing symbols…" : `Symbols · ${symbols.length}`}</span>
        <button
          type="button"
          className="rounded p-1 hover:bg-muted hover:text-foreground"
          onClick={() => setReloadToken((value) => value + 1)}
          title="Refresh symbols"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
        </button>
      </div>
      {symbols.length === 0 && !loading ? (
        <div className="px-3 py-3 text-[11px] text-muted-foreground">
          {query.trim() ? "No symbols match the current search." : "No symbols found yet."}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {symbols.map((symbol) => {
            const selected = selectedFilePath === symbol.path;
            return (
              <div
                key={symbol.id}
                className={cn(
                  "group flex items-center gap-2 px-3 py-1.5 text-left text-[11px]",
                  selected
                    ? "bg-primary/15 text-foreground"
                    : "text-muted-foreground hover:bg-muted/60",
                )}
              >
                <button
                  type="button"
                  onClick={() => focusSymbol(symbol)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  title={`${symbol.path}:${symbol.startLine}-${symbol.endLine}`}
                >
                  <Braces className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1">
                    <span className="mr-1 rounded bg-muted px-1 font-mono text-[10px] uppercase">
                      {symbol.kind}
                    </span>
                    <span className="font-medium text-foreground">{symbol.name}</span>
                    <span className="ml-2 block truncate font-mono text-[10px] text-muted-foreground">
                      {symbol.path}:{symbol.startLine}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => addSymbol(symbol)}
                  title="Add symbol to context"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => addFile(symbol)}
                  title="Add file to context"
                >
                  <FilePlus2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => {
                    focusSymbol(symbol);
                    setFilesViewMode("tests");
                  }}
                  title="Find related tests"
                >
                  <FlaskConical className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
