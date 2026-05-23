import type { GitStatus } from "@agent-view/shared";

// Owner: files-web-git-bar agent (L3). Do not implement here.
interface GitBarProps {
  cwd: string;
  status?: GitStatus;
}

export function GitBar(props: GitBarProps) {
  void props;
  return <div className="px-3 py-2 text-[11px] text-muted-foreground">Loading git status…</div>;
}
