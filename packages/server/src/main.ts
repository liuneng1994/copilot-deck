// agent-view server entry point.
//
// Wires together SessionManager (Copilot ACP orchestrator), REST routes, and
// the WebSocket gateway for real-time session updates.

import type { ClientToServer, ServerToClient } from "@agent-view/shared";
import fastifyWebsocket from "@fastify/websocket";
import Fastify from "fastify";
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
import { type WsContext, dispatchWs } from "./ws-handlers.js";

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? "127.0.0.1";

async function main() {
  const app = Fastify({ logger: { level: "info" } });
  await app.register(fastifyWebsocket);

  const store = new Store();
  const manager = new SessionManager(store);
  const clients = new Set<(msg: ServerToClient) => void>();
  const broadcast = (msg: ServerToClient) => {
    for (const send of clients) send(msg);
  };

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

  registerRoutes(app, { manager });
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
      } catch (e) {
        app.log.warn({ err: e }, "hydrate send failed");
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
        await dispatchWs(msg, ctx);
      });
    });
  });

  const shutdown = async () => {
    app.log.info("shutting down");
    stopFilesWatcher();
    await extensionWatchers.close();
    await manager.shutdownAll();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`agent-view server listening on http://${HOST}:${PORT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
