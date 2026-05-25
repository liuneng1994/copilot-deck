// REST endpoints for the agent-view server. Kept thin: input validation,
// delegate to manager / store / fs helpers, return JSON.

import { spawn } from "node:child_process";
import { promises as fs, createReadStream } from "node:fs";
import path from "node:path";
import { CURATED_MODELS } from "@agent-view/shared";
import type { PruneRequest } from "@agent-view/shared";
import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";
import { CopilotHistoryStore } from "./copilot-history.js";
import { listFiles } from "./file-index.js";
import {
  deleteCheckpoint as deleteCheckpointGit,
  previewRestore,
  restoreCheckpoint,
} from "./git-checkpoint.js";
import { PathSafetyError, assertWithinCwd } from "./path-safety.js";
import type { SessionManager } from "./session-manager.js";
import { getStorageStats, pruneOld, vacuum } from "./storage-admin.js";

interface Deps {
  manager: SessionManager;
  installedVersion?: string;
  updateChecker?: import("./update-check.js").UpdateChecker;
  db: Database.Database;
  dbPath: string;
  getActiveSessionIds: () => Set<string>;
}

const DEFAULT_FILE_RANGE_BYTES = 65_536;
const MAX_FILE_RANGE_BYTES = 2_000_000;
const RAW_FILE_MAX_BYTES = 20 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 4096;

function parseNonNegativeInt(value: string | undefined, fallback: number, max?: number): number {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  const whole = Math.floor(parsed);
  return max == null ? whole : Math.min(whole, max);
}

function parseBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "1";
  return fallback;
}

function normalizePruneRequest(input: Partial<PruneRequest>): PruneRequest {
  return {
    olderThanDays: Number(input.olderThanDays),
    pruneSessions: parseBoolean(input.pruneSessions),
    dryRun: parseBoolean(input.dryRun),
  };
}

function firstNonWhitespace(buffer: Buffer): number | undefined {
  for (const byte of buffer) {
    if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) return byte;
  }
  return undefined;
}

function sniffMime(buffer: Buffer, isBinary: boolean): string {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii") === "GIF8") {
    return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  const head = buffer.subarray(0, BINARY_SNIFF_BYTES).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) {
    return "image/svg+xml";
  }

  if (isBinary) return "application/octet-stream";
  const first = firstNonWhitespace(buffer);
  if (first === 0x7b || first === 0x5b) return "application/json";
  return "text/plain";
}

function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

