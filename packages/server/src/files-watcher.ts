import { promises as fs } from "node:fs";
import path from "node:path";
import type { GitStatus, ServerToClient } from "@agent-view/shared";
import chokidar, { type FSWatcher } from "chokidar";
import { runGit } from "./git/index.js";
import { parseGitStatus as parseStatusV2 } from "./git/parse-status.js";
import type { SessionManager } from "./session-manager.js";

interface CwdWatch {
  workWatcher: FSWatcher;
  gitWatcher: FSWatcher;
  refCount: number;
  realCwd: string;
}

interface Deps {
  manager: SessionManager;
  broadcast: (msg: ServerToClient) => void;
}

const IGNORED = [
  /(^|\/)\.git\//,
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.next\//,
  /(^|\/)\.turbo\//,
  /(^|\/)target\//,
  /(^|\/)coverage\//,
  /(^|\/)\.agent-view\//,
];

export function startFilesWatcher(deps: Deps): () => void {
  const watches = new Map<string, CwdWatch>();
  const debounce = new Map<string, NodeJS.Timeout>();
  const gitDebounce = new Map<string, NodeJS.Timeout>();
  let closed = false;

  async function countSessionsAt(realCwd: string): Promise<number> {
    const sessionCwds = await Promise.all(
      deps.manager.list().map(async (session) => {
        try {
          return await fs.realpath(session.cwd);
        } catch {
          return undefined;
        }
      }),
    );
    return sessionCwds.filter((cwd) => cwd === realCwd).length;
  }

  async function reconcile() {
    if (closed) return;

    const wantCwds = new Set<string>();
    for (const session of deps.manager.list()) {
      try {
        wantCwds.add(await fs.realpath(session.cwd));
      } catch {
        // Skip sessions whose cwd disappeared.
      }
    }

    for (const realCwd of wantCwds) {
      const existing = watches.get(realCwd);
      if (existing) {
        existing.refCount = await countSessionsAt(realCwd);
        continue;
      }

      const workWatcher = chokidar.watch(realCwd, {
        ignored: IGNORED,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
        persistent: true,
      });

      const onChange = (changedPath: string) => {
        if (!debounce.has(realCwd)) {
          debounce.set(
            realCwd,
            setTimeout(() => {
              debounce.delete(realCwd);
              console.info(`[files-watcher] broadcasting files_index_invalidated ${realCwd}`);
              deps.broadcast({ type: "files_index_invalidated", cwd: realCwd });
            }, 500),
          );
        }
        console.info(`[files-watcher] broadcasting file_changed ${realCwd} ${changedPath}`);
        deps.broadcast({ type: "file_changed", cwd: realCwd, path: changedPath });
      };
      workWatcher.on("add", onChange).on("change", onChange).on("unlink", onChange);
      workWatcher.on("error", (error) => {
        console.warn(`[files-watcher] work watcher error for ${realCwd}`, error);
      });

      const gitDir = path.join(realCwd, ".git");
      const gitWatcher = chokidar.watch(
        [path.join(gitDir, "index"), path.join(gitDir, "HEAD"), path.join(gitDir, "refs", "heads")],
        {
          ignoreInitial: true,
          awaitWriteFinish: { stabilityThreshold: 100 },
          persistent: true,
        },
      );

      const onGit = () => {
        if (gitDebounce.has(realCwd)) return;
        gitDebounce.set(
          realCwd,
          setTimeout(async () => {
            gitDebounce.delete(realCwd);
            try {
              const payload = await fetchGitStatus(realCwd);
              console.info(`[files-watcher] broadcasting git_status ${realCwd}`);
              deps.broadcast({ type: "git_status", cwd: realCwd, payload });
            } catch (error) {
              console.warn(`[files-watcher] git status failed for ${realCwd}`, error);
            }
          }, 300),
        );
      };
      gitWatcher.on("add", onGit).on("change", onGit).on("unlink", onGit);
      gitWatcher.on("error", (error) => {
        console.warn(`[files-watcher] git watcher error for ${realCwd}`, error);
      });

      watches.set(realCwd, {
        workWatcher,
        gitWatcher,
        refCount: await countSessionsAt(realCwd),
        realCwd,
      });
    }

    for (const [realCwd, watch] of watches) {
      if (!wantCwds.has(realCwd)) {
        const pending = debounce.get(realCwd);
        if (pending) clearTimeout(pending);
        debounce.delete(realCwd);
        const pendingGit = gitDebounce.get(realCwd);
        if (pendingGit) clearTimeout(pendingGit);
        gitDebounce.delete(realCwd);
        await watch.workWatcher.close();
        await watch.gitWatcher.close();
        watches.delete(realCwd);
      }
    }
  }

  void reconcile();
  const tick = setInterval(() => void reconcile(), 3_000);
  tick.unref?.();

  return () => {
    closed = true;
    clearInterval(tick);
    for (const timer of debounce.values()) clearTimeout(timer);
    for (const timer of gitDebounce.values()) clearTimeout(timer);
    debounce.clear();
    gitDebounce.clear();
    for (const watch of watches.values()) {
      void watch.workWatcher.close();
      void watch.gitWatcher.close();
    }
    watches.clear();
  };
}

async function fetchGitStatus(cwd: string): Promise<GitStatus> {
  const result = await runGit(cwd, ["status", "--porcelain=v2", "--branch", "-z"]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || `git status exited ${result.exitCode}`);
  }
  return parseStatusV2(result.stdout, cwd);
}
