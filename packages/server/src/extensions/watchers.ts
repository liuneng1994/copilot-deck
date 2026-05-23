import { homedir } from "node:os";
import path from "node:path";
import type { ServerToClient } from "@agent-view/shared";
import chokidar, { type FSWatcher } from "chokidar";
import type { SessionManager } from "../session-manager.js";

interface Deps {
  manager: SessionManager;
  broadcast: (msg: ServerToClient) => void;
  invalidate?: {
    plugins?: () => void;
    marketplaces?: () => void;
    mcpUser?: () => void;
    mcpWorkspace?: (cwd: string) => void;
    skillsRepo?: (cwd: string) => void;
    skillsGlobal?: () => void;
  };
}

type BroadcastMessage = Extract<ServerToClient, { type: "extensions_list" }>;
type Debounced = () => void;

const WATCHER_OPTIONS = { persistent: true, ignoreInitial: true } as const;
const DEBOUNCE_MS = 500;

function debounce(fn: () => void): Debounced {
  let timer: NodeJS.Timeout | undefined;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn();
    }, DEBOUNCE_MS);
  };
}

function normalizeCwds(manager: SessionManager): Set<string> {
  return new Set(manager.list().map((session) => path.resolve(session.cwd)));
}

function watch(paths: string | string[], onChange: Debounced): FSWatcher {
  const watcher = chokidar.watch(paths, WATCHER_OPTIONS);
  watcher.on("all", (_event, changedPath) => {
    console.info(`[extension-watchers] change detected: ${changedPath}`);
    onChange();
  });
  watcher.on("error", (error) => {
    console.warn("[extension-watchers] watcher error", error);
  });
  return watcher;
}

function broadcast(deps: Deps, msg: BroadcastMessage): void {
  console.info(
    `[extension-watchers] broadcasting ${msg.kind}${msg.scope ? `:${msg.scope}` : ""}${msg.cwd ? ` ${msg.cwd}` : ""}`,
  );
  deps.broadcast(msg);
}

export function startExtensionWatchers(deps: Deps): { close: () => Promise<void> } {
  const watchers = new Set<FSWatcher>();
  const workspaceWatchers = new Map<string, FSWatcher>();
  let closed = false;

  const copilotDir = path.join(homedir(), ".copilot");
  const agentsDir = path.join(homedir(), ".agents");

  watchers.add(
    watch(
      path.join(copilotDir, "mcp-config.json"),
      debounce(() => {
        deps.invalidate?.mcpUser?.();
        broadcast(deps, { type: "extensions_list", kind: "mcp", scope: "user", items: [] });
      }),
    ),
  );

  watchers.add(
    watch(
      path.join(copilotDir, "pkg"),
      debounce(() => {
        deps.invalidate?.plugins?.();
        deps.invalidate?.marketplaces?.();
        broadcast(deps, { type: "extensions_list", kind: "plugins", items: [] });
      }),
    ),
  );

  watchers.add(
    watch(
      path.join(agentsDir, "skills"),
      debounce(() => {
        deps.invalidate?.skillsGlobal?.();
        broadcast(deps, { type: "extensions_list", kind: "skills", scope: "global", items: [] });
      }),
    ),
  );

  const addWorkspaceWatcher = (cwd: string) => {
    const normalized = path.resolve(cwd);
    if (workspaceWatchers.has(normalized)) return;

    const onWorkspaceMcp = debounce(() => {
      deps.invalidate?.mcpWorkspace?.(normalized);
      broadcast(deps, {
        type: "extensions_list",
        kind: "mcp",
        scope: "workspace",
        cwd: normalized,
        items: [],
      });
    });
    const onWorkspaceSkills = debounce(() => {
      deps.invalidate?.skillsRepo?.(normalized);
      broadcast(deps, {
        type: "extensions_list",
        kind: "skills",
        scope: "workspace",
        cwd: normalized,
        items: [],
      });
    });

    const watcher = chokidar.watch(
      [
        path.join(normalized, ".mcp.json"),
        path.join(normalized, ".agents", "skills"),
        path.join(normalized, "skills-lock.json"),
      ],
      WATCHER_OPTIONS,
    );
    watcher.on("all", (_event, changedPath) => {
      console.info(`[extension-watchers] workspace change detected: ${changedPath}`);
      const resolved = path.resolve(changedPath);
      if (resolved === path.join(normalized, ".mcp.json")) onWorkspaceMcp();
      else onWorkspaceSkills();
    });
    watcher.on("error", (error) => {
      console.warn(`[extension-watchers] watcher error for ${normalized}`, error);
    });
    workspaceWatchers.set(normalized, watcher);
  };

  const reconcileWorkspaceWatchers = () => {
    if (closed) return;
    const cwds = normalizeCwds(deps.manager);
    for (const cwd of cwds) addWorkspaceWatcher(cwd);
    for (const [cwd, watcher] of workspaceWatchers) {
      if (!cwds.has(cwd)) {
        workspaceWatchers.delete(cwd);
        void watcher.close();
      }
    }
  };

  reconcileWorkspaceWatchers();
  const interval = setInterval(reconcileWorkspaceWatchers, 5_000);
  interval.unref?.();

  return {
    close: async () => {
      closed = true;
      clearInterval(interval);
      await Promise.all([
        ...[...watchers].map((watcher) => watcher.close()),
        ...[...workspaceWatchers.values()].map((watcher) => watcher.close()),
      ]);
      watchers.clear();
      workspaceWatchers.clear();
    },
  };
}
