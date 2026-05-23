import type { GrepChunkMessage, GrepDoneMessage } from "@agent-view/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { PathSafetyError, assertWithinCwd } from "../path-safety.js";
import type { SessionManager } from "../session-manager.js";
import { type GrepHandle, runGrep } from "./runner.js";

interface Deps {
  manager: SessionManager;
  broadcast: (msg: any) => void;
}

interface GrepBody {
  cwd?: string;
  q?: string;
  globs?: string[];
  caseSensitive?: boolean;
  maxFileMatches?: number;
  max?: number;
}

function sendError(reply: FastifyReply, statusCode: number, error: string): { error: string } {
  reply.code(statusCode);
  return { error };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function validPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function registerGrepRoutes(app: FastifyInstance, deps: Deps): void {
  const ops = new Map<string, GrepHandle>();

  app.post<{ Body: GrepBody }>("/api/grep", async (req, reply) => {
    const { cwd, q } = req.body ?? {};
    if (typeof cwd !== "string" || !cwd || typeof q !== "string" || !q) {
      return sendError(reply, 400, "cwd and q required");
    }
    if (q.includes("\0")) return sendError(reply, 400, "NUL in pattern");
    if (
      req.body?.globs !== undefined &&
      (!Array.isArray(req.body.globs) ||
        req.body.globs.some((g) => typeof g !== "string" || g.includes("\0")))
    ) {
      return sendError(reply, 400, "invalid glob");
    }
    if (req.body?.max !== undefined && !validPositiveInteger(req.body.max)) {
      return sendError(reply, 400, "invalid max");
    }
    if (req.body?.maxFileMatches !== undefined && !validPositiveInteger(req.body.maxFileMatches)) {
      return sendError(reply, 400, "invalid maxFileMatches");
    }

    try {
      await assertWithinCwd(cwd, cwd, deps.manager);
    } catch (err) {
      const statusCode = err instanceof PathSafetyError ? 400 : 500;
      return sendError(reply, statusCode, errorMessage(err));
    }

    const opId = `grep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const handle = runGrep(
      { ...req.body, cwd, q },
      (hits) => deps.broadcast({ type: "grep_chunk", opId, hits } satisfies GrepChunkMessage),
      (info) => {
        deps.broadcast({ type: "grep_done", opId, ...info } satisfies GrepDoneMessage);
        ops.delete(opId);
      },
    );
    ops.set(opId, handle);
    return { opId };
  });

  app.post<{ Params: { opId: string } }>("/api/grep/:opId/cancel", async (req) => {
    const h = ops.get(req.params.opId);
    if (h) h.abort();
    return { ok: true };
  });
}
