import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  type WriteStream,
  createWriteStream,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import type { AgentTaskKind, BgTaskSnapshot, BgTaskStatus } from "@agent-view/shared";

const MAX_TAIL_BYTES = 64 * 1024;
const MAX_TASKS = 200;
const REAP_DELAY_MS = 60 * 60 * 1000; // auto-remove exited tasks after 1 hour
const LOG_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface PendingWaiter {
  resolve: (exit: { exitCode: number | null; signal: string | null }) => void;
}

interface TaskEntry {
  snapshot: BgTaskSnapshot;
  child?: ChildProcess;
  logStream?: WriteStream;
  /** Waiters from ACP `waitForTerminalExit`. */
  exitWaiters: PendingWaiter[];
  /** Synthesized exit-status when user moved to background; reported via
   *  `terminalOutput` and `waitForTerminalExit`. */
  syntheticExit?: { exitCode: number | null; signal: string | null };
}

export interface ProcessHostEvents {
  update: (task: BgTaskSnapshot) => void;
  output: (taskId: string, chunk: string, stream: "stdout" | "stderr") => void;
  removed: (taskId: string) => void;
}

export interface ProcessHostOptions {
  /** Absolute path to data dir; logs go in `<dataDir>/terminals/`. */
  dataDir?: string;
}

/**
 * ProcessHost owns every shell child process deck spawns — both user-started
 * `bg_task_start` requests and Copilot-spawned ACP terminals. A single
 * registry, single event stream, single on-disk log directory.
 *
 * Originally `BgTaskManager`. Renamed when ACP terminal support landed; see
 * `docs/plans/2026-05-25-copilot-bg-tasks-and-fleet-design.md`.
 */
export class ProcessHost extends EventEmitter {
  private tasks = new Map<string, TaskEntry>();
  /** Reverse map: ACP terminalId → internal processId. */
  private byAcpTerminalId = new Map<string, string>();
  private logDir?: string;

  constructor(opts: ProcessHostOptions = {}) {
    super();
    if (opts.dataDir) {
      this.logDir = path.join(opts.dataDir, "terminals");
      try {
        mkdirSync(this.logDir, { recursive: true });
        this.cleanupOldLogs();
      } catch (e) {
        process.stderr.write(
          `[process-host] log dir init failed: ${e instanceof Error ? e.message : String(e)}\n`,
        );
        this.logDir = undefined;
      }
    }
  }

  private cleanupOldLogs(): void {
    if (!this.logDir) return;
    const now = Date.now();
    try {
      const entries = readdirSync(this.logDir);
      const files: { p: string; mtime: number }[] = [];
      for (const name of entries) {
        const p = path.join(this.logDir, name);
        try {
          const st = statSync(p);
          if (!st.isFile()) continue;
          if (now - st.mtimeMs > LOG_TTL_MS) {
            unlinkSync(p);
            continue;
          }
          files.push({ p, mtime: st.mtimeMs });
        } catch {}
      }
      if (files.length > MAX_TASKS) {
        files.sort((a, b) => a.mtime - b.mtime); // oldest first
        const overflow = files.length - MAX_TASKS;
        for (let i = 0; i < overflow; i++) {
          try {
            unlinkSync(files[i].p);
          } catch {}
        }
      }
    } catch {}
  }

