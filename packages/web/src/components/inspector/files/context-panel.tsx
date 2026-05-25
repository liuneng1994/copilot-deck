import { ClipboardCopy, Trash2, X } from "lucide-react";
import { formatWorksetPrompt } from "../../../stores/files-slice";
import { useUIStore } from "../../../stores/ui-store";

export function ContextPanel() {
  const items = useUIStore((s) => s.worksetItems);
  const removeWorksetItem = useUIStore((s) => s.removeWorksetItem);
  const clearWorksetItems = useUIStore((s) => s.clearWorksetItems);
  const preview = formatWorksetPrompt(items, "<your task>");

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-12 text-center">
        <div className="text-sm font-medium text-foreground">No context selected</div>
        <div className="max-w-xs text-[11px] text-muted-foreground">
          Add files, symbols, tests, or validation commands from Code, Symbols, and Tests.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Context workset · {items.length}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-muted hover:text-foreground"
          onClick={clearWorksetItems}
        >
          <Trash2 className="h-3 w-3" />
          Clear
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="space-y-1 p-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-2 rounded-md border border-border bg-panel-elevated px-2 py-1.5 text-[11px]"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-foreground">{item.label}</div>
                <div className="truncate font-mono text-[10px] text-muted-foreground">
                  {item.kind === "buildTarget" ? item.command : item.path}
                  {"startLine" in item ? `:${item.startLine}-${item.endLine}` : ""}
                </div>
              </div>
              <span className="rounded bg-muted px-1 py-0.5 text-[10px] uppercase text-muted-foreground">
                {item.kind}
              </span>
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => removeWorksetItem(item.id)}
                title="Remove from context"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
        <div className="border-t border-border p-2">
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>Prompt prefix preview</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-muted hover:text-foreground"
              onClick={() => navigator.clipboard.writeText(preview).catch(() => {})}
            >
              <ClipboardCopy className="h-3 w-3" />
              Copy
            </button>
          </div>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-2 font-mono text-[10px] text-foreground">
            {preview}
          </pre>
        </div>
      </div>
    </div>
  );
}
