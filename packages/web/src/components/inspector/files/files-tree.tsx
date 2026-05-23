import type { FileEntry } from "@agent-view/shared";
import type { SessionState } from "../../../stores/ui-store";

// Owner: files-web-tree-virt agent (L3). Do not implement here.
interface FilesTreeProps {
  entries: FileEntry[];
  session: SessionState;
  onSelect?: (path: string) => void;
}

export function FilesTree(props: FilesTreeProps) {
  void props;
  return <div className="px-3 py-2 text-[11px] text-muted-foreground">Loading tree…</div>;
}
