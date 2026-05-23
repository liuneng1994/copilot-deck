import type { MarketplaceInfo, MarketplacePlugin, PluginInfo } from "@agent-view/shared";

const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, "g");

function clean(stdout: string): string[] {
  return stdout
    .replace(ANSI_RE, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function stripBullet(line: string): string {
  return line.replace(/^[•◆*-]\s*/, "").trim();
}

function parseCount(line: string, words: string[]): number | undefined {
  const pattern = new RegExp(
    `(?:${words.join("|")})\\D+(\\d+)|(\\d+)\\s*(?:${words.join("|")})`,
    "i",
  );
  const match = line.match(pattern);
  if (!match) return undefined;
  const raw = match[1] ?? match[2];
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Parses current `copilot plugin list` text output.
 *
 * Empty sample:
 *   No plugins installed.
 *
 * Populated sample:
 *   Installed plugins:
 *     • spark@copilot-plugins (v1.0.0)
 */
export function parsePluginList(stdout: string): PluginInfo[] {
  const lines = clean(stdout);
  if (lines.some((line) => /^no plugins installed\.?$/i.test(line))) return [];

  const plugins: PluginInfo[] = [];
  for (const rawLine of lines) {
    if (/^(installed plugins|use 'copilot plugin install)/i.test(rawLine)) continue;
    const line = stripBullet(rawLine);
    if (!line || line === rawLine) continue;

    const match = line.match(/^([^\s(]+)(?:\s+\(([^)]*)\))?(?:\s+-\s+(.+))?$/);
    if (!match) continue;

    const token = match[1];
    const versionText = match[2]?.trim();
    const description = match[3]?.trim();
    const at = token.lastIndexOf("@");
    const plugin: PluginInfo = {
      name: at > 0 ? token.slice(0, at) : token,
    };
    if (at > 0) {
      plugin.marketplace = token.slice(at + 1);
      plugin.source = plugin.marketplace;
    }
    if (versionText) plugin.version = versionText.replace(/^version\s+/i, "");
    if (description) plugin.description = description;
    plugins.push(plugin);
  }
  return plugins;
}

/**
 * Parses defensive detail output for a future `copilot plugin get <name>` command.
 * Targeted formats include labeled text such as:
 *   Name: spark
 *   Version: v1.0.0
 *   Skills: 2
 *   MCP servers: 1
 */
export function parsePluginGet(stdout: string): Partial<PluginInfo> {
  const lines = clean(stdout);
  const plugin: Partial<PluginInfo> = {};
  const capabilities: NonNullable<PluginInfo["capabilities"]> = {};

  for (const line of lines) {
    const label = line.match(/^([\w -]+):\s*(.+)$/);
    if (label) {
      const key = label[1].toLowerCase();
      const value = label[2].trim();
      if (key === "name") plugin.name = value;
      else if (key === "version") plugin.version = value;
      else if (key === "description") plugin.description = value;
      else if (key === "source") plugin.source = value;
      else if (key === "marketplace") plugin.marketplace = value;
    }

    const skills = parseCount(line, ["skills?", "skill"]);
    const agents = parseCount(line, ["agents?", "agent"]);
    const mcpServers = parseCount(line, ["mcp servers?", "mcp"]);
    const hooks = parseCount(line, ["hooks?", "hook"]);
    const lspServers = parseCount(line, ["lsp servers?", "lsp"]);
    if (skills !== undefined) capabilities.skills = skills;
    if (agents !== undefined) capabilities.agents = agents;
    if (mcpServers !== undefined) capabilities.mcpServers = mcpServers;
    if (hooks !== undefined) capabilities.hooks = hooks;
    if (lspServers !== undefined) capabilities.lspServers = lspServers;
  }

  if (Object.keys(capabilities).length > 0) plugin.capabilities = capabilities;
  return plugin;
}

/**
 * Parses `copilot plugin marketplace list` text output.
 *
 * Sample:
 *   ✨ Included with GitHub Copilot:
 *     ◆ copilot-plugins (GitHub: github/copilot-plugins)
 *     ◆ awesome-copilot (GitHub: github/awesome-copilot)
 */
export function parseMarketplaceList(stdout: string): MarketplaceInfo[] {
  const lines = clean(stdout);
  const marketplaces: MarketplaceInfo[] = [];
  let builtin = false;

  for (const rawLine of lines) {
    if (/included with github copilot/i.test(rawLine)) {
      builtin = true;
      continue;
    }
    if (/^(registered|custom|added) marketplaces/i.test(rawLine)) {
      builtin = false;
      continue;
    }

    const line = stripBullet(rawLine);
    if (!line || line === rawLine) continue;
    const match = line.match(/^([^\s(]+)\s+\((?:GitHub:\s*)?([^)]+)\)$/i);
    if (!match) continue;
    marketplaces.push({ name: match[1], source: match[2].trim(), builtin });
  }

  return marketplaces;
}

/**
 * Parses `copilot plugin marketplace browse <name>` text output.
 *
 * Sample:
 *   Plugins in "copilot-plugins":
 *     • workiq - WorkIQ plugin for GitHub Copilot.
 */
export function parseMarketplaceBrowse(stdout: string, marketplace: string): MarketplacePlugin[] {
  const lines = clean(stdout);
  const plugins: MarketplacePlugin[] = [];

  for (const rawLine of lines) {
    if (/^(plugins in|install with:)/i.test(rawLine)) continue;
    const line = stripBullet(rawLine);
    if (!line || line === rawLine) continue;
    const match = line.match(/^([^\s]+)(?:\s+-\s+(.+))?$/);
    if (!match) continue;
    plugins.push({
      name: match[1],
      description: match[2]?.trim(),
      marketplace,
    });
  }

  return plugins;
}
