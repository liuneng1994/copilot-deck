// REST endpoints for the agent-view server. Kept thin: input validation,
// delegate to manager / store / fs helpers, return JSON.

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { CURATED_MODELS } from "@agent-view/shared";
import type { FastifyInstance } from "fastify";
import { listFiles } from "./file-index.js";
import { PathSafetyError, assertWithinCwd } from "./path-safety.js";
import type { SessionManager } from "./session-manager.js";

interface Deps {
  manager: SessionManager;
}

export function registerRoutes(app: FastifyInstance, deps: Deps): void {
  const { manager } = deps;
  const isKnownCwd = (cwd: string) => manager.list().some((s) => s.cwd === cwd);

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/sessions", async () => ({ sessions: manager.list() }));

  app.get("/api/models", async () => ({
    models: CURATED_MODELS,
    defaultModel: manager.getDefaultModel(),
    currentByCwd: manager.getModelsByCwd(),
  }));

  app.post<{ Body: { path?: string; cwd?: string } }>("/api/mkdir", async (req, reply) => {
    const raw = typeof req.body?.path === "string" ? req.body.path.trim() : "";
    const cwd = typeof req.body?.cwd === "string" ? req.body.cwd.trim() : undefined;
    if (!raw) {
      reply.code(400);
      return { error: "path required" };
    }
    if (!path.isAbsolute(raw)) {
      reply.code(400);
      return { error: "absolute path required" };
    }
    if (cwd && !path.isAbsolute(cwd)) {
      reply.code(400);
      return { error: "absolute cwd required" };
    }
    if (cwd && !isKnownCwd(cwd)) {
      reply.code(400);
      return { error: "cwd not in active session list" };
    }
    const target = path.normalize(raw);
    if (target === "/" || target === "/root" || target === "/home") {
      reply.code(400);
      return { error: "refusing to create root-level directory" };
    }
    try {
      if (cwd) await assertWithinCwd(target, cwd, manager);
      const before = await fs.stat(target).catch(() => null);
      const existed = !!before?.isDirectory();
      await fs.mkdir(target, { recursive: true });
      return { ok: true, path: target, created: !existed };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reply.code(err instanceof PathSafetyError ? 403 : 500);
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
      if (!isKnownCwd(cwd)) {
        reply.code(400);
        return { error: "cwd not in active session list" };
      }
      try {
        const { realCwd } = await assertWithinCwd(cwd, cwd, manager);
        const matches = await listFiles({
          cwd: realCwd,
          query: req.query.q ?? "",
          limit: Math.min(Number(req.query.limit ?? 50) || 50, 200),
        });
        return { cwd, files: matches };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reply.code(err instanceof PathSafetyError ? 403 : 500);
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
      const cwd = req.query.cwd?.trim();
      if (!cwd || !path.isAbsolute(cwd)) {
        reply.code(400);
        return { error: "absolute cwd required" };
      }
      if (!isKnownCwd(cwd)) {
        reply.code(400);
        return { error: "cwd not in active session list" };
      }
      const abs = path.isAbsolute(target) ? path.normalize(target) : path.resolve(cwd, target);
      const editorCmd = process.env.AGENT_VIEW_EDITOR ?? "code";
      try {
        const { realTarget } = await assertWithinCwd(abs, cwd, manager);
        const child = spawn(editorCmd, [realTarget], {
          stdio: "ignore",
          detached: true,
        });
        child.on("error", (e) => app.log.warn({ err: e }, "open-in-editor spawn failed"));
        child.unref();
        return { ok: true, path: realTarget };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reply.code(err instanceof PathSafetyError ? 403 : 500);
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
      const cwd = req.query.cwd?.trim();
      if (!cwd || !path.isAbsolute(cwd)) {
        reply.code(400);
        return { error: "absolute cwd required" };
      }
      if (!isKnownCwd(cwd)) {
        reply.code(400);
        return { error: "cwd not in active session list" };
      }
      const abs = path.isAbsolute(target) ? path.normalize(target) : path.resolve(cwd, target);
      const maxBytes = Math.min(Number(req.query.max ?? 256_000) || 256_000, 2_000_000);
      try {
        const { realTarget } = await assertWithinCwd(abs, cwd, manager);
        const stat = await fs.stat(realTarget);
        if (!stat.isFile()) {
          reply.code(400);
          return { error: "not a file" };
        }
        if (stat.size > maxBytes) {
          const fh = await fs.open(realTarget, "r");
          try {
            const buf = Buffer.alloc(maxBytes);
            await fh.read(buf, 0, maxBytes, 0);
            return {
              path: realTarget,
              size: stat.size,
              truncated: true,
              content: buf.toString("utf8"),
            };
          } finally {
            await fh.close();
          }
        }
        const content = await fs.readFile(realTarget, "utf8");
        return { path: realTarget, size: stat.size, truncated: false, content };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reply.code(err instanceof PathSafetyError ? 403 : 404);
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

      const expanded = raw.startsWith("~") ? path.join(process.env.HOME ?? "/", raw.slice(1)) : raw;
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

  app.get<{ Querystring: { cwd?: string } }>("/api/git-info", async (req, reply) => {
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
          child.stdout.on("data", (c: Buffer) => {
            out += c.toString("utf8");
          });
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
  });

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

  app.get<{ Params: { id: string }; Querystring: { format?: string } }>(
    "/api/sessions/:id/export",
    async (req, reply) => {
      const id = req.params.id;
      const sess = manager.getStoredSession(id);
      if (!sess) {
        reply.code(404);
        return { error: "session not found" };
      }
      const messages = manager.listStoredMessages(id);
      const tools = manager.listStoredToolCalls(id);
      const format = (req.query.format ?? "md").toLowerCase();
      const safeTitle = (sess.title || `session-${id.slice(0, 8)}`).replace(/[^\w.-]+/g, "_");

      if (format === "json") {
        reply
          .header("content-type", "application/json; charset=utf-8")
          .header("content-disposition", `attachment; filename="${safeTitle}.json"`);
        return JSON.stringify({ session: sess, messages, toolCalls: tools }, null, 2);
      }

      let md = `# ${sess.title ?? "(untitled session)"}\n\n`;
      md += `- **id**: \`${sess.id}\`\n`;
      md += `- **cwd**: \`${sess.cwd}\`\n`;
      md += `- **created**: ${new Date(sess.createdAt).toISOString()}\n`;
      md += `- **updated**: ${new Date(sess.updatedAt).toISOString()}\n`;
      if (sess.modeName) md += `- **mode**: ${sess.modeName}\n`;
      md += "\n---\n\n";
      for (const m of messages) {
        const who = m.role === "user" ? "🧑 User" : m.role === "agent" ? "🤖 Agent" : "⚙️ System";
        md += `### ${who} — ${new Date(m.ts).toISOString()}\n\n${m.text}\n\n`;
      }
      if (tools.length > 0) {
        md += "\n---\n\n## Tool calls\n\n";
        for (const t of tools) {
          md += `### ${t.kind}: ${t.title} — \`${t.status}\`\n\n`;
          if (t.rawInput != null) {
            md += `\`\`\`json\n${JSON.stringify(t.rawInput, null, 2)}\n\`\`\`\n\n`;
          }
        }
      }
      reply
        .header("content-type", "text/markdown; charset=utf-8")
        .header("content-disposition", `attachment; filename="${safeTitle}.md"`);
      return md;
    },
  );
}
