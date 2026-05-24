import { Play, Square, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { sendWs } from "../../lib/ws-client";
import { type SessionState, useUIStore } from "../../stores/ui-store";

function statusColor(s: string): string {
  switch (s) {
    case "running":
      return "text-success";
    case "starting":
      return "text-muted-foreground";
    case "exited":
      return "text-foreground";
    case "killed":
      return "text-warning";
    case "error":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

function formatDuration(start: number, end?: number): string {
  const ms = (end ?? Date.now()) - start;
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m${rs}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

export function TasksTab({ session }: { session: SessionState }) {
  const tasks = useUIStore((s) => s.bgTasks);
  const cwdTasks = Object.values(tasks)
    .filter((t) => t.cwd === session.cwd)
    .sort((a, b) => b.startedAt - a.startedAt);

  const [command, setCommand] = useState("");
  const [label, setLabel] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cmd = command.trim();
    if (!cmd) return;
    sendWs({
      type: "bg_task_start",
      cwd: session.cwd,
      command: cmd,
      label: label.trim() || undefined,
    });
    setCommand("");
    setLabel("");
  };

  return (
    <div className="space-y-3 p-2">
      <form
        onSubmit={submit}
        className="space-y-2 rounded-md border border-border bg-panel-elevated p-2"
      >
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Run in background
        </div>
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="npm run dev"
          className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px]"
        />
        <div className="flex gap-1.5">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="label (optional)"
            className="flex-1 rounded border border-border bg-background px-2 py-1 text-[11px]"
          />
          <button
            type="submit"
            disabled={!command.trim()}
            className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Play className="h-3 w-3" />
            Start
          </button>
        </div>
        <div className="font-mono text-[10px] text-muted-foreground">cwd: {session.cwd}</div>
      </form>

      {cwdTasks.length === 0 ? (
        <div className="px-2 py-6 text-center text-xs text-muted-foreground">
          No background tasks yet. Long-running commands started here run independently of the agent
          and survive across prompts.
        </div>
      ) : (
        <div className="space-y-2">
          {cwdTasks.map((t) => (
            <TaskCard key={t.id} taskId={t.id} />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskCard({ taskId }: { taskId: string }) {
  const task = useUIStore((s) => s.bgTasks[taskId]);
  const outRef = useRef<HTMLPreElement>(null);
  const [follow, setFollow] = useState(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on output change
  useEffect(() => {
    if (!follow) return;
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [task?.outputTail, follow]);

  if (!task) return null;

  const stop = () => sendWs({ type: "bg_task_stop", taskId });
  const remove = () => sendWs({ type: "bg_task_remove", taskId });
  const isRunning = task.status === "running" || task.status === "starting";

  return (
    <div className="overflow-hidden rounded-md border border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5 text-[11px]">
        <span className={`h-2 w-2 rounded-full bg-current ${statusColor(task.status)}`} />
        <span className={`font-medium ${statusColor(task.status)}`}>{task.status}</span>
        {task.origin === "acp-terminal" && (
          <span
            className="rounded-sm border border-primary/40 bg-primary/10 px-1 text-[9px] uppercase tracking-wider text-primary"
            title="Spawned by Copilot through the ACP terminal extension"
          >
            from copilot
          </span>
        )}
        {task.label && <span className="text-foreground">{task.label}</span>}
        <span className="ml-auto flex items-center gap-2 text-muted-foreground">
          {task.pid && <span className="font-mono">pid {task.pid}</span>}
          <span>{formatDuration(task.startedAt, task.exitedAt)}</span>
          {typeof task.exitCode === "number" && (
            <span className="font-mono">exit {task.exitCode}</span>
          )}
          {isRunning ? (
            <button
              type="button"
              onClick={stop}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted"
              title="Stop"
            >
              <Square className="h-3 w-3" />
            </button>
          ) : (
            <button
              type="button"
              onClick={remove}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted"
              title="Remove"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </span>
      </div>
      <div className="border-b border-border bg-panel-elevated px-2 py-1 font-mono text-[10px] text-muted-foreground">
        $ {task.command}
      </div>
      {task.errorMessage && (
        <div className="bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
          {task.errorMessage}
        </div>
      )}
      <pre
        ref={outRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 30);
        }}
        className="max-h-64 overflow-auto bg-background p-2 font-mono text-[11px] leading-snug text-foreground"
      >
        {task.outputTail || <span className="text-muted-foreground">(no output yet)</span>}
      </pre>
    </div>
  );
}
