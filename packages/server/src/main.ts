// agent-view server entry point.
//
// Wires together SessionManager (Copilot ACP orchestrator), REST routes, and
// the WebSocket gateway for real-time session updates.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ClientToServer, ServerToClient } from "@agent-view/shared";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";
import { resolveDataDir } from "./data-dir.js";
import { invalidateMcpUserCache, registerMcpRoutes } from "./extensions/routes-mcp.js";
import {
  invalidateMarketplaceCache,
  invalidatePluginCache,
  registerPluginRoutes,
} from "./extensions/routes-plugins.js";
import { invalidateSkillsCache, registerSkillsRoutes } from "./extensions/routes-skills.js";
import { startExtensionWatchers } from "./extensions/watchers.js";
import { registerFilesOverviewRoutes } from "./files-overview/route.js";
import { startFilesWatcher } from "./files-watcher.js";
import { registerGitRoutes } from "./git/routes.js";
import { registerGrepRoutes } from "./grep/routes.js";
import { registerOutlineRoutes } from "./outline/routes.js";
import { registerRoutes } from "./routes.js";
import { SessionManager } from "./session-manager.js";
import { Store } from "./store.js";
import { BgTaskManager } from "./bg-tasks.js";
import { UpdateChecker } from "./update-check.js";
import { type WsContext, dispatchWs } from "./ws-handlers.js";

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? "127.0.0.1";

function readInstalledVersion(): string {
  // Prefer COPILOT_DECK_VERSION env (set by the CLI bundle), else read the
  // sibling package.json (dev mode, dist mode).
  if (process.env.COPILOT_DECK_VERSION) return process.env.COPILOT_DECK_VERSION;
  const candidates = [
    path.join(process.cwd(), "package.json"),
    path.join(import.meta.dirname ?? __dirname, "..", "package.json"),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const pkg = JSON.parse(readFileSync(p, "utf8")) as { version?: string };
        if (pkg.version) return pkg.version;
      }
    } catch {}
  }
  return "0.0.0";
}

