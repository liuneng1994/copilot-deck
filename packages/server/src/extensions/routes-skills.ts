import { randomUUID } from "node:crypto";
import path from "node:path";
import type { ServerToClient } from "@agent-view/shared";
import type { FastifyInstance } from "fastify";
import type { SessionManager } from "../session-manager.js";
import { runNpx, streamNpx } from "./cli.js";
import { parseSkillsFind } from "./parse-skills.js";
import {
  listGlobalSkills,
  listRepoSkills,
  removeGlobalSkill,
  removeRepoSkill,
} from "./skills-fs.js";

interface Deps {
  manager: SessionManager;
  broadcast: (msg: ServerToClient) => void;
}

const LIST_TTL_MS = 30_000;
const FIND_SUPPORTS_JSON = false;

type Cached<T> = { expiresAt: number; value: T };
const repoListCache = new Map<string, Cached<Awaited<ReturnType<typeof listRepoSkills>>>>();
let globalListCache: Cached<Awaited<ReturnType<typeof listGlobalSkills>>> | undefined;

export function invalidateSkillsCache(cwd?: string): void {
  if (cwd) repoListCache.delete(path.resolve(cwd));
  else repoListCache.clear();
  globalListCache = undefined;
}

async function cachedRepoSkills(cwd: string) {
  const key = path.resolve(cwd);
  const cached = repoListCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = await listRepoSkills(key);
  repoListCache.set(key, { value, expiresAt: Date.now() + LIST_TTL_MS });
  return value;
}

async function cachedGlobalSkills() {
  if (globalListCache && globalListCache.expiresAt > Date.now()) return globalListCache.value;
  const value = await listGlobalSkills();
  globalListCache = { value, expiresAt: Date.now() + LIST_TTL_MS };
  return value;
}

function knownCwds(manager: SessionManager): Set<string> {
  return new Set(manager.list().map((session) => path.resolve(session.cwd)));
}

function normalizeCwd(raw: string | undefined): string | undefined {
  if (!raw?.trim()) return undefined;
  if (!path.isAbsolute(raw)) return undefined;
  return path.resolve(raw);
}

function validateKnownCwd(manager: SessionManager, cwd: string | undefined): string | undefined {
  const normalized = normalizeCwd(cwd);
  if (!normalized) return undefined;
  return knownCwds(manager).has(normalized) ? normalized : undefined;
}

function startSkillOp(params: {
  kind: "add" | "update";
  target: string;
  cwd?: string;
  args: string[];
  deps: Deps;
}): string {
  const opId = randomUUID();
  invalidateSkillsCache(params.cwd);
  const child = streamNpx(
    "skills",
    params.args,
    ({ line }) => {
      params.deps.broadcast({
        type: "extension_op_progress",
        opId,
        kind: params.kind,
        target: params.target,
        line,
      });
    },
    { cwd: params.cwd },
  );

  child.done
    .then(({ exitCode }) => {
      invalidateSkillsCache(params.cwd);
      params.deps.broadcast({
        type: "extension_op_done",
        opId,
        success: exitCode === 0,
        error: exitCode === 0 ? undefined : `skills exited with code ${exitCode}`,
      });
    })
    .catch((error: unknown) => {
      invalidateSkillsCache(params.cwd);
      params.deps.broadcast({
        type: "extension_op_done",
        opId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });

  return opId;
}

export function registerSkillsRoutes(app: FastifyInstance, deps: Deps): void {
  app.get<{ Querystring: { cwd?: string } }>("/api/extensions/skills", async (req, reply) => {
    const cwd = normalizeCwd(req.query.cwd);
    if (req.query.cwd && !cwd) {
      reply.code(400);
      return { error: "absolute cwd required" };
    }
    try {
      const [repo, global] = await Promise.all([
        cwd ? cachedRepoSkills(cwd) : Promise.resolve([]),
        cachedGlobalSkills(),
      ]);
      return cwd ? { repo, global } : { global };
    } catch (error) {
      reply.code(500);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.get<{ Querystring: { q?: string } }>("/api/extensions/skills/search", async (req, reply) => {
    const q = req.query.q?.trim();
    if (!q) {
      reply.code(400);
      return { error: "q required" };
    }
    try {
      const args = ["find", q, ...(FIND_SUPPORTS_JSON ? ["--json"] : [])];
      const result = await runNpx("skills", args, { allowNonZero: true });
      if (result.exitCode !== 0) {
        reply.code(502);
        return {
          error: result.stderr || result.stdout || `skills exited with code ${result.exitCode}`,
        };
      }
      return { results: parseSkillsFind(result.stdout) };
    } catch (error) {
      reply.code(500);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  app.post<{ Body: { pkg?: string; scope?: "repo" | "global"; cwd?: string } }>(
    "/api/extensions/skills",
    async (req, reply) => {
      const pkg = req.body?.pkg?.trim();
      const scope = req.body?.scope;
      if (!pkg) {
        reply.code(400);
        return { error: "pkg required" };
      }
      if (scope !== "repo" && scope !== "global") {
        reply.code(400);
        return { error: "scope must be repo or global" };
      }

      const cwd =
        scope === "repo"
          ? validateKnownCwd(deps.manager, req.body.cwd)
          : normalizeCwd(req.body.cwd);
      if (scope === "repo" && !cwd) {
        reply.code(400);
        return { error: "known cwd required for repo skill install" };
      }
      const args = ["add", pkg, ...(scope === "global" ? ["-g"] : []), "-y"];
      return { opId: startSkillOp({ kind: "add", target: pkg, cwd, args, deps }) };
    },
  );

  app.post<{ Querystring: { cwd?: string } }>(
    "/api/extensions/skills/update",
    async (req, reply) => {
      const requestedCwd = req.query.cwd;
      const cwd = requestedCwd ? validateKnownCwd(deps.manager, requestedCwd) : undefined;
      if (requestedCwd && !cwd) {
        reply.code(400);
        return { error: "known cwd required for repo skill update" };
      }
      const args = cwd ? ["update", "-p", "-y"] : ["update", "-g", "-y"];
      return { opId: startSkillOp({ kind: "update", target: cwd ?? "global", cwd, args, deps }) };
    },
  );

  app.delete<{
    Params: { name: string };
    Querystring: { scope?: "repo" | "global"; cwd?: string };
  }>("/api/extensions/skills/:name", async (req, reply) => {
    const name = req.params.name?.trim();
    const scope = req.query.scope;
    if (!name) {
      reply.code(400);
      return { error: "name required" };
    }
    if (scope !== "repo" && scope !== "global") {
      reply.code(400);
      return { error: "scope must be repo or global" };
    }

    try {
      if (scope === "repo") {
        const cwd = validateKnownCwd(deps.manager, req.query.cwd);
        if (!cwd) {
          reply.code(400);
          return { error: "known cwd required for repo skill remove" };
        }
        await removeRepoSkill(cwd, name);
        invalidateSkillsCache(cwd);
      } else {
        await removeGlobalSkill(name);
        invalidateSkillsCache();
      }
      return { ok: true };
    } catch (error) {
      reply.code(500);
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });
}
