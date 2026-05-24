import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface PidRecord {
  pid: number;
  port: number;
  host: string;
  version: string;
  startedAt: number;
}

export function resolveDataDir(): string {
  return process.env.COPILOT_DECK_HOME ?? path.join(homedir(), ".copilot-deck");
}

function pidFilePath(): string {
  return path.join(resolveDataDir(), "copilot-deck.pid");
}

export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    // EPERM means a process exists but we can't signal it — treat as alive.
    return err.code === "EPERM";
  }
}

/**
 * Best-effort check that `pid` is actually a copilot-deck server process and
 * not some unrelated process that recycled the PID after an abnormal exit.
 *
 * Returns true if we cannot determine (e.g. /proc unavailable and `ps`
 * missing) so we never falsely declare the user's running deck as stale —
 * the caller should treat a true return as "probably deck".
 */
export function isCopilotDeckProcess(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  // Linux: read /proc/<pid>/cmdline (NUL-separated argv).
  try {
    const cmdlinePath = `/proc/${pid}/cmdline`;
    if (existsSync(cmdlinePath)) {
      const raw = readFileSync(cmdlinePath, "utf8");
      // argv null-separated; replace NUL with space for matching.
      const cmd = raw.replace(/\0/g, " ");
      return /copilot-deck|@agent-view\/server|packages\/server\/dist\/main\.js|dist-bundle\/server\/main\.js/.test(
        cmd,
      );
    }
  } catch {
    // fall through
  }

  // macOS / fallback: shell out to `ps -p <pid> -o command=`.
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (out && out.trim().length > 0) {
      return /copilot-deck|@agent-view\/server|packages\/server\/dist\/main\.js|dist-bundle\/server\/main\.js/.test(
        out,
      );
    }
    return false;
  } catch {
    // `ps` not available or process gone — treat as "probably deck" so we
    // don't silently drop a live pidfile on platforms we can't introspect.
    return true;
  }
}

export function readPidFile(): PidRecord | null {
  const file = pidFilePath();
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, "utf8");
    const rec = JSON.parse(raw) as PidRecord;
    if (typeof rec.pid !== "number") return null;
    return rec;
  } catch {
    return null;
  }
}

export function writePidFile(rec: PidRecord): void {
  const dir = resolveDataDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(pidFilePath(), `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600 });
}

export function clearPidFile(): void {
  const file = pidFilePath();
  if (existsSync(file)) {
    try {
      rmSync(file);
    } catch {
      // best-effort
    }
  }
}

/**
 * Read the PID file but drop it (and return null) if the recorded process is
 * gone OR the PID has been recycled by some unrelated process.
 */
export function readLivePidFile(): PidRecord | null {
  const rec = readPidFile();
  if (!rec) return null;
  if (!isAlive(rec.pid) || !isCopilotDeckProcess(rec.pid)) {
    clearPidFile();
    return null;
  }
  return rec;
}
