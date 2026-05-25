import { Bot, Play, X } from "lucide-react";
import { sendWs } from "../../lib/ws-client";
import { useUIStore } from "../../stores/ui-store";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

export function AgentTaskDialog() {
  const queue = useUIStore((s) => s.agentTaskRequests);
  const resolveLocal = useUIStore((s) => s.resolveAgentTaskRequest);
  const current = queue[0];

  if (!current) return null;

  const reply = (outcome: "allow" | "deny") => {
    sendWs({ type: "agent_task_reply", requestId: current.id, outcome });
    resolveLocal(current.id, outcome);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) reply("deny");
      }}
    >
      <DialogContent className="max-w-2xl" data-agent-task-dialog={current.id}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            Background task requested
          </DialogTitle>
          <DialogDescription>
            The model wants Copilot Deck to run this command in the background. It will only start
            if you allow it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium uppercase tracking-wide text-primary">
              {current.kind}
            </span>
            {current.label ? (
              <span className="font-medium text-foreground">{current.label}</span>
            ) : null}
            <span className="text-muted-foreground">cwd</span>
            <span className="font-mono text-muted-foreground">{current.cwd}</span>
          </div>

          {current.reason ? (
            <div className="rounded-md border border-border bg-panel-elevated px-3 py-2 text-xs text-muted-foreground">
              {current.reason}
            </div>
          ) : null}

          <div className="rounded-md border border-border bg-background p-3">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Command
            </div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[12px] text-foreground">
              <span className="text-muted-foreground">$ </span>
              {current.command}
            </pre>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => reply("deny")}>
            <X className="mr-1 h-3.5 w-3.5" />
            Deny
          </Button>
          <Button type="button" onClick={() => reply("allow")}>
            <Play className="mr-1 h-3.5 w-3.5" />
            Allow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
