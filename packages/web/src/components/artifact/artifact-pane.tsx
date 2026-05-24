import { Download, ExternalLink, Maximize2, Minimize2, Pin, PinOff, X } from "lucide-react";
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { cn } from "../../lib/cn";
import { renderContent } from "../../lib/content-renderer/render";
import { CsvChart } from "../../lib/content-renderer/renderers/csv-chart";
import {
  type Artifact,
  selectSessionArtifacts,
  useArtifactStore,
} from "../../stores/artifact-store";
import { useUIStore } from "../../stores/ui-store";

/**
 * Right-side split pane that hosts hoisted artifacts (tables, diagrams, JSON,
 * long code, HTML previews, …).
 *
 * The body delegates to renderContent in "full" mode, which unlocks the
 * interactive features each renderer hides while inline (sort/filter/export
 * for tables, source toggle + larger canvas for mermaid, full-tree JSON, etc).
 */
export function ArtifactPane({ sessionId, width }: { sessionId: string; width: number }) {
  const items = useArtifactStore(useShallow((s) => selectSessionArtifacts(s, sessionId)));
  const activeId = useArtifactStore((s) => s.activeBySession[sessionId]);
  const focus = useArtifactStore((s) => s.focus);
  const closePane = useArtifactStore((s) => s.closePane);
  const remove = useArtifactStore((s) => s.remove);
  const togglePin = useArtifactStore((s) => s.togglePin);
  const setFindOpen = useUIStore((s) => s.setFindOpen);
  const [fullscreen, setFullscreen] = useState(false);
  const active = items.find((a) => a.id === activeId) ?? items[items.length - 1];

  if (items.length === 0) return null;

  return (
    <aside
      data-testid="artifact-pane"
      className={cn(
        "flex h-full min-w-0 shrink-0 flex-col border-l border-border bg-panel",
        fullscreen && "fixed inset-0 z-40 border-l-0",
      )}
      style={fullscreen ? undefined : { width }}
    >
      <header className="flex h-9 min-h-9 items-center gap-1 border-b border-border bg-panel-elevated px-1">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {items.map((a) => (
            <Tab
              key={a.id}
              artifact={a}
              active={a.id === active?.id}
              onSelect={() => focus(sessionId, a.id)}
              onClose={() => remove(sessionId, a.id)}
              onTogglePin={() => togglePin(a.id)}
            />
          ))}
        </div>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => setFullscreen((v) => !v)}
          title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {fullscreen ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => closePane(sessionId)}
          title="Close artifact pane"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {active ? <ArtifactBody artifact={active} /> : null}
      </div>
      {active ? (
        <footer className="flex items-center justify-between border-t border-border bg-panel-elevated px-2 py-1 text-[10px] text-muted-foreground">
          <span className="truncate font-mono">
            from message · {new Date(active.createdAt).toLocaleTimeString()}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFindOpen(true)}
              className="inline-flex items-center gap-1 hover:text-foreground"
              title="Find source message"
            >
              <ExternalLink className="h-3 w-3" />
              source
            </button>
            <DownloadButton artifact={active} />
          </div>
        </footer>
      ) : null}
    </aside>
  );
}

function ArtifactBody({ artifact }: { artifact: Artifact }) {
  const it = artifact.item;
  const canChart = it.kind === "table" || it.kind === "csv";
  const [view, setView] = useState<"data" | "chart">("data");
  const effective = canChart ? view : "data";

  return (
    <div className="artifact-body flex h-full min-h-0 flex-col">
      {canChart ? (
        <div className="mb-2 inline-flex w-fit items-center gap-1 rounded-md border border-border bg-panel p-0.5 text-xs">
          {(["data", "chart"] as const).map((v) => (
            <button
              type="button"
              key={v}
              onClick={() => setView(v)}
              className={cn(
                "rounded px-2 py-0.5 transition-colors",
                effective === v
                  ? "bg-accent/15 text-accent"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v === "data" ? "Table" : "Chart"}
            </button>
          ))}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        {effective === "chart" && (it.kind === "table" || it.kind === "csv") ? (
          <CsvChart header={it.header} rows={it.rows} />
        ) : (
          renderContent({
            item: artifact.item,
            sessionId: artifact.sessionId,
            msgId: artifact.sourceMsgId,
            full: true,
          })
        )}
      </div>
    </div>
  );
}

function DownloadButton({ artifact }: { artifact: Artifact }) {
  const it = artifact.item;
  const onClick = () => {
    let blob: Blob;
    let filename: string;
    switch (it.kind) {
      case "code":
        blob = new Blob([it.text], { type: "text/plain" });
        filename = `artifact-${it.id}.${it.lang ?? "txt"}`;
        break;
      case "table":
      case "csv": {
        const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
        const lines = [it.header.map(esc).join(","), ...it.rows.map((r) => r.map(esc).join(","))];
        blob = new Blob([lines.join("\n")], { type: "text/csv" });
        filename = `artifact-${it.id}.csv`;
        break;
      }
      case "json":
        blob = new Blob([it.raw], { type: "application/json" });
        filename = `artifact-${it.id}.json`;
        break;
      case "mermaid":
        blob = new Blob([it.src], { type: "text/plain" });
        filename = `artifact-${it.id}.mmd`;
        break;
      case "svg":
        blob = new Blob([it.src], { type: "image/svg+xml" });
        filename = `artifact-${it.id}.svg`;
        break;
      case "html":
        blob = new Blob([it.src], { type: "text/html" });
        filename = `artifact-${it.id}.html`;
        break;
      default:
        blob = new Blob([JSON.stringify(it, null, 2)], { type: "application/json" });
        filename = `artifact-${it.id}.json`;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 hover:text-foreground"
      title="Download artifact"
    >
      <Download className="h-3 w-3" />
      download
    </button>
  );
}

function Tab({
  artifact,
  active,
  onSelect,
  onClose,
  onTogglePin,
}: {
  artifact: Artifact;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  onTogglePin: () => void;
}) {
  return (
    <div
      className={cn(
        "group/tab flex max-w-[220px] shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs",
        active
          ? "border-primary/40 bg-primary/10 text-foreground"
          : "border-transparent text-muted-foreground hover:bg-muted",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 truncate font-medium"
        title={artifact.title}
      >
        <span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {artifact.item.kind}
        </span>
        {artifact.title}
      </button>
      <button
        type="button"
        onClick={onTogglePin}
        className="rounded p-0.5 text-muted-foreground opacity-0 hover:text-foreground group-hover/tab:opacity-100"
        title={artifact.pinned ? "Unpin" : "Pin"}
      >
        {artifact.pinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-rose-500/10 hover:text-rose-700 dark:hover:text-rose-300 group-hover/tab:opacity-100"
        title="Close"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
