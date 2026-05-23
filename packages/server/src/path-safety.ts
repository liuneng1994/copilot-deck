import { promises as fs } from "node:fs";
import path from "node:path";
import type { SessionManager } from "./session-manager.js";

export class PathSafetyError extends Error {
  constructor(public reason: string) {
    super(reason);
    this.name = "PathSafetyError";
  }
}

/** Assert target is inside cwd (after realpath on both), and cwd is a known session cwd. */
export async function assertWithinCwd(
  target: string,
  cwd: string,
  manager: SessionManager,
): Promise<{ realTarget: string; realCwd: string }> {
  if (!path.isAbsolute(target)) throw new PathSafetyError("target must be absolute");
  if (!path.isAbsolute(cwd)) throw new PathSafetyError("cwd must be absolute");
  if (target.includes("\0") || cwd.includes("\0")) throw new PathSafetyError("NUL in path");

  const knownCwds = new Set<string>();
  for (const s of manager.list()) knownCwds.add(s.cwd);
  for (const s of manager.hydrate()) knownCwds.add(s.cwd);
  if (!knownCwds.has(cwd)) throw new PathSafetyError("cwd not in active session list");

  const realCwd = await fs.realpath(cwd);
  let realTarget: string;
  try {
    realTarget = await fs.realpath(target);
  } catch {
    const parent = await fs.realpath(path.dirname(target)).catch(() => path.dirname(target));
    realTarget = path.join(parent, path.basename(target));
  }
  const cwdWithSep = realCwd.endsWith(path.sep) ? realCwd : realCwd + path.sep;
  if (realTarget !== realCwd && !realTarget.startsWith(cwdWithSep)) {
    throw new PathSafetyError(`path escapes cwd: ${target} not under ${cwd}`);
  }
  return { realTarget, realCwd };
}
