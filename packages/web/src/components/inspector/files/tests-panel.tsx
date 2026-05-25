import { Copy, FlaskConical, Plus, RefreshCw, TerminalSquare } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "../../../lib/cn";
import { useUIStore } from "../../../stores/ui-store";

interface TestMatch {
  path: string;
  score: number;
}

interface TestsResponse {
  tests?: TestMatch[];
  commands?: string[];
  error?: string;
}

export function TestsPanel({ cwd }: { cwd: string }) {
  const hasCwd = cwd.trim().length > 0;
  const selectedFilePath = useUIStore((s) => s.selectedFilePath);
  const focusedSymbol = useUIStore((s) => s.focusedSymbol);
  const addWorksetItem = useUIStore((s) => s.addWorksetItem);
  const setSelectedFilePath = useUIStore((s) => s.setSelectedFilePath);
  const [tests, setTests] = useState<TestMatch[]>([]);
  const [commands, setCommands] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const focusPath = focusedSymbol?.path ?? selectedFilePath ?? "";
  const symbolName = focusedSymbol?.name ?? "";

  const paramsKey = useMemo(
    () => `${cwd}\n${focusPath}\n${symbolName}`,
    [cwd, focusPath, symbolName],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken is an explicit refresh signal.
  useEffect(() => {
    if (!hasCwd) {
      setTests([]);
      setCommands([]);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ cwd, path: focusPath, symbol: symbolName, limit: "40" });
    setLoading(true);
    setError(null);
    fetch(`/api/workbench/tests?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as TestsResponse;
        if (!response.ok)
          throw new Error(body.error ?? `${response.status} ${response.statusText}`);
        return body;
      })
      .then((body) => {
        setTests(body.tests ?? []);
        setCommands(body.commands ?? []);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setTests([]);
          setCommands([]);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [hasCwd, paramsKey, reloadToken]);

  const addTest = (path: string) =>
    addWorksetItem({ id: `test:${path}`, kind: "test", path, label: path });
  const addCommand = (command: string) =>
    addWorksetItem({ id: `build:${command}`, kind: "buildTarget", label: command, command });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{loading ? "Finding related tests…" : `Related tests · ${tests.length}`}</span>
        <button
          type="button"
          className="rounded p-1 hover:bg-muted hover:text-foreground"
          onClick={() => setReloadToken((value) => value + 1)}
          title="Refresh related tests"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
        </button>
      </div>
      {!hasCwd ? (
        <div className="border-b border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
          Create or select a session with a workspace folder before finding related tests.
        </div>
      ) : focusedSymbol || selectedFilePath ? (
        <div className="border-b border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
          Focus:{" "}
          <span className="font-mono text-foreground">
            {focusedSymbol ? `${focusedSymbol.name} @ ${focusedSymbol.path}` : selectedFilePath}
          </span>
        </div>
      ) : (
        <div className="border-b border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
          Select a symbol or file first to rank related tests.
        </div>
      )}
      {error ? <div className="px-3 py-2 text-[12px] text-destructive">{error}</div> : null}
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {tests.map((test) => (
          <div
            key={test.path}
            className="group flex items-center gap-2 px-3 py-1.5 text-[11px] text-muted-foreground hover:bg-muted/60"
          >
            <button
              type="button"
              onClick={() => setSelectedFilePath(test.path)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              title={test.path}
            >
              <FlaskConical className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
              <span className="truncate font-mono text-foreground">{test.path}</span>
            </button>
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => addTest(test.path)}
              title="Add test to context"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {tests.length === 0 && !loading ? (
          <div className="px-3 py-3 text-[11px] text-muted-foreground">No related tests found.</div>
        ) : null}
        {commands.length > 0 ? (
          <div className="mt-2 border-t border-border/60 px-3 py-2">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Suggested validation
            </div>
            {commands.map((command) => (
              <div key={command} className="flex items-center gap-2 py-1 text-[11px]">
                <TerminalSquare className="h-3.5 w-3.5 text-muted-foreground" />
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-1 py-0.5 font-mono">
                  {command}
                </code>
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => navigator.clipboard.writeText(command).catch(() => {})}
                  title="Copy command"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => addCommand(command)}
                  title="Add validation command to context"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
