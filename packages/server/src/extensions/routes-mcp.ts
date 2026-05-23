import path from "node:path";
import type { ExtensionScope, McpServer, McpTransport } from "@agent-view/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { runCopilot } from "./cli.js";
import { parseMcpGet, parseMcpList } from "./parse-mcp.js";
import { readWorkspaceMcp, removeWorkspaceMcp, writeWorkspaceMcp } from "./workspace-mcp.js";

interface SessionLister {
  list(): { cwd: string }[];
}

interface Deps {
  manager: SessionLister;
}

type ScopeQuery = ExtensionScope | "all";

interface McpBody {
  name?: unknown;
  transport?: unknown;
  command?: unknown;
  args?: unknown;
  url?: unknown;
  env?: unknown;
  headers?: unknown;
  tools?: unknown;
  timeoutMs?: unknown;
  timeout?: unknown;
  scope?: unknown;
  cwd?: unknown;
}

const USER_LIST_TTL_MS = 30_000;
let userCache: { expiresAt: number; servers: McpServer[] } | undefined;

function error(reply: FastifyReply, code: number, message: string) {
  reply.code(code);
  return { error: message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function knownCwds(manager: SessionLister): Set<string> {
  return new Set(manager.list().map((session) => session.cwd));
}

function validateWorkspaceCwd(cwd: string | undefined, manager: SessionLister): string | undefined {
  if (!cwd || !path.isAbsolute(cwd)) return undefined;
  const normalized = path.normalize(cwd);
  return knownCwds(manager).has(normalized) ? normalized : undefined;
}

function queryScope(scope: unknown): ScopeQuery {
  return scope === "workspace" || scope === "plugin" || scope === "all" ? scope : "user";
}

async function listUserMcp(): Promise<McpServer[]> {
  const now = Date.now();
  if (userCache && userCache.expiresAt > now) return userCache.servers;
  const result = await runCopilot(["mcp", "list", "--json"]);
  const servers = parseMcpList(result.stdout, "user").map((server) => ({
    ...server,
    scope: "user" as const,
  }));
  userCache = { expiresAt: now + USER_LIST_TTL_MS, servers };
  return servers;
}

export function invalidateMcpUserCache(): void {
  userCache = undefined;
}

function mcpAddArgs(server: McpServer): string[] {
  const args = ["mcp", "add", "--json"];
  if (server.transport !== "stdio") args.push("--transport", server.transport);
  if (server.tools !== undefined) args.push("--tools", server.tools);
  if (server.timeoutMs !== undefined) args.push("--timeout", String(server.timeoutMs));
  for (const [key, value] of Object.entries(server.env ?? {}))
    args.push("--env", `${key}=${value}`);
  for (const [key, value] of Object.entries(server.headers ?? {}))
    args.push("--header", `${key}: ${value}`);

  if (server.transport === "stdio") {
    if (!server.command) throw new Error("command required for stdio transport");
    args.push(server.name, "--", server.command, ...(server.args ?? []));
  } else {
    if (!server.url) throw new Error("url required for remote transport");
    args.push(server.name, server.url);
  }
  return args;
}

function bodyToServer(body: McpBody): McpServer {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const transport =
    body.transport === "http" || body.transport === "sse" ? body.transport : "stdio";
  const scope = body.scope === "workspace" || body.scope === "plugin" ? body.scope : "user";
  const server: McpServer = { name, transport, scope };
  if (typeof body.command === "string") server.command = body.command;
  if (Array.isArray(body.args))
    server.args = body.args.filter((item): item is string => typeof item === "string");
  if (typeof body.url === "string") server.url = body.url;
  const env = stringRecord(body.env);
  if (env) server.env = env;
  const headers = stringRecord(body.headers);
  if (headers) server.headers = headers;
  if (typeof body.tools === "string") server.tools = body.tools;
  const timeout = body.timeoutMs ?? body.timeout;
  if (typeof timeout === "number" && Number.isFinite(timeout)) server.timeoutMs = timeout;
  if (typeof body.cwd === "string") server.cwd = body.cwd;
  return server;
}

function assertValidServer(server: McpServer): string | undefined {
  if (!server.name) return "name required";
  if (!/^[A-Za-z0-9._-]+$/.test(server.name)) return "name contains invalid characters";
  if (server.transport === "stdio" && !server.command)
    return "command required for stdio transport";
  if (server.transport !== "stdio" && !server.url) return "url required for remote transport";
  return undefined;
}

async function getServer(
  name: string,
  scope: ScopeQuery,
  cwd: string | undefined,
  manager: SessionLister,
) {
  if (scope === "workspace") {
    const workspaceCwd = validateWorkspaceCwd(cwd, manager);
    if (!workspaceCwd) return undefined;
    return (await readWorkspaceMcp(workspaceCwd)).find((server) => server.name === name);
  }
  if (scope === "all") {
    const servers = [...(await listUserMcp())];
    for (const sessionCwd of knownCwds(manager))
      servers.push(...(await readWorkspaceMcp(sessionCwd)));
    return servers.find((server) => server.name === name);
  }
  if (scope === "plugin") return undefined;
  const result = await runCopilot(["mcp", "get", name, "--json"]);
  return { name, ...parseMcpGet(result.stdout), scope: "user" as const } as McpServer;
}

export function registerMcpRoutes(app: FastifyInstance, deps: Deps): void {
  const { manager } = deps;

  app.get<{ Querystring: { scope?: string; cwd?: string } }>(
    "/api/extensions/mcp",
    async (req, reply) => {
      const scope = queryScope(req.query.scope);
      if (scope === "plugin") return { servers: [] };

      try {
        if (scope === "workspace") {
          const cwd = validateWorkspaceCwd(req.query.cwd, manager);
          if (!req.query.cwd || !path.isAbsolute(req.query.cwd))
            return error(reply, 400, "absolute cwd required");
          if (!cwd) return error(reply, 400, "cwd must be a known session cwd");
          return { servers: await readWorkspaceMcp(cwd) };
        }

        const servers = [...(await listUserMcp())];
        if (scope === "all") {
          for (const cwd of knownCwds(manager)) servers.push(...(await readWorkspaceMcp(cwd)));
          // TODO: surface plugin-embedded MCP servers as read-only once the CLI exposes source filtering.
        }
        return { servers };
      } catch (err) {
        return error(reply, 500, err instanceof Error ? err.message : String(err));
      }
    },
  );

  app.post<{ Body: McpBody }>("/api/extensions/mcp", async (req, reply) => {
    const server = bodyToServer(req.body ?? {});
    const validationError = assertValidServer(server);
    if (validationError) return error(reply, 400, validationError);
    if (server.scope === "plugin") return error(reply, 403, "plugin MCP servers are read-only");

    try {
      if (server.scope === "workspace") {
        const cwd = validateWorkspaceCwd(server.cwd, manager);
        if (!server.cwd || !path.isAbsolute(server.cwd))
          return error(reply, 400, "absolute cwd required");
        if (!cwd) return error(reply, 400, "cwd must be a known session cwd");
        const workspaceServer = { ...server, cwd, scope: "workspace" as const };
        await writeWorkspaceMcp(cwd, server.name, workspaceServer);
        return { server: workspaceServer };
      }

      const result = await runCopilot(mcpAddArgs(server));
      invalidateMcpUserCache();
      const added =
        parseMcpList(result.stdout, "user").find((item) => item.name === server.name) ?? server;
      return { server: { ...added, name: server.name, scope: "user" as const } };
    } catch (err) {
      return error(reply, 500, err instanceof Error ? err.message : String(err));
    }
  });

  app.get<{ Params: { name: string }; Querystring: { scope?: string; cwd?: string } }>(
    "/api/extensions/mcp/:name",
    async (req, reply) => {
      const scope = queryScope(req.query.scope);
      if (scope === "plugin") return error(reply, 403, "plugin MCP servers are read-only");
      try {
        if (scope === "workspace") {
          if (!req.query.cwd || !path.isAbsolute(req.query.cwd))
            return error(reply, 400, "absolute cwd required");
          if (!validateWorkspaceCwd(req.query.cwd, manager))
            return error(reply, 400, "cwd must be a known session cwd");
        }
        const server = await getServer(req.params.name, scope, req.query.cwd, manager);
        if (!server) return error(reply, 404, "MCP server not found");
        return { server };
      } catch (err) {
        return error(reply, 500, err instanceof Error ? err.message : String(err));
      }
    },
  );

  app.delete<{ Params: { name: string }; Querystring: { scope?: string; cwd?: string } }>(
    "/api/extensions/mcp/:name",
    async (req, reply) => {
      const scope = queryScope(req.query.scope);
      if (scope === "plugin") return error(reply, 403, "plugin MCP servers are read-only");
      try {
        if (scope === "workspace") {
          const cwd = validateWorkspaceCwd(req.query.cwd, manager);
          if (!req.query.cwd || !path.isAbsolute(req.query.cwd))
            return error(reply, 400, "absolute cwd required");
          if (!cwd) return error(reply, 400, "cwd must be a known session cwd");
          await removeWorkspaceMcp(cwd, req.params.name);
          return { ok: true };
        }
        await runCopilot(["mcp", "remove", req.params.name]);
        invalidateMcpUserCache();
        return { ok: true };
      } catch (err) {
        return error(reply, 500, err instanceof Error ? err.message : String(err));
      }
    },
  );
}
