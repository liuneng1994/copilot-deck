#!/usr/bin/env node
// Dev launcher that fully isolates the developer environment from any
// production copilot-deck install. Hard-coded so contributors don't have to
// remember the port / data-dir matrix.
//
//   • API server: PORT 4010 (default 4000 in production)
//   • Vite dev:   PORT 5174 (default 5173 elsewhere)
//   • Data dir:   ~/.copilot-deck-dev/ (default ~/.copilot-deck/ in prod)
//
// Strips inherited PORT / COPILOT_DECK_* env that Copilot CLI / the global
// install injects, which would otherwise collide with a running prod daemon.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEV_API_PORT = "4010";
export const DEV_WEB_PORT = "5174";
export const DEV_DATA_DIR = path.join(homedir(), ".copilot-deck-dev");

export function startDev({ envOverrides = {}, unsetEnv = [], bannerLines = [] } = {}) {
  const env = { ...process.env };
  // Drop any inherited values that leak from a global copilot-deck install
  // or from the Copilot CLI host process.
  for (const key of [
    "PORT",
    "COPILOT_DECK_STATIC_DIR",
    "COPILOT_DECK_VERSION",
    "COPILOT_DECK_DISABLE_UPDATE_CHECK",
    "AGENT_VIEW_DB",
  ]) {
    delete env[key];
  }
  for (const key of unsetEnv) delete env[key];
  env.PORT = DEV_API_PORT;
  env.AGENT_VIEW_SERVER_PORT = DEV_API_PORT;
  env.COPILOT_DECK_HOME = DEV_DATA_DIR;
  env.VITE_DEV_PORT = DEV_WEB_PORT;
  env.AGENT_VIEW_WEB_PORT = DEV_WEB_PORT;
  Object.assign(env, envOverrides);

  console.log(`[dev] api  http://localhost:${env.PORT}`);
  console.log(`[dev] web  http://localhost:${env.AGENT_VIEW_WEB_PORT}`);
  console.log(`[dev] data ${env.COPILOT_DECK_HOME}`);
  for (const line of bannerLines) console.log(line);

  const args = ["-r", "--parallel", "--filter=!copilot-deck", "run", "dev"];
  const globalPnpm = process.env.APPDATA
    ? path.join(process.env.APPDATA, "npm", "node_modules", "pnpm", "bin", "pnpm.cjs")
    : "";
  const pnpmExecPath =
    process.env.npm_execpath ?? (globalPnpm && existsSync(globalPnpm) ? globalPnpm : undefined);
  const command = pnpmExecPath ? process.execPath : "pnpm";
  const commandArgs = pnpmExecPath ? [pnpmExecPath, ...args] : args;

  const child = spawn(command, commandArgs, { cwd: repoRoot, env, stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => child.kill(sig));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startDev();
}
