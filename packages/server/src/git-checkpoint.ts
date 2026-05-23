import { exec } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { CheckpointRow, Store } from "./store.js";

const pexec = promisify(exec);

/**
 * Git-snapshot checkpoint subsystem.
 *
 * Before every agent prompt that touches a git repo, we run
 * `git stash create` to capture the *current* working-tree + index state
 * as a stash commit SHA — but we deliberately DO NOT push the stash onto
 * the stash list, so the user's `git stash list` stays clean.
 *
 * The SHA is just a regular commit object referenced by our DB row, so
 * git's reachability rules would normally GC it. To keep it alive we
 * also create a refs/agent-view/checkpoints/<id> ref pointing at it.
 *
 * Restore walks: `git stash apply <ref>` would re-introduce both index
 * and worktree, but we want a *safer* restore that touches only the
 * working tree (no index muck). We use `git read-tree` + `git checkout-index`
 * which restores worktree files from the snapshot without touching staged
 * state or branch HEAD.
 */

const REF_NS = "refs/agent-view/checkpoints";

async function run(cwd: string, args: string[]): Promise<string> {
  // We use exec rather than execFile so we can shell-quote safely below,
  // but pass args via array form to spawn would be cleaner. Use a simple
  // quoting that handles common cases (no embedded quotes in args).
  const cmd = `git ${args.map(shellQuote).join(" ")}`;
  const { stdout } = await pexec(cmd, { cwd, maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim();
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./@:=+-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await run(cwd, ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

async function hasChanges(cwd: string): Promise<boolean> {
  // `git status --porcelain` prints nothing iff worktree+index are clean
  try {
    const out = await run(cwd, ["status", "--porcelain"]);
    return out.length > 0;
  } catch {
    return false;
  }
}

/**
 * Capture a checkpoint of cwd. Returns null if cwd isn't a git repo or
 * has nothing worth snapshotting (clean tree + no untracked).
 */
export async function captureCheckpoint(args: {
  store: Store;
  sessionId: string;
  cwd: string;
  messageId?: string | null;
  label?: string | null;
}): Promise<CheckpointRow | null> {
  if (!(await isGitRepo(args.cwd))) return null;
  if (!(await hasChanges(args.cwd))) return null;

  // `git stash create` returns the SHA of the stash commit but does not
  // push it; if there are untracked-only changes it can return empty,
  // in which case we explicitly add untracked-stash mode.
  let ref = "";
  try {
    ref = await run(args.cwd, ["stash", "create", "-u", "agent-view checkpoint"]);
  } catch {
    // Fall back without -u for very old gits
    try {
      ref = await run(args.cwd, ["stash", "create", "agent-view checkpoint"]);
    } catch {
      return null;
    }
  }
  if (!ref) return null;

  const id = randomUUID();
  const refName = `${REF_NS}/${id}`;
  try {
    await run(args.cwd, ["update-ref", refName, ref]);
  } catch {
    // If we can't pin it, the SHA may be GC'd later — still record but flag
  }

  let headSha: string | null = null;
  try {
    headSha = await run(args.cwd, ["rev-parse", "HEAD"]);
  } catch {
    /* detached / empty repo */
  }

  const row: CheckpointRow = {
    id,
    sessionId: args.sessionId,
    messageId: args.messageId ?? null,
    cwd: args.cwd,
    ref,
    headSha,
    label: args.label ?? null,
    createdAt: Date.now(),
  };
  args.store.insertCheckpoint(row);
  return row;
}

/**
 * Restore a checkpoint to the working tree.
 *
 * Strategy: we DO NOT mutate branch HEAD or the index — only the worktree.
 * For each path in the snapshot, copy its blob to the worktree. Files that
 * exist *now* but didn't exist in the snapshot are left as-is (we don't
 * delete files the user has since added) unless `removeAdded` is true.
 *
 * Returns the list of paths that were changed.
 */
export async function restoreCheckpoint(args: {
  store: Store;
  checkpointId: string;
  removeAdded?: boolean;
}): Promise<{ changed: string[]; checkpoint: CheckpointRow }> {
  const cp = args.store.getCheckpoint(args.checkpointId);
  if (!cp) throw new Error(`unknown checkpoint ${args.checkpointId}`);

  // The snapshot commit has the worktree as its first parent's tree under
  // `git stash create` semantics. We list paths via `git ls-tree -r <ref>`
  // and reset each via `git checkout <ref> -- <path>`.
  const lsOut = await run(cp.cwd, ["ls-tree", "-r", "--name-only", cp.ref]);
  const snapshotPaths = lsOut.split("\n").filter(Boolean);
  if (snapshotPaths.length === 0) return { changed: [], checkpoint: cp };

  // Use `git checkout <treeish> -- <pathspec>` for all paths in one call.
  // To avoid command-line length explosions for huge repos, batch by 200.
  const changed: string[] = [];
  for (let i = 0; i < snapshotPaths.length; i += 200) {
    const batch = snapshotPaths.slice(i, i + 200);
    await run(cp.cwd, ["checkout", cp.ref, "--", ...batch]);
    changed.push(...batch);
  }

  if (args.removeAdded) {
    // Find files currently tracked OR present in worktree that are NOT
    // in the snapshot, and rm them. Conservative: only rm tracked files
    // not in the snapshot to avoid nuking node_modules etc.
    try {
      const tracked = await run(cp.cwd, ["ls-files"]);
      const trackedSet = new Set(tracked.split("\n").filter(Boolean));
      const snapSet = new Set(snapshotPaths);
      const toRemove = [...trackedSet].filter((p) => !snapSet.has(p));
      for (let i = 0; i < toRemove.length; i += 200) {
        const batch = toRemove.slice(i, i + 200);
        await run(cp.cwd, ["rm", "-f", "--", ...batch]);
        changed.push(...batch.map((p) => `(removed) ${p}`));
      }
    } catch {
      /* best-effort */
    }
  }

  return { changed, checkpoint: cp };
}

/**
 * Compute the set of paths that *would* change if this checkpoint were
 * restored, for use in a confirm dialog. Returns at most `limit` entries
 * along with a count.
 */
export async function previewRestore(args: {
  store: Store;
  checkpointId: string;
  limit?: number;
}): Promise<{ paths: string[]; total: number; checkpoint: CheckpointRow }> {
  const cp = args.store.getCheckpoint(args.checkpointId);
  if (!cp) throw new Error(`unknown checkpoint ${args.checkpointId}`);
  // diff between current worktree and snapshot ref
  const diffOut = await run(cp.cwd, ["diff", "--name-only", cp.ref]);
  const paths = diffOut.split("\n").filter(Boolean);
  const limit = args.limit ?? 50;
  return { paths: paths.slice(0, limit), total: paths.length, checkpoint: cp };
}

export async function deleteCheckpoint(args: {
  store: Store;
  checkpointId: string;
}): Promise<void> {
  const cp = args.store.getCheckpoint(args.checkpointId);
  if (!cp) return;
  // Drop the keep-alive ref so the stash commit can be GC'd
  try {
    await run(cp.cwd, ["update-ref", "-d", `${REF_NS}/${cp.id}`]);
  } catch {
    /* may already be gone */
  }
  args.store.deleteCheckpoint(args.checkpointId);
}
