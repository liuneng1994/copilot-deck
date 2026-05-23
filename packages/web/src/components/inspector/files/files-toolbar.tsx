// Owner: files-web-toolbar agent (L3). Do not implement here.
interface FilesToolbarProps {
  cwd: string;
}

export function FilesToolbar(props: FilesToolbarProps) {
  void props;
  return <div className="px-3 py-2 text-[11px] text-muted-foreground">Loading toolbar…</div>;
}
