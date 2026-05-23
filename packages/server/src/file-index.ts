import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".vite",
  ".next",
  ".turbo",
  "target",
  ".dev-logs",
  ".playwright-cli",
  ".cache",
  "coverage",
]);

const MAX_FILES_PER_INDEX = 20000;

function runFilesCommand(command: string, args: string[], cwd: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      buf += c;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} exited ${code}`));
        return;
      }
      resolve(buf.split("\n").filter(Boolean).slice(0, MAX_FILES_PER_INDEX));
    });
  });
}

function rgFiles(cwd: string): Promise<string[]> {
  return runFilesCommand(
    "rg",
    ["--files", "--hidden", "--no-ignore-vcs=false", "--glob", "!.git/**"],
    cwd,
  );
}

function gitLsFiles(cwd: string): Promise<string[]> {
  return runFilesCommand("git", ["ls-files", "--cached", "--others", "--exclude-standard"], cwd);
}

async function walkFs(cwd: string): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [""];
  while (stack.length > 0) {
    const rel = stack.pop()!;
    const abs = path.join(cwd, rel);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") && (e.name === ".git" || IGNORE_DIRS.has(e.name))) {
        continue;
      }
      if (IGNORE_DIRS.has(e.name)) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        stack.push(r);
      } else if (e.isFile()) {
        out.push(r);
        if (out.length >= MAX_FILES_PER_INDEX) return out;
      }
    }
  }
  return out;
}

async function loadIndex(cwd: string): Promise<string[]> {
  try {
    return await rgFiles(cwd);
  } catch {
    // fall back to git, then fs walk
  }
  try {
    return await gitLsFiles(cwd);
  } catch {
    return walkFs(cwd);
  }
}

/**
 * Lightweight subsequence fuzzy scoring inspired by fzf:
 *   - all query chars must appear in order in the path
 *   - score rewards: matches near path separators, consecutive matches,
 *     matches in the basename, shorter overall path.
 */
function fuzzyScore(filePath: string, query: string): number | null {
  if (query.length === 0) return 0;
  const lp = filePath.toLowerCase();
  const lq = query.toLowerCase();
  let pi = 0;
  let score = 0;
  let prevMatchIdx = -2;
  for (let qi = 0; qi < lq.length; qi++) {
    const ch = lq[qi];
    const idx = lp.indexOf(ch, pi);
    if (idx < 0) return null;
    if (
      idx === 0 ||
      lp[idx - 1] === "/" ||
      lp[idx - 1] === "." ||
      lp[idx - 1] === "-" ||
      lp[idx - 1] === "_"
    ) {
      score += 10;
    }
    if (idx === prevMatchIdx + 1) score += 5;
    score += 1;
    prevMatchIdx = idx;
    pi = idx + 1;
  }
  const slash = lp.lastIndexOf("/");
  const base = lp.slice(slash + 1);
  if (base.includes(lq)) score += 20;
  score -= Math.floor(filePath.length / 40);
  return score;
}

export async function listFiles(opts: {
  cwd: string;
  query: string;
  limit: number;
}): Promise<string[]> {
  const files = await loadIndex(opts.cwd);
  if (!opts.query) {
    return files.slice(0, opts.limit);
  }
  const scored: { path: string; score: number }[] = [];
  for (const f of files) {
    const s = fuzzyScore(f, opts.query);
    if (s !== null) scored.push({ path: f, score: s });
  }
  scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
  return scored.slice(0, opts.limit).map((r) => r.path);
}

export function invalidateIndex(_cwd: string) {}
