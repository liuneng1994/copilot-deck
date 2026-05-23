import { Pin, PinOff, X } from "lucide-react";
import { cn } from "../../lib/cn";
import {
  type Artifact,
  selectSessionArtifacts,
  useArtifactStore,
} from "../../stores/artifact-store";

/**
 * Right-side split pane that hosts hoisted artifacts (tables, diagrams, JSON,
 * long code, HTML previews, …). v1 is a placeholder shell: tabs + a generic
 * body that just dumps the source. Type-specific bodies arrive in rr-artifact-pane.
 */
export function ArtifactPane({ sessionId, width }: { sessionId: string; width: number }) {
  const items = useArtifactStore((s) => selectSessionArtifacts(s, sessionId));
  const activeId = useArtifactStore((s) => s.activeBySession[sessionId]);
  const focus = useArtifactStore((s) => s.focus);
  const closePane = useArtifactStore((s) => s.closePane);
  const remove = useArtifactStore((s) => s.remove);
  const togglePin = useArtifactStore((s) => s.togglePin);
  const active = items.find((a) => a.id === activeId) ?? items[items.length - 1];

  if (items.length === 0) return null;

  return (
    <aside
      data-testid="artifact-pane"
      className="flex h-full min-w-0 shrink-0 flex-col border-l border-border bg-panel"
      style={{ width }}
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
          onClick={() => closePane(sessionId)}
          title="Close artifact pane"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {active ? <PlaceholderBody artifact={active} /> : null}
      </div>
    </aside>
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
        className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-rose-500/10 hover:text-rose-300 group-hover/tab:opacity-100"
        title="Close"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function PlaceholderBody({ artifact }: { artifact: Artifact }) {
  const it = artifact.item;
  const preview =
    it.kind === "code" || it.kind === "mermaid" || it.kind === "html" || it.kind === "svg"
      ? it.kind === "code"
        ? it.text
        : it.src
      : it.kind === "json"
        ? it.raw
        : it.kind === "table" || it.kind === "csv"
          ? `${it.header.join(" | ")}\n${it.rows
              .slice(0, 10)
              .map((r) => r.join(" | "))
              .join("\n")}`
          : JSON.stringify(it, null, 2);
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
      {preview}
    </pre>
  );
}