async function main() {
  const app = Fastify({ logger: { level: "info" } });
  await app.register(fastifyWebsocket, {
    options: {
      // Allow large prompts with image attachments (≤ 16 MB raw / ~21 MB after base64 framing).
      maxPayload: 25 * 1024 * 1024,
    },
  });

  const store = new Store();
  const manager = new SessionManager(store);
  const bgTasks = new BgTaskManager();
  const clients = new Set<(msg: ServerToClient) => void>();
  const broadcast = (msg: ServerToClient) => {
    for (const send of clients) send(msg);
  };

  bgTasks.on("update", (task) => broadcast({ type: "bg_task_update", task }));
  bgTasks.on("output", (taskId, chunk, stream) =>
    broadcast({ type: "bg_task_output", taskId, chunk, stream }),
  );
  bgTasks.on("removed", (taskId) => broadcast({ type: "bg_task_removed", taskId }));

  // ── Install & upgrade infrastructure ────────────────────────────────────────
  const installedVersion = readInstalledVersion();
  const dataDir = resolveDataDir();
  const updateChecker = new UpdateChecker({
    installedVersion,
    dataDir: dataDir.dir,
    onUpdate: (info, installed) => {
      broadcast({
        type: "update_available",
        installed,
        latest: info.latest,
        tag: info.tag,
        url: info.url,
        notes: info.notes,
        publishedAt: info.publishedAt,
      });
    },
  });
  if (process.env.COPILOT_DECK_DISABLE_UPDATE_CHECK !== "1") {
    updateChecker.start();
  }

  // ── Optional static-file serve for bundled web assets ───────────────────────
  const staticDir = process.env.COPILOT_DECK_STATIC_DIR;
  if (staticDir && existsSync(staticDir)) {
    await app.register(fastifyStatic, {
      root: path.resolve(staticDir),
      prefix: "/",
      wildcard: false,
    });
    // SPA fallback: any non-/api, non-/ws GET returns index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/") && !req.url.startsWith("/ws")) {
        return reply.sendFile("index.html");
      }
      reply.code(404).send({ error: "not found", url: req.url });
    });
  }

  const extensionWatchers = startExtensionWatchers({
    manager,
    broadcast,
    invalidate: {
      plugins: invalidatePluginCache,
      marketplaces: invalidateMarketplaceCache,
      mcpUser: invalidateMcpUserCache,
      skillsRepo: invalidateSkillsCache,
      skillsGlobal: () => invalidateSkillsCache(),
    },
  });
  const stopFilesWatcher = startFilesWatcher({ manager, broadcast });

  registerRoutes(app, {
    manager,
    installedVersion,
    updateChecker,
    db: store.db,
    dbPath: dataDir.dbPath,
    getActiveSessionIds: () => new Set(manager.list().map((session) => session.id)),
  });
  registerMcpRoutes(app, { manager });
  registerPluginRoutes(app, { broadcast });
  registerSkillsRoutes(app, { manager, broadcast });
  registerGitRoutes(app, { manager });
  registerGrepRoutes(app, { manager, broadcast });
  registerOutlineRoutes(app, { manager });
  registerFilesOverviewRoutes(app, { manager });

  app.register(async (instance) => {
    instance.get("/ws", { websocket: true }, (socket) => {
      const send = (msg: ServerToClient) => {
        try {
          socket.send(JSON.stringify(msg));
        } catch (e) {
          app.log.warn({ err: e }, "ws send failed");
        }
      };
      clients.add(send);
      const ctx: WsContext = { manager, send, log: app.log };

      // Push the persisted snapshot first so the client paints history immediately.
      try {
        send({ type: "hydrate", sessions: manager.hydrate() });
        send({ type: "bg_task_snapshot", tasks: bgTasks.list() });
      } catch (e) {
        app.log.warn({ err: e }, "hydrate send failed");
      }

      // If an update is already known at connection time, surface it now so
      // late-joining clients don't need to wait for the next poll cycle.
      const cache = updateChecker.getCache();
      if (
        cache.latest &&
        cache.latest.latest !== cache.installed &&
        // simple lexical compare guard — checker has already validated it's newer
        cache.latest.latest > cache.installed
      ) {
        try {
          send({
            type: "update_available",
            installed: cache.installed,
            latest: cache.latest.latest,
            tag: cache.latest.tag,
            url: cache.latest.url,
            notes: cache.latest.notes,
            publishedAt: cache.latest.publishedAt,
          });
        } catch {}
      }

      const unsubs = [
        manager.onSessionUpdate((sessionId, update) => {
          send({ type: "session_update", sessionId, update: update.update });
        }),
        manager.onPermissionRequest((ev) => {
          send({
            type: "permission_request",
            requestId: ev.requestId,
            sessionId: ev.sessionId,
            toolCall: ev.toolCall,
            options: ev.options,
          });
        }),
        manager.onChildExit((ev) => {
          send({
            type: "child_exit",
            cwd: ev.cwd,
            sessionIds: ev.sessionIds,
            code: ev.code,
            signal: ev.signal,
          });
        }),
        manager.onTrace((ev) => {
          send({ type: "trace_event", event: ev });
        }),
        manager.onModelChange((ev) => {
          send({
            type: "model_changed",
            cwd: ev.cwd,
            model: ev.model,
            sessionIds: ev.sessionIds,
          });
        }),
        manager.onSessionRename((ev) => {
          send({
            type: "session_renamed",
            sessionId: ev.sessionId,
            title: ev.title,
          });
        }),
        manager.onSessionModelChange((ev) => {
          send({
            type: "session_model_changed",
            sessionId: ev.sessionId,
            model: ev.model,
          });
        }),
      ];

      socket.on("close", () => {
        clients.delete(send);
        for (const u of unsubs) u();
      });

      socket.on("message", async (raw: Buffer) => {
        let msg: ClientToServer;
        try {
          msg = JSON.parse(raw.toString("utf8")) as ClientToServer;
        } catch {
          return send({ type: "error", message: "invalid JSON" });
        }
        if (msg.type === "mark_reviewed") {
          try {
            manager.markReviewed(msg.sessionId, msg.path, msg.diffHash);
          } catch (e) {
            send({
              type: "error",
              sessionId: msg.sessionId,
              message: e instanceof Error ? e.message : String(e),
            });
          }
          return;
        }
        if (msg.type === "unmark_reviewed") {
          try {
            manager.unmarkReviewed(msg.sessionId, msg.path);
          } catch (e) {
            send({
              type: "error",
              sessionId: msg.sessionId,
              message: e instanceof Error ? e.message : String(e),
            });
          }
          return;
        }
        if (msg.type === "bg_task_start") {
          try {
            bgTasks.start({ cwd: msg.cwd, command: msg.command, label: msg.label });
          } catch (e) {
            send({
              type: "error",
              message: e instanceof Error ? e.message : String(e),
            });
          }
          return;
        }
        if (msg.type === "bg_task_stop") {
          bgTasks.stop(msg.taskId);
          return;
        }
        if (msg.type === "bg_task_remove") {
          bgTasks.remove(msg.taskId);
          return;
        }
        if (msg.type === "bg_task_list") {
          send({ type: "bg_task_snapshot", tasks: bgTasks.list() });
          return;
        }
        await dispatchWs(msg, ctx);
      });
    });
  });

  const shutdown = async () => {
    app.log.info("shutting down");
    updateChecker.stop();
    stopFilesWatcher();
    await extensionWatchers.close();
    bgTasks.shutdown();
    await manager.shutdownAll();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`copilot-deck server v${installedVersion} listening on http://${HOST}:${PORT}`);
  if (dataDir.migrated) {
    app.log.info(`migrated data dir from ~/.agent-view → ${dataDir.dir}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
