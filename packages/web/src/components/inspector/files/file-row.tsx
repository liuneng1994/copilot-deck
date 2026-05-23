import type { FileEntry } from "@agent-view/shared";

// Owner: files-web-tree-virt agent (L3). Do not implement here.
interface FileRowProps {
  entry: FileEntry;
  selected?: boolean;
  onSelect?: (path: string) => void;
}

export function FileRow(props: FileRowProps) {
  void props;
  return <div className="px-3 py-2 text-[11px] text-muted-foreground">Loading row…</div>;
}
