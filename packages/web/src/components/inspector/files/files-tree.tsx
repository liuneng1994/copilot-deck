import type { FileEntry } from "@agent-view/shared";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type KeyboardEvent, useCallback, useMemo, useRef, useState } from "react";
import { cn } from "../../../lib/cn";
import { type SessionState, useUIStore } from "../../../stores/ui-store";
import { FileRow } from "./file-row";

interface FilesTreeProps {
  entries: FileEntry[];
  session: SessionState;
}

type TreeNode = {
  name: string;
  path: string;
  dirs: Map<string, TreeNode>;
  files: FileEntry[];
  generated: FileEntry[];
};

type VisibleRow =
  | { kind: "dir"; id: string; label: string; depth: number; open: boolean; path: string }
  | { kind: "file"; id: string; entry: FileEntry; depth: number }
  | {
      kind: "generated";
      id: string;
      entries: FileEntry[];
      depth: number;
      open: boolean;
      dirPath: string;
    };

const ROOT: TreeNode = { name: "", path: "", dirs: new Map(), files: [], generated: [] };

function fileKey(entry: FileEntry) {
  return entry.path || entry.rel;
}

function compareEntries(sort: "recency" | "changes" | "path") {
  return (a: FileEntry, b: FileEntry) => {
    if (sort === "recency")
      return (b.lastTouchAt ?? 0) - (a.lastTouchAt ?? 0) || a.rel.localeCompare(b.rel);
    if (sort === "changes") {
      const aChanges = (a.added ?? 0) + (a.removed ?? 0);
      const bChanges = (b.added ?? 0) + (b.removed ?? 0);
      return bChanges - aChanges || a.rel.localeCompare(b.rel);
    }
    return a.rel.localeCompare(b.rel);
  };
}

function filterBySource(entry: FileEntry, source: string) {
  if (source === "touched") return entry.source === "agent";
  if (source === "dirty") return entry.source === "dirty";
  if (source === "untracked") return entry.source === "untracked";
  return true;
}

function buildTree(entries: FileEntry[]) {
  const root: TreeNode = { ...ROOT, dirs: new Map(), files: [], generated: [] };
  for (const entry of entries) {
    const parts = (entry.rel || entry.path).split("/").filter(Boolean);
    let node = root;
    for (const part of parts.slice(0, -1)) {
      const childPath = node.path ? `${node.path}/${part}` : part;
      let child = node.dirs.get(part);
      if (!child) {
        child = { name: part, path: childPath, dirs: new Map(), files: [], generated: [] };
        node.dirs.set(part, child);
      }
      node = child;
    }
    if (entry.isGenerated) node.generated.push(entry);
    else node.files.push(entry);
  }
  return root;
}

function collapseDirectory(node: TreeNode) {
  const labels = [node.name];
  let current = node;
  while (current.files.length === 0 && current.generated.length === 0 && current.dirs.size === 1) {
    const next = [...current.dirs.values()][0];
    if (!next) break;
    labels.push(next.name);
    current = next;
  }
  return { node: current, label: `${labels.join("/")}/` };
}

function flattenTree(root: TreeNode, openDirs: Set<string>, openGenerated: Set<string>) {
  const rows: VisibleRow[] = [];

  const visit = (node: TreeNode, depth: number) => {
    for (const dir of node.dirs.values()) {
      const collapsed = collapseDirectory(dir);
      const path = collapsed.node.path;
      const open = openDirs.has(path);
      rows.push({ kind: "dir", id: `dir:${path}`, label: collapsed.label, depth, open, path });
      if (open) visit(collapsed.node, depth + 1);
    }
    if (node.generated.length > 0) {
      const id = node.path || "__root__";
      const open = openGenerated.has(id);
      rows.push({
        kind: "generated",
        id: `gen:${id}`,
        entries: node.generated,
        depth,
        open,
        dirPath: id,
      });
      if (open) {
        for (const entry of node.generated)
          rows.push({ kind: "file", id: `file:${fileKey(entry)}`, entry, depth: depth + 1 });
      }
    }
    for (const entry of node.files)
      rows.push({ kind: "file", id: `file:${fileKey(entry)}`, entry, depth });
  };

  visit(root, 0);
  return rows;
}

function collectDirPaths(node: TreeNode, out = new Set<string>()) {
  for (const dir of node.dirs.values()) {
    const collapsed = collapseDirectory(dir);
    out.add(collapsed.node.path);
    collectDirPaths(collapsed.node, out);
  }
  return out;
}

