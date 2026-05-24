import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import path from "node:path";
import { resolveBundle } from "../lib/bundle.js";
import { openInBrowser } from "../lib/open.js";
import { getPackageInfo } from "../lib/package-info.js";
import { clearPidFile, readLivePidFile, resolveDataDir, writePidFile } from "../lib/pidfile.js";
import { pickPort } from "../lib/port.js";

export interface StartOptions {
  port: number;
  host: string;
  open: boolean;
  updateCheck: boolean;
  detach: boolean;
}

export async function runStart(opts: StartOptions): Promise<void> {
  const pkg = getPackageInfo();
  const bundle = resolveBundle();

  // Refuse to start a second instance behind the same data directory — that
  // would corrupt the SQLite store and confuse update-check polling.
  const existing = readLivePidFile();
  if (existing) {
    process.stderr.write(
      `copilot-deck is already running (pid ${existing.pid}, http://${
        existing.host === "0.0.0.0" ? "localhost" : existing.host
      }:${existing.port}).\nRun \`copilot-deck stop\` first, or use \`copilot-deck status\`.\n`,
    );
    process.exit(1);
  }

  const port = await pickPort(opts.port, opts.host);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    HOST: opts.host,
    COPILOT_DECK_VERSION: pkg.version,
  };
  if (bundle.webDir) env.COPILOT_DECK_STATIC_DIR = bundle.webDir;
  if (!opts.updateCheck) env.COPILOT_DECK_DISABLE_UPDATE_CHECK = "1";

  const url = `http://${opts.host === "0.0.0.0" ? "localhost" : opts.host}:${port}`;

  if (opts.detach) {
    const logPath = path.join(resolveDataDir(), "copilot-deck.log");
    const out = openSync(logPath, "a");
    const err = openSync(logPath, "a");
    const child = spawn(process.execPath, [bundle.serverEntry], {
      env,
      detached: true,
      stdio: ["ignore", out, err],
    });
    if (!child.pid) {
      process.stderr.write("failed to spawn detached server\n");
      process.exit(1);
    }
    writePidFile({
      pid: child.pid,
      port,
      host: opts.host,
      version: pkg.version,
      startedAt: Date.now(),
    });
    child.unref();
    process.stdout.write(
      `\n  copilot-deck v${pkg.version}  →  ${url}  (pid ${child.pid}, logs: ${logPath})\n  stop with: copilot-deck stop\n\n`,
    );
    if (opts.open) void openInBrowser(url);
    return;
  }

  const child = spawn(process.execPath, [bundle.serverEntry], {
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });

  if (child.pid) {
    writePidFile({
      pid: child.pid,
      port,
      host: opts.host,
      version: pkg.version,
      startedAt: Date.now(),
    });
  }

  const cleanup = () => clearPidFile();
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  process.on("exit", cleanup);

  setTimeout(() => {
    process.stdout.write(`\n  copilot-deck v${pkg.version}  →  ${url}\n\n`);
    if (opts.open) void openInBrowser(url);
  }, 800);

  await new Promise<void>((resolve) => {
    child.on("exit", (code, signal) => {
      clearPidFile();
      if (code !== null && code !== 0) {
        process.stderr.write(
          `\n[copilot-deck] server exited with code ${code}${signal ? ` (${signal})` : ""}\n`,
        );
      }
      process.exit(code ?? 0);
      resolve();
    });
  });
}
