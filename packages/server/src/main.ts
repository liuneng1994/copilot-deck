import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import type { ClientToServer, ServerToClient } from "@agent-view/shared";
import { CURATED_MODELS } from "@agent-view/shared";
import { SessionManager } from "./session-manager.js";
import { listFiles } from "./file-index.js";
import { Store } from "./store.js";

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? "127.0.0.1";

async function main() {
  const app = Fastify({ logger: { level: "info" } });
  await app.register(fastifyWebsocket);

  const store = new Store();
  const manager = new SessionManager(store);

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/sessions", async () => ({ sessions: manager.list() }));

  app.get("/api/models", async () => ({
    models: CURATED_MODELS,
    defaultModel: manager.getDefaultModel(),
    currentByCwd: manager.getModelsByCwd(),
  }));

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

  app.get<{ Querystring: { cwd?: string; q?: string; limit?: string } }>(
    "/api/files",
    async (req, reply) => {
      const cwd = req.query.cwd?.trim();
      if (!cwd || !path.isAbsolute(cwd)) {
        reply.code(400);
        return { error: "absolute cwd required" };
      }
      try {
        const matches = await listFiles({
          cwd,
          query: req.query.q ?? "",
          limit: Math.min(Number(req.query.limit ?? 50) || 50, 200),
        });
        return { cwd, files: matches };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reply.code(500);
        return { error: message };
      }
    },
  );

  app.post<{ Querystring: { path?: string; cwd?: string } }>(
    "/api/open-in-editor",
    async (req, reply) => {
      const target = req.query.path?.trim();
      if (!target) {
        reply.code(400);
        return { error: "path required" };
      }
      const cwd = req.query.cwd && path.isAbsolute(req.query.cwd) ? req.query.cwd : undefined;
      const abs = path.isAbsolute(target)
        ? target
        : cwd
          ? path.resolve(cwd, target)
          : target;
      const editorCmd = process.env.AGENT_VIEW_EDITOR ?? "code";
      try {
        const child = spawn(editorCmd, [abs], {
          stdio: "ignore",
          detached: true,
        });
        child.on("error", (e) => app.log.warn({ err: e }, "open-in-editor spawn failed"));
        child.unref();
        return { ok: true, path: abs };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reply.code(500);
        return { error: message };
      }
    },
  );

  app.get<{ Querystring: { path?: string; cwd?: string; max?: string } }>(
    "/api/file",
    async (req, reply) => {
      const target = req.query.path?.trim();
      if (!target) {
        reply.code(400);
        return { error: "path required" };
      }
      const cwd = req.query.cwd && path.isAbsolute(req.query.cwd) ? req.query.cwd : undefined;
      const abs = path.isAbsolute(target)
        ? path.normalize(target)
        : cwd
          ? path.resolve(cwd, target)
          : path.resolve(target);
      const maxBytes = Math.min(Number(req.query.max ?? 256_000) || 256_000, 2_000_000);
      try {
        const stat = await fs.stat(abs);
        if (!stat.isFile()) {
          reply.code(400);
          return { error: "not a file" };
        }
        if (stat.size > maxBytes) {
          const fh = await fs.open(abs, "r");
          try {
            const buf = Buffer.alloc(maxBytes);
            await fh.read(buf, 0, maxBytes, 0);
            return {
              path: abs,
              size: stat.size,
              truncated: true,
              content: buf.toString("utf8"),
            };
          } finally {
            await fh.close();
          }
        }
        const content = await fs.readFile(abs, "utf8");
        return { path: abs, size: stat.size, truncated: false, content };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reply.code(404);
        return { error: message };
      }
    },
  );

  app.get<{ Querystring: { path?: string; q?: string; limit?: string } }>(
    "/api/list-dir",
    async (req, reply) => {
      const raw = req.query.path?.trim() || process.env.HOME || "/";
      const query = (req.query.q ?? "").toLowerCase();
      const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);

      // Expand leading ~ to HOME, then normalize.
      const expanded = raw.startsWith("~")
        ? path.join(process.env.HOME ?? "/", raw.slice(1))
        : raw;
      // If the path ends with a separator, we list the directory itself.
      // Otherwise we list the parent and treat the trailing segment as a filter.
      let dir = path.isAbsolute(expanded) ? expanded : path.resolve(expanded);
      let prefixFilter = "";
      try {
        const st = await fs.stat(dir).catch(() => null);
        if (!st?.isDirectory() && !raw.endsWith("/")) {
          prefixFilter = path.basename(dir).toLowerCase();
          dir = path.dirname(dir);
        }
      } catch {
        // fallthrough — let readdir error below
      }

      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const matches = entries
          .filter((e) => e.isDirectory() && !e.name.startsWith("."))
          .map((e) => e.name)
          .filter((n) => {
            const lower = n.toLowerCase();
            if (prefixFilter && !lower.startsWith(prefixFilter)) return false;
            if (query && !lower.includes(query)) return false;
            return true;
          })
          .sort((a, b) => a.localeCompare(b))
          .slice(0, limit)
          .map((n) => ({ name: n, path: path.join(dir, n) }));
        return { dir, entries: matches };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reply.code(404);
        return { error: message };
      }
    },
  );

  app.get<{ Querystring: { cwd?: string } }>(
    "/api/git-info",
    async (req, reply) => {
      const cwd = req.query.cwd?.trim();
      if (!cwd || !path.isAbsolute(cwd)) {
        reply.code(400);
        return { error: "absolute cwd required" };
      }
      try {
        const run = (args: string[]) =>
          new Promise<string>((resolve) => {
            const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] });
            let out = "";
            child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
            child.on("close", () => resolve(out.trim()));
            child.on("error", () => resolve(""));
          });
        const branch = await run(["rev-parse", "--abbrev-ref", "HEAD"]);
        if (!branch) return { repo: false };
        const dirtyOut = await run(["status", "--porcelain"]);
        const dirty = dirtyOut.length > 0;
        return { repo: true, branch, dirty };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reply.code(500);
        return { error: message };
      }
    },
  );

  app.get<{ Querystring: { sessionId?: string; sinceId?: string; limit?: string } }>(
    "/api/trace",
    async (req) => {
      const sessionId = req.query.sessionId?.trim() || undefined;
      const sinceId = req.query.sinceId ? Number(req.query.sinceId) : undefined;
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const events = manager.listTrace({ sessionId, sinceId, limit });
      return { events };
    },
  );

  app.register(async (instance) => {
    instance.get("/ws", { websocket: true }, (socket) => {
      const send = (msg: ServerToClient) => {
        try {
          socket.send(JSON.stringify(msg));
        } catch (e) {
          app.log.warn({ err: e }, "ws send failed");
        }
      };

      // Push the persisted snapshot first so the client paints history immediately.
      try {
        send({ type: "hydrate", sessions: manager.hydrate() });
      } catch (e) {
        app.log.warn({ err: e }, "hydrate send failed");
      }

      const unsub = manager.onSessionUpdate((sessionId, update) => {
        send({ type: "session_update", sessionId, update: update.update });
      });

      const unsubPerm = manager.onPermissionRequest((ev) => {
        send({
          type: "permission_request",
          requestId: ev.requestId,
          sessionId: ev.sessionId,
          toolCall: ev.toolCall,
          options: ev.options,
        });
      });

      const unsubChildExit = manager.onChildExit((ev) => {
        send({
          type: "child_exit",
          cwd: ev.cwd,
          sessionIds: ev.sessionIds,
          code: ev.code,
          signal: ev.signal,
        });
      });

      const unsubTrace = manager.onTrace((ev) => {
        send({ type: "trace_event", event: ev });
      });

      const unsubModel = manager.onModelChange((ev) => {
        send({
          type: "model_changed",
          cwd: ev.cwd,
          model: ev.model,
          sessionIds: ev.sessionIds,
        });
      });

      socket.on("close", () => {
        unsub();
        unsubPerm();
        unsubChildExit();
        unsubTrace();
        unsubModel();
      });

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
              const { sessionId, modes } = await manager.createSession(msg.cwd);
              send({
                type: "session_created",
                sessionId,
                cwd: msg.cwd,
                modes: modes
                  ? {
                      currentModeId: modes.currentModeId,
                      availableModes: modes.availableModes.map((m) => ({
                        id: m.id,
                        name: m.name,
                        description: m.description ?? undefined,
                      })),
                    }
                  : undefined,
              });
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
            case "set_mode": {
              await manager.setMode(msg.sessionId, msg.modeId);
              break;
            }
            case "delete_session": {
              manager.deleteSession(msg.sessionId);
              break;
            }
            case "request_trace": {
              const events = manager.listTrace({
                sessionId: msg.sessionId,
                sinceId: msg.sinceId,
                limit: msg.limit,
              });
              send({ type: "trace_snapshot", events });
              break;
            }
            case "list_models": {
              send({
                type: "models_snapshot",
                models: CURATED_MODELS,
                defaultModel: manager.getDefaultModel(),
                currentByCwd: manager.getModelsByCwd(),
              });
              break;
            }
            case "set_model": {
              await manager.setModel(msg.cwd, msg.model);
              break;
            }
            case "permission_reply": {
              const handled = manager.replyPermission(
                msg.requestId,
                msg.outcome,
                msg.optionId,
              );
              if (!handled) {
                app.log.warn({ requestId: msg.requestId }, "stale permission reply");
              }
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