  list(): BgTaskSnapshot[] {
    return [...this.tasks.values()]
      .map((t) => t.snapshot)
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  /** User-initiated background task (existing `bg_task_start` path). */
  start(opts: { cwd: string; command: string; label?: string }): BgTaskSnapshot {
    return this.spawnEntry({
      cwd: opts.cwd,
      command: opts.command,
      label: opts.label,
      origin: "user",
      mode: "background",
    });
  }

  /** Model-requested task that was explicitly approved by the user. */
  startAgentRequest(opts: {
    cwd: string;
    command: string;
    label?: string;
    sessionId: string;
    requestId: string;
    kind: AgentTaskKind;
    reason?: string;
  }): BgTaskSnapshot {
    return this.spawnEntry({
      cwd: opts.cwd,
      command: opts.command,
      label: opts.label,
      origin: "agent-request",
      mode: "background",
      sessionId: opts.sessionId,
      agentTaskRequestId: opts.requestId,
      agentTaskKind: opts.kind,
      agentTaskReason: opts.reason,
    });
  }

  /**
   * ACP `session/new_terminal` — Copilot spawns a shell. Starts as
   * foreground; user may later flip to background via `moveToBackground`.
   * Returns the synthetic `acpTerminalId` (UUID) and the underlying
   * `processId`.
   */
  createAcpTerminal(opts: {
    sessionId: string;
    cwd: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    outputByteLimit?: number;
  }): { processId: string; acpTerminalId: string } {
    const acpTerminalId = randomUUID();
    const displayed =
      opts.args && opts.args.length > 0 ? `${opts.command} ${opts.args.join(" ")}` : opts.command;
    const snap = this.spawnEntry({
      cwd: opts.cwd,
      command: displayed,
      origin: "acp-terminal",
      mode: "foreground",
      sessionId: opts.sessionId,
      acpTerminalId,
      execCommand: opts.command,
      execArgs: opts.args,
      execEnv: opts.env,
    });
    this.byAcpTerminalId.set(acpTerminalId, snap.id);
    return { processId: snap.id, acpTerminalId };
  }

  private spawnEntry(opts: {
    cwd: string;
    command: string;
    label?: string;
    origin: "user" | "acp-terminal" | "agent-request";
    mode: "foreground" | "background";
    sessionId?: string;
    acpTerminalId?: string;
    agentTaskRequestId?: string;
    agentTaskKind?: AgentTaskKind;
    agentTaskReason?: string;
    /** For ACP terminals — explicit command + args (no shell wrapping). */
    execCommand?: string;
    execArgs?: string[];
    execEnv?: Record<string, string>;
  }): BgTaskSnapshot {
    const id = randomUUID();
    const snap: BgTaskSnapshot = {
      id,
      cwd: opts.cwd,
      command: opts.command,
      label: opts.label,
      status: "starting",
      startedAt: Date.now(),
      outputTail: "",
      origin: opts.origin,
      mode: opts.mode,
      sessionId: opts.sessionId,
      acpTerminalId: opts.acpTerminalId,
      agentTaskRequestId: opts.agentTaskRequestId,
      agentTaskKind: opts.agentTaskKind,
      agentTaskReason: opts.agentTaskReason,
    };
    const entry: TaskEntry = { snapshot: snap, exitWaiters: [] };
    this.tasks.set(id, entry);

    if (this.logDir) {
      try {
        const logPath = path.join(this.logDir, `${id}.log`);
        entry.logStream = createWriteStream(logPath, { flags: "w" });
        entry.logStream.on("error", () => {
          entry.logStream = undefined;
        });
      } catch {
        entry.logStream = undefined;
      }
    }

    this.emit("update", { ...snap });

    let child: ChildProcess;
    try {
      if (opts.execCommand !== undefined) {
        child = spawn(opts.execCommand, opts.execArgs ?? [], {
          cwd: opts.cwd,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, ...(opts.execEnv ?? {}), FORCE_COLOR: "0" },
        });
      } else {
        child = spawn(opts.command, {
          cwd: opts.cwd,
          shell: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, FORCE_COLOR: "0" },
        });
      }
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

    const appendOutput = (chunk: string, stream: "stdout" | "stderr") => {
      const tail = entry.snapshot.outputTail + chunk;
      entry.snapshot.outputTail =
        tail.length > MAX_TAIL_BYTES ? tail.slice(tail.length - MAX_TAIL_BYTES) : tail;
      entry.logStream?.write(chunk);
      this.emit("output", id, chunk, stream);
    };

    const handleChunk = (stream: "stdout" | "stderr") => (buf: Buffer) =>
      appendOutput(buf.toString("utf8"), stream);
    child.stdout?.on("data", handleChunk("stdout"));
    child.stderr?.on("data", handleChunk("stderr"));

    child.on("error", (err) => {
      this.setStatus(id, "error", { errorMessage: err.message });
      this.resolveExitWaiters(entry, { exitCode: null, signal: null });
      entry.logStream?.end();
      this.scheduleReap(id);
    });
    child.on("exit", (code, signal) => {
      const status: BgTaskStatus = signal ? "killed" : "exited";
      this.setStatus(id, status, {
        exitedAt: Date.now(),
        exitCode: code,
        signal: signal ?? null,
      });
      this.resolveExitWaiters(entry, { exitCode: code, signal: signal ?? null });
      entry.logStream?.end();
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
      .sort(
        (a, b) =>
          (a.snapshot.exitedAt ?? a.snapshot.startedAt) -
          (b.snapshot.exitedAt ?? b.snapshot.startedAt),
      );
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
    if (entry.snapshot.acpTerminalId) {
      this.byAcpTerminalId.delete(entry.snapshot.acpTerminalId);
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
      entry.logStream?.end();
    }
    this.tasks.clear();
    this.byAcpTerminalId.clear();
  }

  private setStatus(id: string, status: BgTaskStatus, extra?: Partial<BgTaskSnapshot>): void {
    const entry = this.tasks.get(id);
    if (!entry) return;
    entry.snapshot = { ...entry.snapshot, status, ...extra };
    this.emit("update", { ...entry.snapshot });
  }

  // ── ACP terminal interface ────────────────────────────────────────────────

  private resolveAcp(acpTerminalId: string): TaskEntry | undefined {
    const id = this.byAcpTerminalId.get(acpTerminalId);
    if (!id) return undefined;
    return this.tasks.get(id);
  }

  /** ACP `terminal/output`. */
  getOutput(
    acpTerminalId: string,
    outputByteLimit?: number,
  ):
    | {
        output: string;
        truncated: boolean;
        exitStatus?: { exitCode: number | null; signal: string | null };
      }
    | undefined {
    const entry = this.resolveAcp(acpTerminalId);
    if (!entry) return undefined;
    const limit = outputByteLimit ?? MAX_TAIL_BYTES;
    const tail = entry.snapshot.outputTail;
    const truncated = tail.length > limit;
    const output = truncated ? tail.slice(tail.length - limit) : tail;
    const exit = this.computeExitStatus(entry);
    return { output, truncated, exitStatus: exit };
  }

  /** ACP `terminal/wait_for_exit`. Resolves on real exit OR on
   *  `moveToBackground` (synthesized clean exit). */
  waitForExit(
    acpTerminalId: string,
  ): Promise<{ exitCode: number | null; signal: string | null }> | undefined {
    const entry = this.resolveAcp(acpTerminalId);
    if (!entry) return undefined;
    const immediate = this.computeExitStatus(entry);
    if (immediate) return Promise.resolve(immediate);
    return new Promise((resolve) => {
      entry.exitWaiters.push({ resolve });
    });
  }

  /** ACP `terminal/release`. Foreground → kill + drop; background → drop ACP mapping only. */
  releaseAcpTerminal(acpTerminalId: string): boolean {
    const entry = this.resolveAcp(acpTerminalId);
    if (!entry) return false;
    if (entry.snapshot.mode === "foreground") {
      this.remove(entry.snapshot.id);
    } else {
      this.byAcpTerminalId.delete(acpTerminalId);
    }
    return true;
  }

  /** ACP `terminal/kill`. Sends SIGTERM but keeps the terminal id valid. */
  killAcpTerminal(acpTerminalId: string): boolean {
    const entry = this.resolveAcp(acpTerminalId);
    if (!entry?.child) return false;
    if (entry.snapshot.status !== "running" && entry.snapshot.status !== "starting") return false;
    try {
      entry.child.kill("SIGTERM");
      return true;
    } catch {
      return false;
    }
  }

  /** User pressed "Move to background" on a foreground ACP terminal. */
  moveToBackground(processId: string): boolean {
    const entry = this.tasks.get(processId);
    if (!entry) return false;
    if (entry.snapshot.origin !== "acp-terminal") return false;
    if (entry.snapshot.mode !== "foreground") return false;
    entry.snapshot = { ...entry.snapshot, mode: "background" };
    entry.syntheticExit = { exitCode: 0, signal: null };
    const note = `\n[deck] Moved to background as task ${entry.snapshot.id.slice(0, 8)}. Process continues; output is captured in the Tasks tab.\n`;
    const tail = entry.snapshot.outputTail + note;
    entry.snapshot.outputTail =
      tail.length > MAX_TAIL_BYTES ? tail.slice(tail.length - MAX_TAIL_BYTES) : tail;
    entry.logStream?.write(note);
    this.emit("output", entry.snapshot.id, note, "stdout");
    this.emit("update", { ...entry.snapshot });
    this.resolveExitWaiters(entry, entry.syntheticExit);
    return true;
  }

  private resolveExitWaiters(
    entry: TaskEntry,
    exit: { exitCode: number | null; signal: string | null },
  ): void {
    const waiters = entry.exitWaiters.splice(0);
    for (const w of waiters) {
      try {
        w.resolve(exit);
      } catch {}
    }
  }

  private computeExitStatus(
    entry: TaskEntry,
  ): { exitCode: number | null; signal: string | null } | undefined {
    if (entry.syntheticExit) return entry.syntheticExit;
    if (entry.snapshot.status === "exited" || entry.snapshot.status === "killed") {
      return {
        exitCode: entry.snapshot.exitCode ?? null,
        signal: entry.snapshot.signal ?? null,
      };
    }
    if (entry.snapshot.status === "error") {
      return { exitCode: null, signal: null };
    }
    return undefined;
  }
}

// Back-compat alias so existing imports keep working until callers migrate.
export { ProcessHost as BgTaskManager };
