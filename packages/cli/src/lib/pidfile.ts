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

/** Read the PID file but drop it (and return null) if the recorded process is gone. */
export function readLivePidFile(): PidRecord | null {
  const rec = readPidFile();
  if (!rec) return null;
  if (!isAlive(rec.pid)) {
    clearPidFile();
    return null;
  }
  return rec;
}
