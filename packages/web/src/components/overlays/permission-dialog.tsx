import type { PermissionOption } from "@agent-view/shared";
import { ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
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
  const [trustFolder, setTrustFolder] = useState(false);

  // Reset the trust-folder toggle whenever the queue head changes so an
  // earlier dialog's choice doesn't leak into the next request.
  // biome-ignore lint/correctness/useExhaustiveDependencies: depend on requestId identity
  useEffect(() => {
    setTrustFolder(false);
  }, [current?.requestId]);

  if (!current) return null;

  const reply = (opt: PermissionOption) => {
    sendWs({
      type: "permission_reply",
      requestId: current.requestId,
      outcome: outcomeFor(opt.kind),
      optionId: opt.optionId,
      ...(trustFolder && opt.kind === "allow_always" ? { trustFolder: true } : {}),
    });
    dismiss(current.requestId);
    setStatus(current.sessionId, "streaming");
  };

  const hasAllowAlways = current.options.some((o) => o.kind === "allow_always");

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
      <DialogContent className="max-w-xl" data-permission-dialog={current.requestId}>
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
          <p className="text-[10px] text-muted-foreground">+{queue.length - 1} more queued</p>
        )}

        {hasAllowAlways && (
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-panel px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
            <input
              type="checkbox"
              checked={trustFolder}
              onChange={(e) => setTrustFolder(e.target.checked)}
              className="h-3.5 w-3.5 accent-primary"
            />
            <span>
              Trust <span className="font-mono text-foreground">all tools</span> in this folder
              (applies the "Always" choice as a wildcard)
            </span>
          </label>
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