export function registerRoutes(app: FastifyInstance, deps: Deps): void {
  const { manager } = deps;
  const copilotHistory = new CopilotHistoryStore();
  const isKnownCwd = (cwd: string) => {
    if (manager.list().some((s) => s.cwd === cwd)) return true;
    return manager.hydrate().some((s) => s.cwd === cwd);
  };

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/default-cwd", async () => ({
    cwd: process.env.USERPROFILE ?? process.env.HOME ?? process.cwd(),
  }));

  // ─── Install & upgrade diagnostics ──────────────────────────────────────────
  app.get("/api/version", async () => {
    const installed = deps.installedVersion ?? "0.0.0";
    let copilotCli: string | null = null;
    try {
      const { runDoctor } = await import("./doctor.js");
      const report = await runDoctor();
      const cli = report.checks.find((c) => c.id === "copilot-cli");
      copilotCli = cli?.severity === "ok" ? cli.detail : null;
    } catch {
      copilotCli = null;
    }
    return {
      installed,
      node: process.versions.node,
      copilotCli,
      platform: process.platform,
      arch: process.arch,
    };
  });

  app.get("/api/doctor", async () => {
    const { runDoctor } = await import("./doctor.js");
    return runDoctor();
  });

  app.get("/api/updates/latest", async () => {
    const checker = deps.updateChecker;
    if (!checker) return { enabled: false };
    return { enabled: true, ...checker.getCache() };
  });

  app.post("/api/updates/check", async () => {
    const checker = deps.updateChecker;
    if (!checker) return { enabled: false };
    return { enabled: true, ...(await checker.refresh()) };
  });

  app.get("/api/storage/stats", async () => getStorageStats(deps.db, deps.dbPath));

  app.get<{
    Querystring: { olderThanDays?: string; pruneSessions?: string; dryRun?: string };
  }>("/api/storage/prune", async (req, reply) => {
    const body = normalizePruneRequest({
      olderThanDays: Number(req.query.olderThanDays),
      pruneSessions: parseBoolean(req.query.pruneSessions),
      dryRun: true,
    });
    if (!Number.isFinite(body.olderThanDays) || body.olderThanDays < 1) {
      return reply.code(400).send({ error: "olderThanDays must be at least 1" });
    }
    return pruneOld(deps.db, deps.dbPath, body, deps.getActiveSessionIds());
  });

  app.post<{ Body: PruneRequest }>("/api/storage/prune", async (req, reply) => {
    const body = normalizePruneRequest(req.body ?? {});
    if (!Number.isFinite(body.olderThanDays) || body.olderThanDays < 1) {
      return reply.code(400).send({ error: "olderThanDays must be at least 1" });
    }
    try {
      return await pruneOld(deps.db, deps.dbPath, body, deps.getActiveSessionIds());
    } catch (err) {
      if (err instanceof RangeError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post("/api/storage/vacuum", async () => vacuum(deps.db, deps.dbPath));

  // ─── Copilot CLI history (read-only adapter over ~/.copilot/session-store.db) ───
  app.get<{ Querystring: { cwd?: string; q?: string; limit?: string } }>(
    "/api/copilot-history/sessions",
    async (req) => {
      const limit = parseNonNegativeInt(req.query.limit, 100, 500);
      const sessions = copilotHistory.listSessions({
        cwd: req.query.cwd?.trim() || undefined,
        q: req.query.q?.trim() || undefined,
        limit,
      });
      return { available: copilotHistory.isAvailable(), sessions };
    },
  );

  app.get<{ Params: { id: string } }>("/api/copilot-history/sessions/:id", async (req, reply) => {
    const detail = copilotHistory.getSession(req.params.id);
    if (!detail) return reply.code(404).send({ error: "session not found" });
    return detail;
  });

  app.post<{ Body: { externalSessionId?: string; cwd?: string; title?: string } }>(
    "/api/copilot-history/resume",
    async (req, reply) => {
      const id = (req.body?.externalSessionId ?? "").trim();
      if (!id) return reply.code(400).send({ error: "externalSessionId required" });
      const detail = copilotHistory.getSession(id);
      if (!detail) return reply.code(404).send({ error: "copilot session not found" });
      const cwd = (req.body?.cwd ?? detail.cwd ?? "").trim();
      if (!cwd)
        return reply.code(400).send({ error: "cwd required (session has no cwd recorded)" });
      try {
        const result = await manager.importExternalSession({
          externalSessionId: id,
          cwd,
          title: req.body?.title?.trim() || detail.summary || null,
          turns: detail.turns.map((t) => ({
            userMessage: t.userMessage,
            assistantResponse: t.assistantResponse,
            timestamp: t.timestamp,
          })),
        });
        return result;
      } catch (err) {
        return reply.code(500).send({ error: (err as Error).message || "import failed" });
      }
    },
  );

  app.get("/api/sessions", async () => ({ sessions: manager.list() }));

  app.get("/api/models", async () => ({
    models: CURATED_MODELS,
    defaultModel: manager.getDefaultModel(),
    currentByCwd: manager.getModelsByCwd(),
  }));

  app.post<{ Params: { id: string }; Body: { mode?: string } }>(
    "/api/sessions/:id/render-hint",
    async (req, reply) => {
      const mode = req.body?.mode;
      if (mode !== "agents_md" && mode !== "prompt" && mode !== "off") {
        reply.code(400);
        return { error: "mode must be one of: agents_md, prompt, off" };
      }
      try {
        manager.setRenderHintMode(req.params.id, mode);
        return { ok: true, mode };
      } catch (e) {
        reply.code(404);
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  app.post<{ Params: { id: string } }>("/api/sessions/:id/agents-md", async (req, reply) => {
    try {
      const result = await manager.writeAgentsMd(req.params.id);
      const status = result.created ? "created" : result.updated ? "updated" : "noop";
      return { ok: true, status, path: result.filePath };
    } catch (e) {
      reply.code(404);
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ───── checkpoints ─────
  app.get<{ Params: { id: string } }>("/api/sessions/:id/checkpoints", async (req, reply) => {
    try {
      return { checkpoints: manager.listCheckpoints(req.params.id) };
    } catch (e) {
      reply.code(404);
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  app.get<{ Params: { id: string } }>("/api/checkpoints/:id/preview", async (req, reply) => {
    try {
      const r = await previewRestore({
        store: manager.store,
        checkpointId: req.params.id,
      });
      return { paths: r.paths, total: r.total, checkpoint: r.checkpoint };
    } catch (e) {
      reply.code(404);
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  app.post<{ Params: { id: string }; Body: { removeAdded?: boolean } }>(
    "/api/checkpoints/:id/restore",
    async (req, reply) => {
      try {
        const r = await restoreCheckpoint({
          store: manager.store,
          checkpointId: req.params.id,
          removeAdded: !!req.body?.removeAdded,
        });
        return { ok: true, changed: r.changed, checkpoint: r.checkpoint };
      } catch (e) {
        reply.code(400);
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  app.delete<{ Params: { id: string } }>("/api/checkpoints/:id", async (req, reply) => {
    try {
      await deleteCheckpointGit({ store: manager.store, checkpointId: req.params.id });
      return { ok: true };
    } catch (e) {
      reply.code(400);
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ───── cross-session search ─────
  app.get<{ Querystring: { q?: string; limit?: string; sessionId?: string } }>(
    "/api/search",
    async (req, reply) => {
      const q = (req.query.q ?? "").trim();
      if (!q) return { query: q, hits: [] };
      const limit = Number(req.query.limit ?? "50");
      const sessionId = req.query.sessionId?.trim() || undefined;
      try {
        const hits = manager.store.searchMessages(q, {
          limit: Number.isFinite(limit) ? limit : 50,
          sessionId,
        });
        return { query: q, hits };
      } catch (e) {
        reply.code(500);
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { messageId?: string } }>(
    "/api/sessions/:id/fork",
    async (req, reply) => {
      const src = manager.getStoredSession(req.params.id);
      if (!src) {
        reply.code(404);
        return { error: "session not found" };
      }
      try {
        const res = await manager.forkSession({
          sourceSessionId: req.params.id,
          upToMessageId: req.body?.messageId,
        });
        return res;
      } catch (e) {
        reply.code(500);
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  );

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

  // Returns a bounded range (default 64 KiB); older behavior read the whole file up to 256 KiB.
  app.get<{
    Querystring: { path?: string; cwd?: string; offset?: string; length?: string; max?: string };
  }>("/api/file", async (req, reply) => {
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
    const offset = parseNonNegativeInt(req.query.offset, 0);
    const length = parseNonNegativeInt(
      req.query.length ?? req.query.max,
      DEFAULT_FILE_RANGE_BYTES,
      MAX_FILE_RANGE_BYTES,
    );
    try {
      const { realTarget } = await assertWithinCwd(abs, cwd, manager);
      const stat = await fs.stat(realTarget);
      if (!stat.isFile()) {
        reply.code(400);
        return { error: "not a file" };
      }

      const fh = await fs.open(realTarget, "r");
      try {
        const rangeBytes = Math.max(0, Math.min(length, Math.max(0, stat.size - offset)));
        const rangeBuffer = Buffer.alloc(rangeBytes);
        const { bytesRead } =
          rangeBytes > 0 ? await fh.read(rangeBuffer, 0, rangeBytes, offset) : { bytesRead: 0 };
        const contentBuffer = rangeBuffer.subarray(0, bytesRead);

        let firstBytes: Buffer | undefined;
        const sniffLength = Math.min(BINARY_SNIFF_BYTES, stat.size);
        if (offset === 0 && bytesRead >= sniffLength) {
          firstBytes = contentBuffer.subarray(0, sniffLength);
        } else {
          firstBytes = Buffer.alloc(sniffLength);
          if (sniffLength > 0) {
            const { bytesRead: firstBytesRead } = await fh.read(firstBytes, 0, sniffLength, 0);
            firstBytes = firstBytes.subarray(0, firstBytesRead);
          }
        }

        const isBinary = firstBytes.includes(0);
        const mime = sniffMime(firstBytes, isBinary);
        const isImage = isImageMime(mime);
        const response: {
          size: number;
          offset: number;
          length: number;
          isBinary: boolean;
          isImage: boolean;
          mime: string;
          content?: string;
          truncated: boolean;
        } = {
          size: stat.size,
          offset,
          length: bytesRead,
          isBinary,
          isImage,
          mime: isBinary && !isImage ? "application/octet-stream" : mime,
          truncated: offset + bytesRead < stat.size,
        };

        if (!isBinary && !isImage) {
          response.content = contentBuffer.toString("utf8");
        }
        return response;
      } finally {
        await fh.close();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reply.code(err instanceof PathSafetyError ? 403 : 404);
      return { error: message };
    }
  });

  app.get<{ Querystring: { path?: string; q?: string; limit?: string } }>(
    "/api/list-dir",
    async (req, reply) => {
      const home = process.env.USERPROFILE ?? process.env.HOME ?? "/";
      const raw = req.query.path?.trim() || home;
      const query = (req.query.q ?? "").toLowerCase();
      const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);

      const expanded = raw.startsWith("~") ? path.join(home, raw.slice(1)) : raw;
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

  app.get<{ Querystring: { path?: string; cwd?: string } }>("/api/file/raw", async (req, reply) => {
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

    try {
      const { realTarget } = await assertWithinCwd(abs, cwd, manager);
      const stat = await fs.stat(realTarget);
      if (!stat.isFile()) {
        reply.code(400);
        return { error: "not a file" };
      }
      if (stat.size > RAW_FILE_MAX_BYTES) {
        reply.code(413);
        return { error: "file too large" };
      }

      const fh = await fs.open(realTarget, "r");
      let firstBytes = Buffer.alloc(Math.min(BINARY_SNIFF_BYTES, stat.size));
      try {
        if (firstBytes.length > 0) {
          const { bytesRead } = await fh.read(firstBytes, 0, firstBytes.length, 0);
          firstBytes = firstBytes.subarray(0, bytesRead);
        }
      } finally {
        await fh.close();
      }

      const mime = sniffMime(firstBytes, firstBytes.includes(0));
      return reply
        .header("Cache-Control", "private, max-age=0")
        .type(mime)
        .send(createReadStream(realTarget));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reply.code(err instanceof PathSafetyError ? 403 : 404);
      return { error: message };
    }
  });
}
