import { readLivePidFile } from "../lib/pidfile.js";

export async function runStatus(): Promise<void> {
  const rec = readLivePidFile();
  if (!rec) {
    process.stdout.write("copilot-deck is not running.\n");
    process.exit(1);
  }
  const url = `http://${rec.host === "0.0.0.0" ? "localhost" : rec.host}:${rec.port}`;
  const uptimeMs = Date.now() - rec.startedAt;
  const s = Math.floor(uptimeMs / 1000);
  const uptime =
    s >= 3600
      ? `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`
      : s >= 60
        ? `${Math.floor(s / 60)}m${s % 60}s`
        : `${s}s`;
  process.stdout.write(
    `copilot-deck v${rec.version} running\n  pid:    ${rec.pid}\n  url:    ${url}\n  uptime: ${uptime}\n`,
  );
}