export function FilesTree({ entries, session }: FilesTreeProps) {
  const filters = useUIStore((s) => s.filters);
  const selectedFilePath = useUIStore((s) => s.selectedFilePath);
  const setSelectedFilePath = useUIStore((s) => s.setSelectedFilePath);
  const [toggledClosed, setToggledClosed] = useState<Set<string>>(() => new Set());
  const [toggledOpen, setToggledOpen] = useState<Set<string>>(() => new Set());
  const [openGenerated, setOpenGenerated] = useState<Set<string>>(() => new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const sortedEntries = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return entries
      .filter((entry) => filterBySource(entry, filters.source))
      .filter(
        (entry) =>
          !query ||
          entry.path.toLowerCase().includes(query) ||
          entry.rel.toLowerCase().includes(query),
      )
      .filter((entry) => filters.showGenerated || !entry.isGenerated || !filters.flat)
      .slice()
      .sort(compareEntries(filters.sort));
  }, [entries, filters]);

  const tree = useMemo(() => buildTree(sortedEntries), [sortedEntries]);
  const defaultOpenDirs = useMemo(() => collectDirPaths(tree), [tree]);
  const openDirs = useMemo(() => {
    const next = new Set(defaultOpenDirs);
    for (const path of toggledOpen) next.add(path);
    for (const path of toggledClosed) next.delete(path);
    return next;
  }, [defaultOpenDirs, toggledClosed, toggledOpen]);

  const rows = useMemo<VisibleRow[]>(() => {
    if (filters.flat || filters.group !== "directory") {
      return sortedEntries
        .filter((entry) => filters.showGenerated || !entry.isGenerated)
        .map((entry) => ({ kind: "file", id: `file:${fileKey(entry)}`, entry, depth: 0 }));
    }
    return flattenTree(tree, openDirs, openGenerated);
  }, [
    filters.flat,
    filters.group,
    filters.showGenerated,
    openDirs,
    openGenerated,
    sortedEntries,
    tree,
  ]);

  const fileRows = useMemo(
    () => rows.filter((row): row is Extract<VisibleRow, { kind: "file" }> => row.kind === "file"),
    [rows],
  );
  const selectedIndex = fileRows.findIndex((row) => fileKey(row.entry) === selectedFilePath);
  const useVirtual = rows.length > 100;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 26,
    overscan: 12,
    enabled: useVirtual,
  });

  const toggleDir = useCallback(
    (path: string) => {
      const isOpen = openDirs.has(path);
      setToggledClosed((prev) => {
        const next = new Set(prev);
        if (isOpen) next.add(path);
        else next.delete(path);
        return next;
      });
      setToggledOpen((prev) => {
        const next = new Set(prev);
        if (isOpen) next.delete(path);
        else next.add(path);
        return next;
      });
    },
    [openDirs],
  );

  const toggleGenerated = useCallback((path: string) => {
    setOpenGenerated((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const openSelectedInEditor = useCallback(() => {
    if (!selectedFilePath) return;
    void fetch(
      `/api/open-in-editor?path=${encodeURIComponent(selectedFilePath)}&cwd=${encodeURIComponent(session.cwd)}`,
      { method: "POST" },
    );
  }, [selectedFilePath, session.cwd]);

  const moveSelection = useCallback(
    (delta: number) => {
      if (fileRows.length === 0) return;
      const current = selectedIndex >= 0 ? selectedIndex : delta > 0 ? -1 : 0;
      const next = Math.max(0, Math.min(fileRows.length - 1, current + delta));
      setSelectedFilePath(fileKey(fileRows[next].entry));
    },
    [fileRows, selectedIndex, setSelectedFilePath],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(1);
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(-1);
      } else if (event.key === "o") {
        event.preventDefault();
        openSelectedInEditor();
      }
    },
    [moveSelection, openSelectedInEditor],
  );

  const renderRow = (row: VisibleRow) => {
    if (row.kind === "file") {
      const key = fileKey(row.entry);
      return (
        <FileRow
          entry={row.entry}
          depth={row.depth}
          selected={key === selectedFilePath}
          onClick={() => setSelectedFilePath(key)}
        />
      );
    }
    if (row.kind === "generated") {
      return (
        <button
          type="button"
          onClick={() => toggleGenerated(row.dirPath)}
          className="flex h-[26px] w-full items-center gap-1.5 px-3 text-left text-[11px] text-muted-foreground hover:bg-muted/60"
          style={{ paddingLeft: `${12 + row.depth * 12}px` }}
        >
          {row.open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <span className="truncate">📦 {row.entries.length} generated files</span>
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => toggleDir(row.path)}
        className="flex h-[26px] w-full items-center gap-1.5 px-3 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted/60"
        style={{ paddingLeft: `${12 + row.depth * 12}px` }}
      >
        {row.open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span className="truncate">{row.label}</span>
      </button>
    );
  };

  if (rows.length === 0) {
    return (
      <div className="px-3 py-2 text-[11px] text-muted-foreground">
        No files match the current filters.
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      role="tree"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the tree container owns j/k/o shortcuts.
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn("h-full outline-none", useVirtual && "overflow-auto")}
    >
      {useVirtual ? (
        <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            return (
              <div
                key={row.id}
                data-index={item.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${item.start}px)`,
                }}
              >
                {renderRow(row)}
              </div>
            );
          })}
        </div>
      ) : (
        rows.map((row) => <div key={row.id}>{renderRow(row)}</div>)
      )}
    </div>
  );
}
