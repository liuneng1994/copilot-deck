import type { PermissionOption, PermissionToolCallSnapshot } from "@agent-view/shared";
import { Check, Eye, FileCode2, Globe, ShieldAlert, Terminal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { sendWs } from "../../lib/ws-client";
import { useUIStore } from "../../stores/ui-store";
import { DiffView } from "../conversation/diff-view";
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

type ToolFamily = "shell" | "write" | "edit" | "read" | "fetch" | "other";

interface ParsedTool {
  family: ToolFamily;
  command?: string;
  cwd?: string;
  path?: string;
  url?: string;
  newContent?: string;
  oldContent?: string;
}

const TOOL_FAMILY_LABEL: Record<ToolFamily, string> = {
  shell: "Shell command",
  write: "Write file",
  edit: "Edit file",
  read: "Read file",
  fetch: "Network fetch",
  other: "Tool call",
};

/** Best-effort classification of an ACP tool call from kind + rawInput keys. */
function parseTool(snap: PermissionToolCallSnapshot): ParsedTool {
  const kind = (snap.kind ?? "").toLowerCase();
  const raw = (snap.rawInput ?? {}) as Record<string, unknown>;
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = raw[k];
      if (typeof v === "string" && v.length > 0) return v;
    }
    return undefined;
  };

  if (/(execute|exec|shell|bash|terminal|run)/.test(kind) || typeof raw.command === "string") {
    return {
      family: "shell",
      command: get("command", "cmd", "script"),
      cwd: get("cwd", "workingDir", "working_dir"),
    };
  }

  if (/(fetch|http|web|url|search)/.test(kind) || typeof raw.url === "string") {
    return { family: "fetch", url: get("url", "uri") };
  }

  // Write / Edit detection: ACP write tools often expose either {path, content}
  // or {path, oldContent, newContent} (edit). Some agents call write "create".
  const path = get("path", "file_path", "filePath", "filename");
  const newContent = get("content", "new_content", "newContent", "text");
  const oldContent = get("old_content", "oldContent", "old", "previous");

  if (/(edit|patch|replace|modify)/.test(kind) || (path && oldContent !== undefined)) {
    return { family: "edit", path, newContent, oldContent };
  }
  if (/(write|create|save)/.test(kind) || (path && newContent !== undefined)) {
    return { family: "write", path, newContent };
  }
  if (
    /(read|view|open)/.test(kind) ||
    (path && newContent === undefined && oldContent === undefined)
  ) {
    return { family: "read", path };
  }
  return { family: "other" };
}

function FamilyIcon({ family }: { family: ToolFamily }) {
  const Icon =
    family === "shell"
      ? Terminal
      : family === "fetch"
        ? Globe
        : family === "read"
          ? Eye
          : FileCode2;
  return <Icon className="h-4 w-4 text-warning" />;
}

export function PermissionDialog() {
  const queue = useUIStore((s) => s.permissionQueue);
  const dismiss = useUIStore((s) => s.dismissPermission);
  const setStatus = useUIStore((s) => s.setSessionStatus);
  const current = queue[0];
  const [trustFolder, setTrustFolder] = useState(false);

  const parsed = useMemo<ParsedTool | null>(
    () => (current ? parseTool(current.toolCall) : null),
    [current],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: depend on requestId identity
  useEffect(() => {
    setTrustFolder(false);
  }, [current?.requestId]);

  // Keyboard shortcuts: A = allow once, Shift+A = allow always, D = deny once, Shift+D = deny always.
  // biome-ignore lint/correctness/useExhaustiveDependencies: depend on requestId identity
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const find = (k: PermissionOption["kind"]) => current.options.find((o) => o.kind === k);
      let pick: PermissionOption | undefined;
      if ((e.key === "a" || e.key === "A") && !e.shiftKey) pick = find("allow_once");
      else if ((e.key === "a" || e.key === "A") && e.shiftKey) pick = find("allow_always");
      else if ((e.key === "d" || e.key === "D") && !e.shiftKey) pick = find("reject_once");
      else if ((e.key === "d" || e.key === "D") && e.shiftKey) pick = find("reject_always");
      if (pick) {
        e.preventDefault();
        reply(pick);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current?.requestId]);

  if (!current || !parsed) return null;

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
  const shortcutFor = (kind: PermissionOption["kind"]) => {
    if (kind === "allow_once") return "A";
    if (kind === "allow_always") return "⇧A";
    if (kind === "reject_once") return "D";
    if (kind === "reject_always") return "⇧D";
    return "";
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
      <DialogContent className="max-w-2xl" data-permission-dialog={current.requestId}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-warning" />
            Permission needed
          </DialogTitle>
          <DialogDescription>
            {current.toolCall.title ?? `${TOOL_FAMILY_LABEL[parsed.family]} requires approval.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-md border border-border bg-panel-elevated px-3 py-2 text-xs">
            <FamilyIcon family={parsed.family} />
            <span className="font-medium text-foreground">{TOOL_FAMILY_LABEL[parsed.family]}</span>
            <span className="ml-auto rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {current.toolCall.kind ?? "?"}
            </span>
          </div>

          {parsed.family === "shell" && parsed.command && (
            <div className="rounded-md border border-border bg-background p-3">
              <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                <span>Command</span>
                {parsed.cwd && <span className="font-mono normal-case">in {parsed.cwd}</span>}
              </div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[12px] text-foreground">
                <span className="text-muted-foreground">$ </span>
                {parsed.command}
              </pre>
            </div>
          )}

          {(parsed.family === "write" || parsed.family === "edit") && parsed.path && (
            <div className="space-y-2 rounded-md border border-border bg-background p-3">
              <div className="flex items-center gap-2 text-[11px]">
                <FileCode2 className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-mono text-foreground">{parsed.path}</span>
                <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {parsed.family === "edit" ? "edit" : "create / overwrite"}
                </span>
              </div>
              {parsed.newContent !== undefined && (
                <div className="overflow-hidden rounded border border-border">
                  <DiffView
                    path={parsed.path}
                    oldText={parsed.oldContent ?? ""}
                    newText={parsed.newContent}
                  />
                </div>
              )}
            </div>
          )}

          {parsed.family === "read" && parsed.path && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs">
              <Eye className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-mono text-foreground">{parsed.path}</span>
            </div>
          )}

          {parsed.family === "fetch" && parsed.url && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs">
              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="break-all font-mono text-foreground">{parsed.url}</span>
            </div>
          )}

          {current.toolCall.rawInput != null && (
            <details>
              <summary className="cursor-pointer text-[11px] text-muted-foreground">
                Raw input
              </summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-background p-2 font-mono text-[11px] text-foreground">
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

        <DialogFooter className="flex-wrap gap-1">
          {current.options.map((opt) => {
            const sc = shortcutFor(opt.kind);
            const Icon = opt.kind === "allow_once" || opt.kind === "allow_always" ? Check : X;
            return (
              <Button
                key={opt.optionId}
                variant={variantFor(opt.kind)}
                size="sm"
                onClick={() => reply(opt)}
                className="gap-1.5"
              >
                <Icon className="h-3 w-3" />
                {opt.label}
                {sc && (
                  <kbd className="ml-1 rounded border border-current/30 px-1 text-[9px] opacity-70">
                    {sc}
                  </kbd>
                )}
              </Button>
            );
          })}
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
