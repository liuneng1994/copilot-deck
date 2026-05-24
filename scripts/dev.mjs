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
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEV_API_PORT = "4010";
const DEV_WEB_PORT = "5174";
const DEV_DATA_DIR = path.join(process.env.HOME ?? "/root", ".copilot-deck-dev");

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
env.PORT = DEV_API_PORT;
env.AGENT_VIEW_SERVER_PORT = DEV_API_PORT;
env.COPILOT_DECK_HOME = DEV_DATA_DIR;
env.VITE_DEV_PORT = DEV_WEB_PORT;
env.AGENT_VIEW_WEB_PORT = DEV_WEB_PORT;

console.log(`[dev] api  http://localhost:${DEV_API_PORT}`);
console.log(`[dev] web  http://localhost:${DEV_WEB_PORT}`);
console.log(`[dev] data ${DEV_DATA_DIR}`);

const args = [
  "-r",
  "--parallel",
  "--filter=!copilot-deck",
  "run",
  "dev",
];

const child = spawn("pnpm", args, { cwd: repoRoot, env, stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}
