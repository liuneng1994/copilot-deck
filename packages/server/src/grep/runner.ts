import { spawn } from "node:child_process";
import type { GrepHit } from "@agent-view/shared";

export interface GrepOptions {
  cwd: string;
  q: string;
  globs?: string[];
  caseSensitive?: boolean;
  maxFileMatches?: number;
  max?: number;
  timeoutMs?: number;
}

export interface GrepHandle {
  abort(): void;
}

interface RgMatchEvent {
  type: "match";
  data?: {
    path?: { text?: string };
    lines?: { text?: string };
    line_number?: number;
    submatches?: Array<{
      start?: number;
      end?: number;
      match?: { text?: string };
    }>;
  };
}

const DEFAULT_MAX = 5000;
const DEFAULT_TIMEOUT_MS = 30_000;
const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 100;

function isRgMatchEvent(value: unknown): value is RgMatchEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value as { type?: unknown }).type === "match"
  );
}

/** Spawns `rg --json` and emits parsed hits via onChunk. Calls onDone exactly once. */
export function runGrep(
  opts: GrepOptions,
  onChunk: (hits: GrepHit[]) => void,
  onDone: (info: { total: number; truncated: boolean; error?: string }) => void,
): GrepHandle {
  const args = ["--json", "--max-columns=500"];
  if (!opts.caseSensitive) args.push("-i");
  if (opts.maxFileMatches) args.push("--max-count", String(opts.maxFileMatches));
  for (const g of opts.globs ?? []) args.push("--glob", g);
  args.push("-e", opts.q);

  const max = opts.max ?? DEFAULT_MAX;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const child = spawn("rg", args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });

  let stdoutBuffer = "";
  let stderr = "";
  let total = 0;
  let batch: GrepHit[] = [];
  let done = false;
  let timer: NodeJS.Timeout | undefined;
  let timeout: NodeJS.Timeout | undefined;

  const flush = () => {
    if (batch.length === 0) return;
    const hits = batch;
    batch = [];
    onChunk(hits);
  };

  const clearTimers = () => {
    if (timer) clearInterval(timer);
    if (timeout) clearTimeout(timeout);
    timer = undefined;
    timeout = undefined;
  };

  const finish = (info: { truncated: boolean; error?: string }) => {
    if (done) return;
    done = true;
    clearTimers();
    flush();
    onDone({ total, ...info });
  };

  const truncate = () => {
    child.kill("SIGTERM");
    finish({ truncated: true });
  };

  const addHit = (hit: GrepHit) => {
    if (done) return;
    batch.push(hit);
    total += 1;
    if (batch.length >= BATCH_SIZE) flush();
    if (total >= max) truncate();
  };

  const parseLine = (line: string) => {
    if (done || line.length === 0) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRgMatchEvent(parsed)) return;

    const data = parsed.data;
    const filePath = data?.path?.text;
    const text = data?.lines?.text;
    const lineNumber = data?.line_number;
    const submatches = data?.submatches;
    if (
      typeof filePath !== "string" ||
      typeof text !== "string" ||
      typeof lineNumber !== "number" ||
      !Array.isArray(submatches)
    ) {
      return;
    }

    for (const submatch of submatches) {
      if (done) break;
      const start = submatch.start;
      const end = submatch.end;
      const match = submatch.match?.text;
      if (typeof start !== "number" || typeof end !== "number" || typeof match !== "string") {
        continue;
      }
      addHit({
        path: filePath,
        line: lineNumber,
        col: start + 1,
        before: text.slice(0, start),
        match,
        after: text.slice(end),
      });
    }
  };

  const drainStdout = (chunk: Buffer) => {
    stdoutBuffer += chunk.toString("utf8");
    let newline = stdoutBuffer.indexOf("\n");
    while (newline !== -1) {
      const line = stdoutBuffer.slice(0, newline);
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      parseLine(line);
      newline = stdoutBuffer.indexOf("\n");
    }
  };

  timer = setInterval(flush, FLUSH_INTERVAL_MS);
  timeout = setTimeout(() => {
    child.kill("SIGTERM");
    finish({ truncated: false, error: "timeout" });
  }, timeoutMs);

  child.stdout.on("data", drainStdout);
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  child.on("error", (err: NodeJS.ErrnoException) => {
    finish({ truncated: false, error: err.code === "ENOENT" ? "rg not found" : err.message });
  });
  child.on("close", (code) => {
    if (stdoutBuffer.length > 0) parseLine(stdoutBuffer);
    if (done) return;
    const error =
      typeof code === "number" && code > 1 ? stderr.trim() || `rg exited ${code}` : undefined;
    finish({ truncated: false, error });
  });

  return {
    abort: () => {
      child.kill("SIGTERM");
      finish({ truncated: false, error: "aborted" });
    },
  };
}
