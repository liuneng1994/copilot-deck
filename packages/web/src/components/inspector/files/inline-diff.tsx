import type { SessionState } from "../../../stores/ui-store";

// Owner: files-web-diff agent (L3). Do not implement here.
interface InlineDiffProps {
  path: string;
  session: SessionState;
}

export function InlineDiff(props: InlineDiffProps) {
  void props;
  return <div className="px-3 py-2 text-[11px] text-muted-foreground">Loading diff…</div>;
}
