// Owner: files-web-grep agent (L3). Do not implement here.
interface GrepPanelProps {
  cwd: string;
}

export function GrepPanel(props: GrepPanelProps) {
  void props;
  return <div className="px-3 py-2 text-[11px] text-muted-foreground">Loading search…</div>;
}
