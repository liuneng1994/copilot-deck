import type { FileEntry } from "@agent-view/shared";

// Owner: files-web-git-bar agent (L3). Do not implement here.
interface FileActionsProps {
  entry?: FileEntry;
  path?: string;
  cwd: string;
}

export function FileActions(props: FileActionsProps) {
  void props;
  return <div className="px-3 py-2 text-[11px] text-muted-foreground">Loading actions…</div>;
}
