import { useEffect } from "react";
import type { SessionState, ToolCallState } from "../../../stores/ui-store";
import { useUIStore } from "../../../stores/ui-store";
import { FilePreview } from "./file-preview";
import { FilesToolbar } from "./files-toolbar";
import { FilesTree } from "./files-tree";
import { GitBar } from "./git-bar";
import { GrepPanel } from "./grep-panel";
import { InlineDiff } from "./inline-diff";
import { TimelinePanel } from "./timeline-panel";

interface FilesTabProps {
  session: SessionState;
  toolCalls: Record<string, ToolCallState>;
}

export function FilesTab({ session, toolCalls }: FilesTabProps) {
  const loadFilesOverview = useUIStore((s) => s.loadFilesOverview);
  const overview = useUIStore((s) => s.filesOverview[session.cwd]);
  const selectedFilePath = useUIStore((s) => s.selectedFilePath);
  const setSelectedFilePath = useUIStore((s) => s.setSelectedFilePath);
  const externalPath = useUIStore((s) => s.filePreviewPath);
  const setExternalPath = useUIStore((s) => s.setFilePreviewPath);
  const viewMode = useUIStore((s) => s.filesViewMode);

  useEffect(() => {
    void loadFilesOverview(session.cwd);
  }, [session.cwd, loadFilesOverview]);

  useEffect(() => {
    if (!externalPath) return;
    setSelectedFilePath(externalPath);
    setExternalPath(null);
  }, [externalPath, setExternalPath, setSelectedFilePath]);

  return (
    <div className="flex h-full flex-col">
      <GitBar cwd={session.cwd} status={overview?.gitStatus} />
      <FilesToolbar cwd={session.cwd} />
      <div className="flex-1 overflow-auto">
        {viewMode === "search" ? (
          <GrepPanel cwd={session.cwd} />
        ) : viewMode === "timeline" ? (
          <TimelinePanel session={session} toolCalls={toolCalls} />
        ) : (
          <FilesTree entries={overview?.touched ?? []} session={session} />
        )}
      </div>
      {selectedFilePath && (
        <div className="max-h-[60vh] overflow-auto border-t border-border">
          <InlineDiff path={selectedFilePath} session={session} />
          <FilePreview path={selectedFilePath} cwd={session.cwd} />
        </div>
      )}
    </div>
  );
}
