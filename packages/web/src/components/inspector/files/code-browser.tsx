import { FilePlus2, FileText, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "../../../lib/cn";
import { useUIStore } from "../../../stores/ui-store";

interface CodeBrowserProps {
  cwd: string;
}

interface FilesResponse {
  files?: string[];
  error?: string;
}

function splitPath(filePath: string): { dir: string; base: string } {
  const slash = filePath.lastIndexOf("/");
  return {
    dir: slash >= 0 ? filePath.slice(0, slash + 1) : "",
    base: slash >= 0 ? filePath.slice(slash + 1) : filePath,
  };
}

export function CodeBrowser({ cwd }: CodeBrowserProps) {
  const hasCwd = cwd.trim().length > 0;
  const query = useUIStore((s) => s.filters.query);
  const selectedFilePath = useUIStore((s) => s.selectedFilePath);
  const setSelectedFilePath = useUIStore((s) => s.setSelectedFilePath);
  const setFilePreviewMaximized = useUIStore((s) => s.setFilePreviewMaximized);
  const addWorksetItem = useUIStore((s) => s.addWorksetItem);
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadToken is an explicit refresh signal.
  useEffect(() => {
    if (!hasCwd) {
      setFiles([]);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({
      cwd,
      q: query.trim(),
      limit: "200",
    });

    setLoading(true);
    setError(null);
    fetch(`/api/files?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as FilesResponse;
        if (!response.ok)
          throw new Error(body.error ?? `${response.status} ${response.statusText}`);
        return body.files ?? [];
      })
      .then((nextFiles) => {
        setFiles(nextFiles);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setFiles([]);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [cwd, hasCwd, query, reloadToken]);

  const selected = useMemo(
    () => new Set(selectedFilePath ? [selectedFilePath] : []),
    [selectedFilePath],
  );

  if (error) {
    return (
      <div className="space-y-2 px-3 py-3 text-[12px]">
        <div className="font-medium text-destructive">Unable to load project files</div>
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
        Create or select a session with a workspace folder before browsing project files.
      </div>
    );
  }

  if (!loading && files.length === 0) {
    return (
      <div className="px-3 py-3 text-[11px] text-muted-foreground">
        {query.trim() ? "No project files match the current search." : "No project files found."}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{loading ? "Loading project files…" : `Project files · ${files.length}`}</span>
        <button
          type="button"
          className="rounded p-1 hover:bg-muted hover:text-foreground"
          onClick={() => setReloadToken((value) => value + 1)}
          title="Refresh project file list"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {files.map((filePath) => {
          const { dir, base } = splitPath(filePath);
          const isSelected = selected.has(filePath);
          return (
            <div
              key={filePath}
              className={cn(
                "flex h-[28px] w-full items-center gap-2 px-3 text-left text-[11px]",
                isSelected
                  ? "bg-primary/15 text-foreground"
                  : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              <button
                type="button"
                onClick={() => setSelectedFilePath(filePath)}
                onDoubleClick={() => {
                  setSelectedFilePath(filePath);
                  setFilePreviewMaximized(true);
                }}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                title={filePath}
              >
                <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-muted-foreground">{dir}</span>
                  <span className="font-medium text-foreground">{base}</span>
                </span>
              </button>
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() =>
                  addWorksetItem({
                    id: `file:${filePath}`,
                    kind: "file",
                    path: filePath,
                    label: filePath,
                  })
                }
                title="Add file to context"
              >
                <FilePlus2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
