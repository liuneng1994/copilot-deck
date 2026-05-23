import { ShieldAlert } from "lucide-react";
import type { PermissionOption } from "@agent-view/shared";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { sendWs } from "../../lib/ws-client";
import { useUIStore } from "../../stores/ui-store";

function variantFor(kind: PermissionOption["kind"]) {
  if (kind === "allow_always") return "default" as const;
  if (kind === "allow_once") return "secondary" as const;
  if (kind === "reject_always") return "destructive" as const;
  return "outline" as const;
}

function outcomeFor(kind: PermissionOption["kind"]) {
  if (kind === "allow_always") return "allowed_always" as const;
  if (kind === "allow_once") return "allowed_once" as const;
  return "denied" as const;
}

export function PermissionDialog() {
  const queue = useUIStore((s) => s.permissionQueue);
  const dismiss = useUIStore((s) => s.dismissPermission);
  const setStatus = useUIStore((s) => s.setSessionStatus);
  const current = queue[0];

  if (!current) return null;

  const reply = (opt: PermissionOption) => {
    sendWs({
      type: "permission_reply",
      requestId: current.requestId,
      outcome: outcomeFor(opt.kind),
      optionId: opt.optionId,
    });
    dismiss(current.requestId);
    setStatus(current.sessionId, "streaming");
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          const deny = current.options.find(
            (o) => o.kind === "reject_once" || o.kind === "reject_always",
          );
          if (deny) reply(deny);
        }
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-warning" />
            Permission needed
          </DialogTitle>
          <DialogDescription>
            The agent wants to run a tool that requires your approval.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-md border border-border bg-panel p-3 text-xs">
          <div className="flex items-baseline gap-2">
            <span className="text-muted-foreground">Tool</span>
            <span className="font-mono text-foreground">
              {current.toolCall.kind ?? current.toolCall.title ?? "(unknown)"}
            </span>
          </div>
          {current.toolCall.title && current.toolCall.title !== current.toolCall.kind && (
            <div className="flex items-baseline gap-2">
              <span className="text-muted-foreground">Title</span>
              <span className="font-mono text-foreground">{current.toolCall.title}</span>
            </div>
          )}
          {current.toolCall.rawInput != null && (
            <details>
              <summary className="cursor-pointer text-muted-foreground">Input</summary>
              <pre className="mt-1 max-h-60 overflow-auto rounded bg-background p-2 font-mono text-[11px] text-foreground">
                {safeJson(current.toolCall.rawInput)}
              </pre>
            </details>
          )}
        </div>

        {queue.length > 1 && (
          <p className="text-[10px] text-muted-foreground">
            +{queue.length - 1} more queued
          </p>
        )}

        <DialogFooter>
          {current.options.map((opt) => (
            <Button
              key={opt.optionId}
              variant={variantFor(opt.kind)}
              size="sm"
              onClick={() => reply(opt)}
            >
              {opt.label}
            </Button>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function safeJson(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
