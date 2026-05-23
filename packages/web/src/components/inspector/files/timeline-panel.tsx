import type { SessionState, ToolCallState } from "../../../stores/ui-store";

// Owner: files-web-timeline agent (L3). Do not implement here.
interface TimelinePanelProps {
  session: SessionState;
  toolCalls: Record<string, ToolCallState>;
}

export function TimelinePanel(props: TimelinePanelProps) {
  void props;
  return <div className="px-3 py-2 text-[11px] text-muted-foreground">Loading timeline…</div>;
}
