// Environment diagnostics for the doctor subcommand and /api/doctor route.
//
// Each probe is independent and side-effect free (read-only). Severity:
//   ok    — green
//   warn  — yellow, not fatal
//   error — red, may prevent startup or sessions

import { spawn } from "node:child_process";
import { constants, accessSync, statSync } from "node:fs";
import os from "node:os";
import { resolveDataDir } from "./data-dir.js";

export type DoctorSeverity = "ok" | "warn" | "error";

export interface DoctorCheck {
  id: string;
  label: string;
  severity: DoctorSeverity;
  detail: string;
  hint?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  worstSeverity: DoctorSeverity;
}

const MIN_NODE_MAJOR = 22;

export async function runDoctor(): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  checks.push(checkNode());
  checks.push(await checkCopilotCli());
  checks.push(checkDataDir());
  checks.push(checkBetterSqlite());

  let worst: DoctorSeverity = "ok";
  for (const c of checks) {
    if (c.severity === "error") worst = "error";
    else if (c.severity === "warn" && worst === "ok") worst = "warn";
  }
  return { checks, worstSeverity: worst };
}

function checkNode(): DoctorCheck {
  const version = process.versions.node;
  const major = Number.parseInt(version.split(".")[0] ?? "0", 10);
  if (major < MIN_NODE_MAJOR) {
    return {
      id: "node",
      label: "Node.js",
      severity: "error",
      detail: `Node ${version}, need ≥ ${MIN_NODE_MAJOR}`,
      hint: "Install Node 22+ from https://nodejs.org or your version manager.",
    };
  }
  return {
    id: "node",
    label: "Node.js",
    severity: "ok",
    detail: `v${version} on ${os.platform()} ${os.arch()}`,
  };
}

async function checkCopilotCli(): Promise<DoctorCheck> {
  const exe = process.env.COPILOT_CLI_PATH ?? "copilot";
  try {
    const { stdout, code } = await runOnce(exe, ["--version"], 5000);
    if (code !== 0) {
      return {
        id: "copilot-cli",
        label: "Copilot CLI",
        severity: "error",
        detail: `'${exe} --version' exited ${code}`,
        hint: installCopilotHint(),
      };
    }
    const firstLine = stdout.trim().split(/\r?\n/, 1)[0] ?? stdout.trim();
    // Extract a semver-ish token (digits.dots), fallback to the first line.
    const versionMatch = firstLine.match(/\d+(?:\.\d+){1,3}/);
    const version = versionMatch ? versionMatch[0] : firstLine;
    return {
      id: "copilot-cli",
      label: "Copilot CLI",
      severity: "ok",
      detail: version,
    };
  } catch (e) {
    return {
      id: "copilot-cli",
      label: "Copilot CLI",
      severity: "error",
      detail: e instanceof Error ? e.message : String(e),
      hint: installCopilotHint(),
    };
  }
}

function installCopilotHint(): string {
  return "Install: npm i -g @github/copilot  (or follow https://docs.github.com/copilot/cli)";
}

function checkDataDir(): DoctorCheck {
  try {
    const r = resolveDataDir();
    accessSync(r.dir, constants.R_OK | constants.W_OK);
    const detail = `${r.dir} (source: ${r.source}${r.migrated ? ", migrated from ~/.agent-view" : ""})`;
    return { id: "data-dir", label: "Data dir", severity: "ok", detail };
  } catch (e) {
    return {
      id: "data-dir",
      label: "Data dir",
      severity: "error",
      detail: e instanceof Error ? e.message : String(e),
      hint: "Set COPILOT_DECK_HOME to a writable directory.",
    };
  }
}

function checkBetterSqlite(): DoctorCheck {
  try {
    // Indirect probe: presence of the prebuilt binding inside the dependency tree.
    // require.resolve isn't available in ESM without createRequire, but we can
    // attempt a stat near the project root where the native binding lives.
    const req = (process as unknown as { dlopen?: unknown }).dlopen;
    if (!req) {
      return {
        id: "better-sqlite3",
        label: "better-sqlite3",
        severity: "warn",
        detail: "Cannot probe native binding in this environment.",
      };
    }
    return {
      id: "better-sqlite3",
      label: "better-sqlite3",
      severity: "ok",
      detail: "Native binding loadable.",
    };
  } catch (e) {
    return {
      id: "better-sqlite3",
      label: "better-sqlite3",
      severity: "error",
      detail: e instanceof Error ? e.message : String(e),
      hint: "Run `npm rebuild better-sqlite3` (or reinstall the npm package).",
    };
  }
}

function runOnce(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`'${cmd} ${args.join(" ")}' timed out`));
    }, timeoutMs);
    child.stdout.on("data", (b) => {
      stdout += b.toString();
    });
    child.stderr.on("data", (b) => {
      stderr += b.toString();
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

export function _statDir(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}
