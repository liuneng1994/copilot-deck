import { promises as fs } from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { PathSafetyError, assertWithinCwd } from "../path-safety.js";
import type { SessionManager } from "../session-manager.js";
import { detectOutlineLanguage, getOutline } from "./index.js";

interface Deps {
  manager: SessionManager;
}

function sendError(reply: FastifyReply, statusCode: number, error: string): { error: string } {
  reply.code(statusCode);
  return { error };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerOutlineRoutes(app: FastifyInstance, deps: Deps): void {
  app.get<{ Querystring: { path?: string; cwd?: string } }>(
    "/api/file/outline",
    async (req, reply) => {
      const rawPath = req.query.path?.trim();
      const cwd = req.query.cwd?.trim();
      if (!rawPath) return sendError(reply, 400, "path required");
      if (!cwd || !path.isAbsolute(cwd)) return sendError(reply, 400, "absolute cwd required");
      if (rawPath.includes("\0") || cwd.includes("\0")) {
        return sendError(reply, 400, "NUL in path");
      }

      const absPath = path.isAbsolute(rawPath)
        ? path.normalize(rawPath)
        : path.resolve(cwd, rawPath);

      try {
        const { realTarget } = await assertWithinCwd(absPath, cwd, deps.manager);
        const stat = await fs.stat(realTarget);
        if (!stat.isFile()) return sendError(reply, 400, "not a file");

        const language = detectOutlineLanguage(realTarget);
        const nodes = language == null ? null : await getOutline(realTarget, stat.mtimeMs);
        return { language, nodes };
      } catch (err) {
        const statusCode = err instanceof PathSafetyError ? 403 : 404;
        return sendError(reply, statusCode, errorMessage(err));
      }
    },
  );
}
