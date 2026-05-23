import { promises as fs } from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import type { ClientToServer, ServerToClient } from "@agent-view/shared";
import { SessionManager } from "./session-manager.js";

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? "127.0.0.1";

async function main() {
  const app = Fastify({ logger: { level: "info" } });
  await app.register(fastifyWebsocket);

  const manager = new SessionManager();

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/sessions", async () => ({ sessions: manager.list() }));

  app.post<{ Body: { path?: string } }>("/api/mkdir", async (req, reply) => {
    const raw = typeof req.body?.path === "string" ? req.body.path.trim() : "";
    if (!raw) {
      reply.code(400);
      return { error: "path required" };
    }
    if (!path.isAbsolute(raw)) {
      reply.code(400);
      return { error: "absolute path required" };
    }
    const target = path.normalize(raw);
    if (target === "/" || target === "/root" || target === "/home") {
      reply.code(400);
      return { error: "refusing to create root-level directory" };
    }
    try {
      const before = await fs.stat(target).catch(() => null);
      const existed = !!before?.isDirectory();
      await fs.mkdir(target, { recursive: true });
      return { ok: true, path: target, created: !existed };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reply.code(500);
      return { error: message };
    }
  });

  app.register(async (instance) => {
    instance.get("/ws", { websocket: true }, (socket) => {
      const send = (msg: ServerToClient) => {
        try {
          socket.send(JSON.stringify(msg));
        } catch (e) {
          app.log.warn({ err: e }, "ws send failed");
        }
      };

      const unsub = manager.onSessionUpdate((sessionId, update) => {
        send({ type: "session_update", sessionId, update: update.update });
      });

      socket.on("close", () => unsub());

      socket.on("message", async (raw: Buffer) => {
        let msg: ClientToServer;
        try {
          msg = JSON.parse(raw.toString("utf8")) as ClientToServer;
        } catch {
          return send({ type: "error", message: "invalid JSON" });
        }

        try {
          switch (msg.type) {
            case "create_session": {
              const sessionId = await manager.createSession(msg.cwd);
              send({ type: "session_created", sessionId, cwd: msg.cwd });
              break;
            }
            case "prompt": {
              const res = await manager.prompt(msg.sessionId, msg.text);
              send({
                type: "prompt_done",
                sessionId: msg.sessionId,
                stopReason: res.stopReason,
              });
              break;
            }
            case "cancel": {
              await manager.cancel(msg.sessionId);
              break;
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          app.log.error({ err }, "ws handler error");
          send({
            type: "error",
            sessionId: "sessionId" in msg ? msg.sessionId : undefined,
            message,
          });
        }
      });
    });
  });

  const shutdown = async () => {
    app.log.info("shutting down");
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
