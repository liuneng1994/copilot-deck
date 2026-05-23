// Owner: files-web-preview agent (L3). Do not implement here.
interface FilePreviewProps {
  path: string;
  cwd: string;
}

export function FilePreview(props: FilePreviewProps) {
  void props;
  return <div className="px-3 py-2 text-[11px] text-muted-foreground">Loading preview…</div>;
}
