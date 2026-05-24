import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { BgTaskSnapshot, BgTaskStatus } from "@agent-view/shared";

const MAX_TAIL_BYTES = 64 * 1024;
const MAX_TASKS = 200;
const REAP_DELAY_MS = 60 * 60 * 1000; // auto-remove exited tasks after 1 hour

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
      this.scheduleReap(id);
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
      this.scheduleReap(id);
    });
    child.on("exit", (code, signal) => {
      const status: BgTaskStatus = signal ? "killed" : "exited";
      this.setStatus(id, status, {
        exitedAt: Date.now(),
        exitCode: code,
        signal: signal ?? null,
      });
      this.scheduleReap(id);
    });

    this.evictOverflow();
    return entry.snapshot;
  }

  private scheduleReap(id: string): void {
    setTimeout(() => {
      const entry = this.tasks.get(id);
      if (!entry) return;
      if (entry.snapshot.status === "running" || entry.snapshot.status === "starting") return;
      this.remove(id);
    }, REAP_DELAY_MS).unref?.();
  }

  /** Evict the oldest *finished* tasks when total count exceeds MAX_TASKS. */
  private evictOverflow(): void {
    if (this.tasks.size <= MAX_TASKS) return;
    const finished = [...this.tasks.values()]
      .filter((t) => t.snapshot.status !== "running" && t.snapshot.status !== "starting")
      .sort((a, b) => (a.snapshot.exitedAt ?? a.snapshot.startedAt) - (b.snapshot.exitedAt ?? b.snapshot.startedAt));
    const overflow = this.tasks.size - MAX_TASKS;
    for (let i = 0; i < overflow && i < finished.length; i++) {
      this.remove(finished[i].snapshot.id);
    }
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
    this.tasks.clear();
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
