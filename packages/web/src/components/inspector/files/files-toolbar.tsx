import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../../lib/cn";
import type { FileSourceFilter, FilesFilters, FilesViewMode } from "../../../stores/files-slice";
import { useUIStore } from "../../../stores/ui-store";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";

interface FilesToolbarProps {
  cwd: string;
}

const VIEW_MODES: { value: FilesViewMode; label: string }[] = [
  { value: "files", label: "files" },
  { value: "code", label: "code" },
  { value: "symbols", label: "symbols" },
  { value: "tests", label: "tests" },
  { value: "context", label: "context" },
  { value: "search", label: "search" },
  { value: "timeline", label: "timeline" },
];

const SOURCE_FILTERS: { value: FileSourceFilter; label: string }[] = [
  { value: "touched", label: "Touched" },
  { value: "dirty", label: "Dirty" },
  { value: "untracked", label: "Untracked" },
  { value: "all", label: "All" },
];

const SORT_OPTIONS: { value: FilesFilters["sort"]; label: string }[] = [
  { value: "recency", label: "Recency" },
  { value: "changes", label: "Changes" },
  { value: "path", label: "Path" },
];

const GROUP_OPTIONS: { value: FilesFilters["group"]; label: string }[] = [
  { value: "directory", label: "Directory" },
  { value: "touch", label: "Touch type" },
  { value: "turn", label: "Turn" },
];

export function FilesToolbar({ cwd }: FilesToolbarProps) {
  const viewMode = useUIStore((s) => s.filesViewMode);
  const filters = useUIStore((s) => s.filters);
  const setFilesViewMode = useUIStore((s) => s.setFilesViewMode);
  const setFilesFilters = useUIStore((s) => s.setFilesFilters);
  const setSelectedFilePath = useUIStore((s) => s.setSelectedFilePath);
  const setFilePreviewMaximized = useUIStore((s) => s.setFilePreviewMaximized);
  const setFilePreviewPath = useUIStore((s) => s.setFilePreviewPath);
  const [query, setQuery] = useState(filters.query);

  useEffect(() => {
    setQuery(filters.query);
  }, [filters.query]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (query !== useUIStore.getState().filters.query) {
        setFilesFilters({ query });
      }
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [query, setFilesFilters]);

  const switchViewMode = (mode: FilesViewMode) => {
    if (mode !== viewMode) {
      setSelectedFilePath(null);
      setFilePreviewPath(null);
      setFilePreviewMaximized(false);
    }
    setFilesViewMode(mode);
  };

  return (
    <div
      aria-label={`Files toolbar for ${cwd}`}
      className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs"
    >
      <div className="min-w-0 overflow-x-auto rounded-md border border-border bg-panel p-0.5">
        <div className="inline-flex min-w-max">
          {VIEW_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              aria-pressed={viewMode === mode.value}
              onClick={() => switchViewMode(mode.value)}
              className={cn(
                "rounded px-2.5 py-1 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                viewMode === mode.value &&
                  "bg-primary/15 text-primary shadow-sm hover:bg-primary/15",
              )}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative min-w-[10rem] flex-1">
        <Search className="-translate-y-1/2 pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={
            viewMode === "code"
              ? "Find project files…"
              : viewMode === "symbols"
                ? "Find classes, methods, functions…"
                : "Search file paths…"
          }
          className="h-8 bg-background pl-8 text-xs"
          aria-label="Search file paths"
        />
      </div>

      {viewMode === "files" && (
        <>
          <div className="flex min-w-0 shrink overflow-x-auto items-center gap-1">
            <div className="inline-flex min-w-max gap-1">
              {SOURCE_FILTERS.map((source) => (
                <button
                  key={source.value}
                  type="button"
                  aria-pressed={filters.source === source.value}
                  onClick={() => setFilesFilters({ source: source.value })}
                  className={cn(
                    "rounded-full border border-border px-2.5 py-1 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    filters.source === source.value &&
                      "border-primary/30 bg-primary/15 text-primary hover:bg-primary/15",
                  )}
                >
                  {source.label}
                </button>
              ))}
            </div>
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1 text-xs">
                View
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-1 text-xs">
              <ToggleItem
                label="Flat list"
                checked={filters.flat}
                onClick={() => setFilesFilters({ flat: !filters.flat })}
              />
              <MenuSection label="Sort by">
                {SORT_OPTIONS.map((option) => (
                  <RadioItem
                    key={option.value}
                    label={option.label}
                    checked={filters.sort === option.value}
                    onClick={() => setFilesFilters({ sort: option.value })}
                  />
                ))}
              </MenuSection>
              <MenuSection label="Group by">
                {GROUP_OPTIONS.map((option) => (
                  <RadioItem
                    key={option.value}
                    label={option.label}
                    checked={filters.group === option.value}
                    onClick={() => setFilesFilters({ group: option.value })}
                  />
                ))}
              </MenuSection>
              <div className="my-1 h-px bg-border" />
              <ToggleItem
                label="Show generated files"
                checked={filters.showGenerated}
                onClick={() => setFilesFilters({ showGenerated: !filters.showGenerated })}
              />
              <ToggleItem
                label="Show ignored files"
                checked={filters.showIgnored}
                onClick={() => setFilesFilters({ showIgnored: !filters.showIgnored })}
              />
            </PopoverContent>
          </Popover>
        </>
      )}
    </div>
  );
}

function MenuSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-1 border-t border-border pt-1">
      <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function ToggleItem({
  label,
  checked,
  onClick,
}: {
  label: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-muted"
    >
      <Check className={cn("h-3.5 w-3.5", checked ? "text-primary" : "opacity-0")} />
      <span>{label}</span>
    </button>
  );
}

function RadioItem({
  label,
  checked,
  onClick,
}: {
  label: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-muted"
    >
      <Check className={cn("h-3.5 w-3.5", checked ? "text-primary" : "opacity-0")} />
      <span>{label}</span>
    </button>
  );
}
