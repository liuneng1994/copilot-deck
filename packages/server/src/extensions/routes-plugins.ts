import { randomUUID } from "node:crypto";
import type {
  MarketplaceInfo,
  MarketplacePlugin,
  PluginInfo,
  ServerToClient,
} from "@agent-view/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { runCopilot, streamCopilot } from "./cli.js";
import { parseMarketplaceBrowse, parseMarketplaceList, parsePluginList } from "./parse-plugins.js";

interface Deps {
  broadcast: (msg: ServerToClient) => void;
}

type CacheValue = PluginInfo[] | MarketplaceInfo[] | MarketplacePlugin[];

const CACHE_TTL_MS = 30_000;
const UNKNOWN_JSON_OPTION_RE = /unknown option ['"]?--json['"]?/i;

const cache = new Map<string, { at: number; value: CacheValue }>();

const getCached = <T extends CacheValue>(key: string): T | undefined => {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_TTL_MS) return undefined;
  return hit.value as T;
};

const setCached = (key: string, value: CacheValue) => {
  cache.set(key, { at: Date.now(), value });
};

const invalidate = (prefix: string) => {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
};

export function invalidatePluginCache(): void {
  invalidate("plugins:");
}

export function invalidateMarketplaceCache(): void {
  invalidate("marketplaces:");
  invalidate("marketplace:");
}

function badRequest(reply: FastifyReply, error: string) {
  reply.code(400);
  return { error };
}

function serverError(reply: FastifyReply, error: string) {
  reply.code(500);
  return { error };
}

function asText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonArray<T>(
  stdout: string,
  mapItem: (item: unknown) => T | undefined,
): T[] | undefined {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    const root = isRecord(parsed) ? parsed : undefined;
    const items = Array.isArray(parsed)
      ? parsed
      : Array.isArray(root?.items)
        ? root.items
        : Array.isArray(root?.plugins)
          ? root.plugins
          : Array.isArray(root?.marketplaces)
            ? root.marketplaces
            : undefined;
    if (!items) return undefined;
    return items.map(mapItem).filter((item): item is T => item !== undefined);
  } catch {
    return undefined;
  }
}

function pluginFromJson(item: unknown): PluginInfo | undefined {
  if (!isRecord(item) || typeof item.name !== "string") return undefined;
  return {
    name: item.name,
    version: typeof item.version === "string" ? item.version : undefined,
    description: typeof item.description === "string" ? item.description : undefined,
    source: typeof item.source === "string" ? item.source : undefined,
    marketplace: typeof item.marketplace === "string" ? item.marketplace : undefined,
    capabilities: isRecord(item.capabilities) ? item.capabilities : undefined,
  };
}

function marketplaceFromJson(item: unknown): MarketplaceInfo | undefined {
  if (!isRecord(item) || typeof item.name !== "string") return undefined;
  const source = typeof item.source === "string" ? item.source : item.repository;
  if (typeof source !== "string") return undefined;
  return { name: item.name, source, builtin: Boolean(item.builtin ?? item.included) };
}

function marketplacePluginFromJson(marketplace: string) {
  return (item: unknown): MarketplacePlugin | undefined => {
    if (!isRecord(item) || typeof item.name !== "string") return undefined;
    return {
      name: item.name,
      description: typeof item.description === "string" ? item.description : undefined,
      marketplace,
    };
  };
}

