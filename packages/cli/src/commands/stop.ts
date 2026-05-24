import { setTimeout as delay } from "node:timers/promises";
import { clearPidFile, isAlive, isCopilotDeckProcess, readPidFile } from "../lib/pidfile.js";

export interface StopOptions {
  force: boolean;
  timeoutMs: number;
}

export async function runStop(opts: StopOptions): Promise<void> {
  const rec = readPidFile();
  if (!rec) {
    process.stdout.write("copilot-deck is not running (no pid file).\n");
    return;
  }
  if (!isAlive(rec.pid)) {
    clearPidFile();
    process.stdout.write(`stale pid file removed (pid ${rec.pid} is gone).\n`);
    return;
  }
  if (!isCopilotDeckProcess(rec.pid)) {
    clearPidFile();
    process.stdout.write(
      `stale pid file removed (pid ${rec.pid} was recycled by an unrelated process).\n`,
    );
    return;
  }

  const signal: NodeJS.Signals = opts.force ? "SIGKILL" : "SIGTERM";
  try {
    process.kill(rec.pid, signal);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ESRCH") {
      clearPidFile();
      process.stdout.write("process already gone.\n");
      return;
    }
    process.stderr.write(`failed to signal pid ${rec.pid}: ${err.message}\n`);
    process.exit(1);
  }

  // Wait for the process to actually exit (up to timeoutMs) before declaring
  // success — otherwise the user can't immediately re-bind the port.
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(rec.pid)) {
      clearPidFile();
      process.stdout.write(
        `stopped copilot-deck (pid ${rec.pid}, was on http://${
          rec.host === "0.0.0.0" ? "localhost" : rec.host
        }:${rec.port}).\n`,
      );
      return;
    }
    await delay(150);
  }

  if (!opts.force) {
    process.stderr.write(
      `pid ${rec.pid} did not exit within ${opts.timeoutMs}ms after SIGTERM. Retry with --force to send SIGKILL.\n`,
    );
    process.exit(1);
  }
  process.stderr.write(`pid ${rec.pid} did not exit even after SIGKILL.\n`);
  process.exit(1);
}
