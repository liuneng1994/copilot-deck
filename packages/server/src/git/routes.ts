import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import { PathSafetyError, assertWithinCwd } from "../path-safety.js";
import type { SessionManager } from "../session-manager.js";
import { runGit } from "./index.js";
import { parseGitStatus } from "./parse-status.js";

interface Deps {
  manager: SessionManager;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sendError(reply: FastifyReply, statusCode: number, error: string): { error: string } {
  reply.code(statusCode);
  return { error };
}

async function validateCwd(
  rawCwd: string | undefined,
  manager: SessionManager,
): Promise<{ cwd: string; realCwd: string } | { error: string; statusCode: number }> {
  const cwd = rawCwd?.trim();
  if (!cwd) return { error: "cwd required", statusCode: 400 };
  if (!path.isAbsolute(cwd)) return { error: "absolute cwd required", statusCode: 400 };
  try {
    const { realCwd } = await assertWithinCwd(cwd, cwd, manager);
    return { cwd, realCwd };
  } catch (err) {
    const statusCode = err instanceof PathSafetyError ? 400 : 500;
    return { error: errorMessage(err), statusCode };
  }
}

async function validatePath(
  cwd: string,
  rawPath: string,
  manager: SessionManager,
): Promise<{ pathspec: string } | { error: string }> {
  if (!rawPath || rawPath.includes("\0")) return { error: "invalid path" };
  const target = path.isAbsolute(rawPath) ? path.normalize(rawPath) : path.resolve(cwd, rawPath);
  try {
    const { realTarget, realCwd } = await assertWithinCwd(target, cwd, manager);
    return { pathspec: path.relative(realCwd, realTarget) || "." };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

function validateBase(rawBase: string | undefined): string | { error: string } {
  const base = rawBase?.trim() || "HEAD";
  if (!base || base.includes("\0") || base.startsWith("-")) return { error: "invalid base" };
  return base;
}

export function registerGitRoutes(app: FastifyInstance, deps: Deps): void {
  const { manager } = deps;

  app.get<{ Querystring: { cwd?: string } }>("/api/git/status", async (req, reply) => {
    const validated = await validateCwd(req.query.cwd, manager);
    if ("error" in validated) return sendError(reply, validated.statusCode, validated.error);

    const result = await runGit(validated.cwd, ["status", "--porcelain=v2", "--branch", "-z"]);
    if (result.exitCode !== 0) return sendError(reply, 500, result.stderr || "git status failed");
    return parseGitStatus(result.stdout, validated.cwd);
  });

  app.get<{ Querystring: { cwd?: string; path?: string; base?: string } }>(
    "/api/git/diff",
    async (req, reply) => {
      const validated = await validateCwd(req.query.cwd, manager);
      if ("error" in validated) return sendError(reply, validated.statusCode, validated.error);

      const base = validateBase(req.query.base);
      if (typeof base !== "string") return sendError(reply, 400, base.error);

      const args = ["diff", base, "--"];
      if (req.query.path) {
        const checked = await validatePath(validated.cwd, req.query.path, manager);
        if ("error" in checked) return sendError(reply, 400, checked.error);
        args.push(checked.pathspec);
      }

      const result = await runGit(validated.cwd, args);
      if (result.exitCode !== 0) return sendError(reply, 500, result.stderr || "git diff failed");
      return { diff: result.stdout };
    },
  );

  app.post<{ Body: { cwd?: string; paths?: string[] } }>("/api/git/restore", async (req, reply) => {
    const validated = await validateCwd(req.body?.cwd, manager);
    if ("error" in validated) return sendError(reply, validated.statusCode, validated.error);

    const rawPaths = Array.isArray(req.body?.paths) ? req.body.paths : [];
    if (rawPaths.length === 0) return sendError(reply, 400, "paths required");

    const tracked: string[] = [];
    const untracked: string[] = [];
    const restored: string[] = [];
    const errors: { path: string; error: string }[] = [];

    for (const rawPath of rawPaths) {
      if (typeof rawPath !== "string") {
        errors.push({ path: String(rawPath), error: "path must be a string" });
        continue;
      }
      const checked = await validatePath(validated.cwd, rawPath, manager);
      if ("error" in checked) {
        errors.push({ path: rawPath, error: checked.error });
        continue;
      }
      const ls = await runGit(validated.cwd, [
        "ls-files",
        "--error-unmatch",
        "--",
        checked.pathspec,
      ]);
      if (ls.exitCode === 0) tracked.push(checked.pathspec);
      else untracked.push(checked.pathspec);
    }

    if (tracked.length > 0) {
      const result = await runGit(validated.cwd, ["restore", "--", ...tracked]);
      if (result.exitCode === 0) restored.push(...tracked);
      else {
        for (const pathspec of tracked) {
          errors.push({ path: pathspec, error: result.stderr || "git restore failed" });
        }
      }
    }

    if (untracked.length > 0) {
      const result = await runGit(validated.cwd, ["clean", "-f", "--", ...untracked]);
      if (result.exitCode === 0) restored.push(...untracked);
      else {
        for (const pathspec of untracked) {
          errors.push({ path: pathspec, error: result.stderr || "git clean failed" });
        }
      }
    }

    return { restored, errors };
  });

  app.post<{ Body: { cwd?: string; message?: string } }>("/api/git/stash", async (req, reply) => {
    const validated = await validateCwd(req.body?.cwd, manager);
    if ("error" in validated) return sendError(reply, validated.statusCode, validated.error);

    const message = req.body?.message?.trim() || `agent-view ${new Date().toISOString()}`;
    if (message.includes("\0")) return sendError(reply, 400, "invalid message");

    const result = await runGit(validated.cwd, ["stash", "push", "-u", "-m", message]);
    if (result.exitCode !== 0) return sendError(reply, 500, result.stderr || "git stash failed");
    return { ref: "stash@{0}", message, exitCode: result.exitCode };
  });
}
