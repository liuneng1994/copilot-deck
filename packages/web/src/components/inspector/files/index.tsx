import { GitBranch, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import type { SessionState, ToolCallState } from "../../../stores/ui-store";
import { useUIStore } from "../../../stores/ui-store";
import { CodeBrowser } from "./code-browser";
import { ContextPanel } from "./context-panel";
import { FilePreview } from "./file-preview";
import { FilesToolbar } from "./files-toolbar";
import { FilesTree } from "./files-tree";
import { GitBar } from "./git-bar";
import { GrepPanel } from "./grep-panel";
import { InlineDiff } from "./inline-diff";
import { SymbolsBrowser } from "./symbols-browser";
import { TestsPanel } from "./tests-panel";
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
  const maximized = useUIStore((s) => s.filePreviewMaximized);
  const setMaximized = useUIStore((s) => s.setFilePreviewMaximized);

  const hasCwd = session.cwd.trim().length > 0;

  useEffect(() => {
    if (!hasCwd) return;
    void loadFilesOverview(session.cwd);
  }, [session.cwd, hasCwd, loadFilesOverview]);

  useEffect(() => {
    if (!externalPath) return;
    setSelectedFilePath(externalPath);
    setExternalPath(null);
  }, [externalPath, setExternalPath, setSelectedFilePath]);

  // ESC closes the maximized overlay.
  useEffect(() => {
    if (!maximized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMaximized(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximized, setMaximized]);

  // Auto-exit fullscreen when no file is selected.
  useEffect(() => {
    if (!selectedFilePath && maximized) setMaximized(false);
  }, [selectedFilePath, maximized, setMaximized]);

  const selectedChangedFile = useMemo(() => {
    if (!selectedFilePath) return false;
    return (overview?.touched ?? []).some(
      (entry) => entry.path === selectedFilePath || entry.rel === selectedFilePath,
    );
  }, [overview?.touched, selectedFilePath]);

  const detail = selectedFilePath ? (
    <>
      {selectedChangedFile ? <InlineDiff path={selectedFilePath} session={session} /> : null}
      <FilePreview
        path={selectedFilePath}
        cwd={session.cwd}
        onRequestMaximize={() => setMaximized(true)}
      />
    </>
  ) : null;

  const agentTouchedSet = useMemo(
    () => new Set(overview?.agentTouched ?? []),
    [overview?.agentTouched],
  );
  const isNonRepo = overview?.gitStatus?.isRepo === false;

  return (
    <div className="flex h-full flex-col">
      <GitBar cwd={session.cwd} status={overview?.gitStatus} />
      <FilesToolbar cwd={session.cwd} />
      <div className="flex-1 overflow-auto">
        {viewMode === "search" ? (
          <GrepPanel cwd={session.cwd} />
        ) : viewMode === "timeline" ? (
          <TimelinePanel session={session} toolCalls={toolCalls} />
        ) : viewMode === "code" ? (
          <CodeBrowser cwd={session.cwd} />
        ) : viewMode === "symbols" ? (
          <SymbolsBrowser cwd={session.cwd} />
        ) : viewMode === "tests" ? (
          <TestsPanel cwd={session.cwd} />
        ) : viewMode === "context" ? (
          <ContextPanel />
        ) : !hasCwd ? (
          <MissingCwdState />
        ) : isNonRepo ? (
          <NonRepoEmptyState />
        ) : (
          <FilesTree
            entries={overview?.touched ?? []}
            agentTouched={agentTouchedSet}
            session={session}
          />
        )}
      </div>
      {selectedFilePath && !maximized && (
        <div className="max-h-[60vh] overflow-auto border-t border-border">{detail}</div>
      )}
      {selectedFilePath && maximized && (
        <div
          // biome-ignore lint/a11y/useSemanticElements: native <dialog> requires imperative API; using role=dialog for compat
          role="dialog"
          aria-modal="true"
          aria-label={`Preview ${selectedFilePath}`}
          className="fixed inset-0 z-50 flex items-stretch justify-center bg-background/90 p-4 backdrop-blur-sm"
        >
          <div className="flex w-full max-w-[1400px] flex-col overflow-hidden rounded-lg border border-border bg-panel shadow-2xl">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-[12px]">
              <span className="truncate font-mono text-foreground" title={selectedFilePath}>
                {selectedFilePath}
              </span>
              <button
                type="button"
                onClick={() => setMaximized(false)}
                className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Close fullscreen preview"
                title="Close (Esc)"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col overflow-auto">
              {selectedChangedFile ? (
                <InlineDiff path={selectedFilePath} session={session} />
              ) : null}
              <FilePreview path={selectedFilePath} cwd={session.cwd} hideMaximize />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MissingCwdState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="text-sm font-medium text-foreground">No workspace folder yet</div>
      <div className="max-w-xs text-[11px] text-muted-foreground">
        Create or select a session with a cwd before using Code, Symbols, Tests, or file review.
      </div>
    </div>
  );
}

function NonRepoEmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <GitBranch className="h-8 w-8 text-muted-foreground/60" />
      <div className="text-sm font-medium text-foreground">Not a git repository</div>
      <div className="max-w-xs text-[11px] text-muted-foreground">
        Initialize git in this folder to track changes. Files tab is git-driven and has nothing to
        show until then.
      </div>
    </div>
  );
}
