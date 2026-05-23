import { execFile, spawn } from "node:child_process";
import type { ChildProcess, ExecException, ExecFileOptions } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  input?: string;
  allowNonZero?: boolean;
}

export interface CliRunError extends Error {
  result: RunResult;
}

type ExecFilePromise = Promise<{ stdout: string | Buffer; stderr: string | Buffer }> & {
  child?: ChildProcess;
};

function commandEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...env,
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  };
}

function toText(value: string | Buffer | undefined): string {
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return value ?? "";
}

function exitCodeFrom(error: ExecException): number {
  return typeof error.code === "number" ? error.code : 1;
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function notFoundResult(binary: string): RunResult {
  return {
    stdout: "",
    stderr: `${binary} CLI not found on PATH`,
    exitCode: 127,
  };
}

function throwRunError(message: string, result: RunResult): never {
  const error = new Error(message) as CliRunError;
  error.result = result;
  throw error;
}

async function runCommand(
  binary: string,
  args: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  const promise = execFileP(binary, args, {
    cwd: opts.cwd,
    env: commandEnv(opts.env),
    timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER_BYTES,
    encoding: "utf8",
  } satisfies ExecFileOptions) as ExecFilePromise;

  if (opts.input !== undefined) {
    promise.child?.stdin?.end(opts.input);
  }

  try {
    const { stdout, stderr } = await promise;
    return { stdout: toText(stdout), stderr: toText(stderr), exitCode: 0 };
  } catch (error) {
    if (isEnoent(error)) return notFoundResult(binary);

    const execError = error as ExecException & {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
    };
    const result: RunResult = {
      stdout: toText(execError.stdout),
      stderr: toText(execError.stderr),
      exitCode: exitCodeFrom(execError),
    };

    if (opts.allowNonZero) return result;
    throwRunError(execError.message, result);
  }
}

/**
 * Run a copilot subcommand and capture full output. Throws on non-zero
 * exit unless `allowNonZero` is set, in which case the caller inspects
 * `exitCode`.
 */
export async function runCopilot(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return runCommand("copilot", args, opts);
}

/**
 * Same but for `npx <cmd>` (used for `npx skills`).
 */
export async function runNpx(
  cmd: string,
  args: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  return runCommand("npx", [cmd, ...args], opts);
}

export type StreamLineHandler = (chunk: { stream: "stdout" | "stderr"; line: string }) => void;

export interface StreamResult {
  exitCode: number;
}

function createLineBuffer(stream: "stdout" | "stderr", onLine: StreamLineHandler) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";

  const emitCompleteLines = (text: string) => {
    buffer += text;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      onLine({ stream, line: line.endsWith("\r") ? line.slice(0, -1) : line });
    }
  };

  return {
    write(chunk: Buffer) {
      emitCompleteLines(decoder.write(chunk));
    },
    end() {
      const remaining = decoder.end();
      if (remaining) emitCompleteLines(remaining);
      if (buffer) {
        onLine({ stream, line: buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer });
        buffer = "";
      }
    },
  };
}

function streamCommand(
  binary: string,
  args: string[],
  onLine: StreamLineHandler,
  opts: RunOptions = {},
): { abort: () => void; done: Promise<StreamResult> } {
  const child = spawn(binary, args, {
    cwd: opts.cwd,
    env: commandEnv(opts.env),
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (opts.input !== undefined) child.stdin.end(opts.input);
  else child.stdin.end();

  const stdout = createLineBuffer("stdout", onLine);
  const stderr = createLineBuffer("stderr", onLine);

  child.stdout.on("data", (chunk: Buffer) => stdout.write(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.write(chunk));

  let settled = false;
  const done = new Promise<StreamResult>((resolve) => {
    const finish = (exitCode: number) => {
      if (settled) return;
      settled = true;
      stdout.end();
      stderr.end();
      resolve({ exitCode });
    };

    child.on("error", (error) => {
      if (isEnoent(error)) {
        onLine({ stream: "stderr", line: `${binary} CLI not found on PATH` });
        finish(127);
        return;
      }
      onLine({ stream: "stderr", line: error.message });
      finish(1);
    });

    child.on("close", (code) => finish(code ?? 1));
  });

  return {
    abort: () => {
      if (!settled) child.kill();
    },
    done,
  };
}

/**
 * Stream a long-running CLI invocation (install / uninstall / update),
 * calling onLine for each newline-terminated line. Resolves when the
 * process exits.
 */
export function streamCopilot(
  args: string[],
  onLine: StreamLineHandler,
  opts: RunOptions = {},
): { abort: () => void; done: Promise<StreamResult> } {
  return streamCommand("copilot", args, onLine, opts);
}

export function streamNpx(
  cmd: string,
  args: string[],
  onLine: StreamLineHandler,
  opts: RunOptions = {},
): { abort: () => void; done: Promise<StreamResult> } {
  return streamCommand("npx", [cmd, ...args], onLine, opts);
}
