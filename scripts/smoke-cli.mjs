#!/usr/bin/env node
// End-to-end smoke for the installed bin. Spawns the CLI in start mode against
// an ephemeral data dir + ephemeral port, polls /api/health + /api/version,
// and tears down. Used by `pnpm smoke:cli` in CI.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.resolve(here, "..", "packages", "cli", "bin", "copilot-deck.mjs");
const dataDir = mkdtempSync(path.join(tmpdir(), "copilot-deck-smoke-"));

const child = spawn(
  process.execPath,
  [bin, "start", "--no-open", "--no-update-check", "--port", "0"],
  {
    env: { ...process.env, COPILOT_DECK_HOME: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let port = null;
let stdoutBuf = "";
let stderrBuf = "";

child.stdout.on("data", (b) => {
  stdoutBuf += b.toString();
  const m = stdoutBuf.match(/http:\/\/[^:]+:(\d+)/);
  if (m && !port) port = Number.parseInt(m[1], 10);
});
child.stderr.on("data", (b) => {
  stderrBuf += b.toString();
});

const cleanup = () => {
  try {
    child.kill("SIGTERM");
  } catch {}
  setTimeout(() => {
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {}
  }, 200);
};

const fail = (msg) => {
  console.error(`\n✗ smoke failed: ${msg}`);
  console.error(`--- stdout ---\n${stdoutBuf}`);
  console.error(`--- stderr ---\n${stderrBuf}`);
  cleanup();
  process.exit(1);
};

await new Promise((r) => setTimeout(r, 3500));
if (!port) fail("did not see port in CLI output within 3.5s");

const fetchJson = async (path) => {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
};

const waitForJson = async (path) => {
  const deadline = Date.now() + 20_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await fetchJson(path);
    } catch (e) {
      lastError = e;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError ?? new Error(`${path} did not become available`);
};

try {
  const health = await waitForJson("/api/health");
  if (!health.ok) fail(`/api/health returned ${JSON.stringify(health)}`);

  const version = await waitForJson("/api/version");
  if (!version.installed) fail(`/api/version missing installed: ${JSON.stringify(version)}`);

  const doctor = await waitForJson("/api/doctor");
  if (!Array.isArray(doctor.checks) || doctor.checks.length === 0) {
    fail(`/api/doctor empty: ${JSON.stringify(doctor)}`);
  }

  console.log(
    `✓ smoke ok — port ${port}, version ${version.installed}, ${doctor.checks.length} checks`,
  );
  cleanup();
  setTimeout(() => process.exit(0), 300);
} catch (e) {
  fail(e?.message ?? String(e));
}
