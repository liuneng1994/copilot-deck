import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pExecFile = promisify(execFile);

export interface RunGitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runGit(
  cwd: string,
  args: string[],
  opts: { timeoutMs?: number; maxBuffer?: number } = {},
): Promise<RunGitResult> {
  try {
    const { stdout, stderr } = await pExecFile("git", args, {
      cwd,
      timeout: opts.timeoutMs ?? 10_000,
      maxBuffer: opts.maxBuffer ?? 10 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (e: any) {
    if (e?.code === "ENOENT") return { stdout: "", stderr: "git not found", exitCode: 127 };
    const code = typeof e?.code === "number" ? e.code : 1;
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? String(e), exitCode: code };
  }
}
