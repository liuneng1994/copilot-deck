import { spawn } from "node:child_process";
import { resolveBundle } from "../lib/bundle.js";
import { openInBrowser } from "../lib/open.js";
import { getPackageInfo } from "../lib/package-info.js";
import { pickPort } from "../lib/port.js";

export interface StartOptions {
  port: number;
  host: string;
  open: boolean;
  updateCheck: boolean;
}

export async function runStart(opts: StartOptions): Promise<void> {
  const pkg = getPackageInfo();
  const bundle = resolveBundle();
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

  const child = spawn(process.execPath, [bundle.serverEntry], {
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });

  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));

  setTimeout(() => {
    process.stdout.write(`\n  copilot-deck v${pkg.version}  →  ${url}\n\n`);
    if (opts.open) void openInBrowser(url);
  }, 800);

  await new Promise<void>((resolve) => {
    child.on("exit", (code, signal) => {
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