export function registerPluginRoutes(app: FastifyInstance, deps: Deps): void {
  const { broadcast } = deps;
  const aborts = new Map<string, () => void>();

  const runJsonOrText = async <T extends CacheValue>(
    args: string[],
    parseText: (stdout: string) => T,
    parseJson: (stdout: string) => T | undefined,
  ): Promise<T> => {
    const jsonResult = await runCopilot([...args, "--json"], { allowNonZero: true });
    const jsonOutput = `${jsonResult.stdout}\n${jsonResult.stderr}`;
    if (jsonResult.exitCode === 0) {
      const parsed = parseJson(jsonResult.stdout);
      if (parsed) return parsed;
    } else if (!UNKNOWN_JSON_OPTION_RE.test(jsonOutput)) {
      throw new Error(jsonOutput.trim() || `copilot ${args.join(" ")} failed`);
    }

    const textResult = await runCopilot(args);
    return parseText(textResult.stdout);
  };

  const startStream = (
    args: string[],
    kind: "install" | "uninstall" | "update" | "add" | "remove",
    target: string,
    onDone?: () => void,
  ) => {
    const opId = randomUUID();
    const { abort, done } = streamCopilot(args, ({ line }) => {
      broadcast({ type: "extension_op_progress", opId, kind, target, line });
    });
    aborts.set(opId, abort);
    done
      .then(({ exitCode }) => {
        if (exitCode === 0) onDone?.();
        broadcast({ type: "extension_op_done", opId, success: exitCode === 0 });
      })
      .catch((error: unknown) => {
        broadcast({ type: "extension_op_done", opId, success: false, error: asText(error) });
      })
      .finally(() => {
        aborts.delete(opId);
      });
    return { opId };
  };

  const listPlugins = async (): Promise<PluginInfo[]> => {
    const key = "plugins:list";
    const cached = getCached<PluginInfo[]>(key);
    if (cached) return cached;
    const plugins = await runJsonOrText(["plugin", "list"], parsePluginList, (stdout) =>
      parseJsonArray(stdout, pluginFromJson),
    );
    setCached(key, plugins);
    return plugins;
  };

  const listMarketplaces = async (): Promise<MarketplaceInfo[]> => {
    const key = "marketplaces:list";
    const cached = getCached<MarketplaceInfo[]>(key);
    if (cached) return cached;
    const marketplaces = await runJsonOrText(
      ["plugin", "marketplace", "list"],
      parseMarketplaceList,
      (stdout) => parseJsonArray(stdout, marketplaceFromJson),
    );
    setCached(key, marketplaces);
    return marketplaces;
  };

  app.get("/api/extensions/plugins", async (_req, reply) => {
    try {
      return { plugins: await listPlugins() };
    } catch (error) {
      return serverError(reply, asText(error));
    }
  });

  app.post<{ Body: { source?: string } }>("/api/extensions/plugins", async (req, reply) => {
    const source = typeof req.body?.source === "string" ? req.body.source.trim() : "";
    if (!source) return badRequest(reply, "source required");
    return startStream(["plugin", "install", source], "install", source, () =>
      invalidate("plugins:"),
    );
  });

  app.delete<{ Params: { name: string } }>("/api/extensions/plugins/:name", async (req, reply) => {
    const name = req.params.name?.trim();
    if (!name) return badRequest(reply, "name required");
    try {
      await runCopilot(["plugin", "uninstall", name]);
      invalidate("plugins:");
      return { ok: true };
    } catch (error) {
      return serverError(reply, asText(error));
    }
  });

  app.post<{ Params: { name: string } }>(
    "/api/extensions/plugins/:name/update",
    async (req, reply) => {
      const name = req.params.name?.trim();
      if (!name) return badRequest(reply, "name required");
      return startStream(["plugin", "update", name], "update", name, () => invalidate("plugins:"));
    },
  );

  app.post("/api/extensions/plugins/update-all", async () =>
    startStream(["plugin", "update"], "update", "all", () => invalidate("plugins:")),
  );

  app.get("/api/extensions/plugin-marketplaces", async (_req, reply) => {
    try {
      return { marketplaces: await listMarketplaces() };
    } catch (error) {
      return serverError(reply, asText(error));
    }
  });

  app.post<{ Body: { source?: string } }>(
    "/api/extensions/plugin-marketplaces",
    async (req, reply) => {
      const source = typeof req.body?.source === "string" ? req.body.source.trim() : "";
      if (!source) return badRequest(reply, "source required");
      try {
        await runCopilot(["plugin", "marketplace", "add", source]);
        invalidate("marketplaces:");
        return { marketplaces: await listMarketplaces() };
      } catch (error) {
        return serverError(reply, asText(error));
      }
    },
  );

  app.delete<{ Params: { name: string } }>(
    "/api/extensions/plugin-marketplaces/:name",
    async (req, reply) => {
      const name = req.params.name?.trim();
      if (!name) return badRequest(reply, "name required");
      try {
        await runCopilot(["plugin", "marketplace", "remove", name]);
        invalidate("marketplaces:");
        return { ok: true };
      } catch (error) {
        return serverError(reply, asText(error));
      }
    },
  );

  app.post<{ Params: { name: string } }>(
    "/api/extensions/plugin-marketplaces/:name/update",
    async (req, reply) => {
      const name = req.params.name?.trim();
      if (!name) return badRequest(reply, "name required");
      return startStream(["plugin", "marketplace", "update", name], "update", name, () => {
        invalidate("marketplaces:");
        invalidate(`marketplace:${name}:`);
      });
    },
  );

  app.get<{ Params: { name: string } }>(
    "/api/extensions/plugin-marketplaces/:name/browse",
    async (req, reply) => {
      const name = req.params.name?.trim();
      if (!name) return badRequest(reply, "name required");
      const key = `marketplace:${name}:browse`;
      const cached = getCached<MarketplacePlugin[]>(key);
      if (cached) return { plugins: cached };
      try {
        const plugins = await runJsonOrText(
          ["plugin", "marketplace", "browse", name],
          (stdout) => parseMarketplaceBrowse(stdout, name),
          (stdout) => parseJsonArray(stdout, marketplacePluginFromJson(name)),
        );
        setCached(key, plugins);
        return { plugins };
      } catch (error) {
        return serverError(reply, asText(error));
      }
    },
  );
}
