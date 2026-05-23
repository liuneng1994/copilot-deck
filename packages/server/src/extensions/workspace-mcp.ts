import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { McpServer, McpTransport } from "@agent-view/shared";

interface WorkspaceMcpConfig {
  mcpServers?: Record<string, WorkspaceMcpServer>;
  [key: string]: unknown;
}

type WorkspaceMcpServer = {
  command?: string;
  args?: string[];
  url?: string;
  transport?: McpTransport;
  type?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  tools?: string | string[];
  timeout?: number;
  timeoutMs?: number;
  [key: string]: unknown;
};

function workspacePath(cwd: string): string {
  return path.join(cwd, ".mcp.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function transportFrom(value: unknown): McpTransport {
  if (value === "http" || value === "sse" || value === "stdio") return value;
  if (value === "local") return "stdio";
  return "stdio";
}

function toolsString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === "string").join(",");
  return undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

async function readConfig(cwd: string): Promise<WorkspaceMcpConfig> {
  try {
    const text = await fs.readFile(workspacePath(cwd), "utf8");
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return {};
    throw error;
  }
}

function toServer(name: string, config: WorkspaceMcpServer, cwd: string): McpServer {
  const server: McpServer = {
    name,
    transport: transportFrom(config.transport ?? config.type),
    scope: "workspace",
    cwd,
  };
  if (typeof config.command === "string") server.command = config.command;
  if (Array.isArray(config.args))
    server.args = config.args.filter((item): item is string => typeof item === "string");
  if (typeof config.url === "string") server.url = config.url;
  const env = stringRecord(config.env);
  if (env) server.env = env;
  const headers = stringRecord(config.headers);
  if (headers) server.headers = headers;
  const tools = toolsString(config.tools);
  if (tools !== undefined) server.tools = tools;
  const timeout = config.timeoutMs ?? config.timeout;
  if (typeof timeout === "number" && Number.isFinite(timeout)) server.timeoutMs = timeout;
  return server;
}

function fromServer(server: McpServer): WorkspaceMcpServer {
  const config: WorkspaceMcpServer = { transport: server.transport };
  if (server.command !== undefined) config.command = server.command;
  if (server.args !== undefined) config.args = server.args;
  if (server.url !== undefined) config.url = server.url;
  if (server.env !== undefined) config.env = server.env;
  if (server.headers !== undefined) config.headers = server.headers;
  if (server.tools !== undefined) config.tools = server.tools;
  if (server.timeoutMs !== undefined) config.timeout = server.timeoutMs;
  return config;
}

export async function readWorkspaceMcp(cwd: string): Promise<McpServer[]> {
  const config = await readConfig(cwd);
  const servers = isRecord(config.mcpServers) ? config.mcpServers : {};
  return Object.entries(servers)
    .filter((entry): entry is [string, WorkspaceMcpServer] => isRecord(entry[1]))
    .map(([name, server]) => toServer(name, server, cwd));
}

async function writeConfigAtomic(cwd: string, config: WorkspaceMcpConfig): Promise<void> {
  const file = workspacePath(cwd);
  const tmp = path.join(cwd, `.mcp.json.${process.pid}.${randomUUID()}.tmp`);
  await fs.writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await fs.rename(tmp, file);
}

export async function writeWorkspaceMcp(
  cwd: string,
  name: string,
  server: McpServer,
): Promise<void> {
  const config = await readConfig(cwd);
  const mcpServers = isRecord(config.mcpServers) ? { ...config.mcpServers } : {};
  mcpServers[name] = fromServer(server);
  await writeConfigAtomic(cwd, { ...config, mcpServers });
}

export async function removeWorkspaceMcp(cwd: string, name: string): Promise<void> {
  const config = await readConfig(cwd);
  const mcpServers = isRecord(config.mcpServers) ? { ...config.mcpServers } : {};
  delete mcpServers[name];
  await writeConfigAtomic(cwd, { ...config, mcpServers });
}
