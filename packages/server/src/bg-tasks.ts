import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { BgTaskSnapshot, BgTaskStatus } from "@agent-view/shared";

const MAX_TAIL_BYTES = 64 * 1024;

interface TaskEntry {
  snapshot: BgTaskSnapshot;
  child?: ChildProcess;
}

export interface BgTaskEvents {
  update: (task: BgTaskSnapshot) => void;
  output: (taskId: string, chunk: string, stream: "stdout" | "stderr") => void;
  removed: (taskId: string) => void;
}

export class BgTaskManager extends EventEmitter {
  private tasks = new Map<string, TaskEntry>();

  list(): BgTaskSnapshot[] {
    return [...this.tasks.values()]
      .map((t) => t.snapshot)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  start(opts: { cwd: string; command: string; label?: string }): BgTaskSnapshot {
    const id = randomUUID();
    const snap: BgTaskSnapshot = {
      id,
      cwd: opts.cwd,
      command: opts.command,
      label: opts.label,
      status: "starting",
      startedAt: Date.now(),
      outputTail: "",
    };
    const entry: TaskEntry = { snapshot: snap };
    this.tasks.set(id, entry);
    this.emit("update", { ...snap });

    let child: ChildProcess;
    try {
      child = spawn(opts.command, {
        cwd: opts.cwd,
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, FORCE_COLOR: "0" },
      });
    } catch (err) {
      this.setStatus(id, "error", { errorMessage: (err as Error).message });
      return entry.snapshot;
    }
    entry.child = child;

    const updatePid = () => {
      entry.snapshot.pid = child.pid;
      entry.snapshot.status = "running";
      this.emit("update", { ...entry.snapshot });
    };
    if (child.pid) updatePid();
    else child.once("spawn", updatePid);

    const handleChunk = (stream: "stdout" | "stderr") => (buf: Buffer) => {
      const chunk = buf.toString("utf8");
      const tail = entry.snapshot.outputTail + chunk;
      entry.snapshot.outputTail =
        tail.length > MAX_TAIL_BYTES ? tail.slice(tail.length - MAX_TAIL_BYTES) : tail;
      this.emit("output", id, chunk, stream);
    };
    child.stdout?.on("data", handleChunk("stdout"));
    child.stderr?.on("data", handleChunk("stderr"));

    child.on("error", (err) => {
      this.setStatus(id, "error", { errorMessage: err.message });
    });
    child.on("exit", (code, signal) => {
      const status: BgTaskStatus = signal ? "killed" : "exited";
      this.setStatus(id, status, {
        exitedAt: Date.now(),
        exitCode: code,
        signal: signal ?? null,
      });
    });

    return entry.snapshot;
  }

  stop(taskId: string): boolean {
    const entry = this.tasks.get(taskId);
    if (!entry?.child || entry.snapshot.status !== "running") return false;
    try {
      entry.child.kill("SIGTERM");
      setTimeout(() => {
        if (entry.child && entry.snapshot.status === "running") {
          try {
            entry.child.kill("SIGKILL");
          } catch {}
        }
      }, 3000);
      return true;
    } catch {
      return false;
    }
  }

  remove(taskId: string): boolean {
    const entry = this.tasks.get(taskId);
    if (!entry) return false;
    if (entry.snapshot.status === "running") {
      this.stop(taskId);
    }
    this.tasks.delete(taskId);
    this.emit("removed", taskId);
    return true;
  }

  shutdown(): void {
    for (const [, entry] of this.tasks) {
      if (entry.child && entry.snapshot.status === "running") {
        try {
          entry.child.kill("SIGTERM");
        } catch {}
      }
    }
  }

  private setStatus(
    id: string,
    status: BgTaskStatus,
    extra?: Partial<BgTaskSnapshot>,
  ): void {
    const entry = this.tasks.get(id);
    if (!entry) return;
    entry.snapshot = { ...entry.snapshot, status, ...extra };
    this.emit("update", { ...entry.snapshot });
  }
}
