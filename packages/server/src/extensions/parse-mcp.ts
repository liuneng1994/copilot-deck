import type { ExtensionScope, McpServer, McpTransport } from "@agent-view/shared";

interface RawMcpConfig {
  type?: unknown;
  transport?: unknown;
  command?: unknown;
  args?: unknown;
  url?: unknown;
  env?: unknown;
  headers?: unknown;
  tools?: unknown;
  timeout?: unknown;
  timeoutMs?: unknown;
  source?: unknown;
  pluginName?: unknown;
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

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function toolsString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value.filter((item): item is string => typeof item === "string").join(",");
  return undefined;
}

function transportFrom(value: unknown): McpTransport {
  if (value === "http" || value === "sse" || value === "stdio") return value;
  if (value === "local") return "stdio";
  return "stdio";
}

function scopeFrom(value: unknown, fallback: ExtensionScope): ExtensionScope {
  if (value === "workspace" || value === "plugin" || value === "user") return value;
  return fallback;
}

function timeoutFrom(config: RawMcpConfig): number | undefined {
  const value = config.timeoutMs ?? config.timeout;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function serverFromConfig(
  name: string,
  config: RawMcpConfig,
  defaultScope: ExtensionScope,
): McpServer {
  const scope = scopeFrom(config.source, defaultScope);
  const server: McpServer = {
    name,
    transport: transportFrom(config.transport ?? config.type),
    scope,
  };
  if (typeof config.command === "string") server.command = config.command;
  const args = stringArray(config.args);
  if (args) server.args = args;
  if (typeof config.url === "string") server.url = config.url;
  const env = stringRecord(config.env);
  if (env) server.env = env;
  const headers = stringRecord(config.headers);
  if (headers) server.headers = headers;
  const tools = toolsString(config.tools);
  if (tools !== undefined) server.tools = tools;
  const timeoutMs = timeoutFrom(config);
  if (timeoutMs !== undefined) server.timeoutMs = timeoutMs;
  if (typeof config.pluginName === "string") server.pluginName = config.pluginName;
  if (scope === "plugin") server.readOnly = true;
  return server;
}

function parseJsonServers(stdout: string, defaultScope: ExtensionScope): McpServer[] | undefined {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    const root = isRecord(parsed) && isRecord(parsed.mcpServers) ? parsed.mcpServers : parsed;
    if (!isRecord(root)) return undefined;
    return Object.entries(root)
      .filter((entry): entry is [string, RawMcpConfig] => isRecord(entry[1]))
      .map(([name, config]) => serverFromConfig(name, config, defaultScope));
  } catch {
    return undefined;
  }
}

/**
 * Parses `copilot mcp list --json`:
 * `{ "mcpServers": { "fake": { "type": "local", "command": "node", "args": ["-e", "..."], "source": "user" } } }`
 * Falls back to text such as:
 * `User servers:\n  fake-test (local)`.
 */
export function parseMcpList(stdout: string, defaultScope: ExtensionScope): McpServer[] {
  const json = parseJsonServers(stdout, defaultScope);
  if (json) return json;

  const servers: McpServer[] = [];
  let scope = defaultScope;
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = /^(User|Workspace|Plugin|Builtin) servers:?$/i.exec(line);
    if (heading) {
      const source = heading[1].toLowerCase();
      scope =
        source === "workspace"
          ? "workspace"
          : source === "plugin" || source === "builtin"
            ? "plugin"
            : "user";
      continue;
    }
    const match = /^([^()]+?)\s*\(([^)]+)\)/.exec(line);
    if (!match) continue;
    const serverScope = scope === "plugin" ? "plugin" : scope;
    servers.push({
      name: match[1].trim(),
      transport: transportFrom(match[2].trim()),
      scope: serverScope,
      readOnly: serverScope === "plugin" ? true : undefined,
    });
  }
  return servers;
}

function envCountFrom(line: string): Record<string, string> | undefined {
  const count = /Environment(?: variables)?:\s*(\d+)/i.exec(line)?.[1];
  if (!count || Number(count) <= 0) return undefined;
  return { __count: count };
}

/**
 * Parses `copilot mcp get <name> --json` when available, or text like:
 * `fake-test\n  Type: local\n  Command: node -e console.log('hi')\n  Tools: * (all)\n  Source: User`.
 */
export function parseMcpGet(stdout: string): Partial<McpServer> {
  const json = parseJsonServers(stdout, "user");
  if (json?.[0]) return json[0];

  const server: Partial<McpServer> = {};
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.includes(":")) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "type" || key === "transport") server.transport = transportFrom(value);
    else if (key === "command") {
      const parts = value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
      server.command = parts[0];
      server.args = parts.slice(1).map((part) => part.replace(/^(["'])(.*)\1$/, "$2"));
    } else if (key === "url") server.url = value;
    else if (key === "tools") server.tools = value.replace(/\s*\(.*\)$/, "");
    else if (key === "timeout") {
      const parsed = Number(value.replace(/\D+$/g, ""));
      if (Number.isFinite(parsed)) server.timeoutMs = parsed;
    } else if (key === "source") server.scope = scopeFrom(value.toLowerCase(), "user");
    else if (key === "headers") server.headers = envCountFrom(line);
    else if (key === "environment" || key === "environment variables")
      server.env = envCountFrom(line);
  }
  if (server.scope === "plugin") server.readOnly = true;
  return server;
}
