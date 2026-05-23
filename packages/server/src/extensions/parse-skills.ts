export interface SkillSearchResult {
  name: string;
  source?: string;
  installs?: number;
  description?: string;
}

function trimYamlString(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

export function parseSkillFrontmatter(md: string): { name?: string; description?: string } {
  if (!md.startsWith("---")) return {};
  const firstLineEnd = md.indexOf("\n");
  if (firstLineEnd === -1) return {};
  const close = md.indexOf("\n---", firstLineEnd);
  if (close === -1) return {};

  const out: { name?: string; description?: string } = {};
  for (const line of md.slice(firstLineEnd + 1, close).split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (key !== "name" && key !== "description") continue;
    const value = trimYamlString(line.slice(idx + 1));
    if (value) out[key] = value;
  }
  return out;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.trim().replace(/,/g, "");
    const match = normalized.match(/^(\d+(?:\.\d+)?)([kKmM])?$/);
    if (!match) return undefined;
    const base = Number(match[1]);
    if (!Number.isFinite(base)) return undefined;
    const suffix = match[2]?.toLowerCase();
    return Math.round(base * (suffix === "m" ? 1_000_000 : suffix === "k" ? 1_000 : 1));
  }
  return undefined;
}

function normalizeJsonResult(value: unknown): SkillSearchResult | undefined {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const rawName =
    asString(rec.name) ?? asString(rec.skill) ?? asString(rec.id) ?? asString(rec.package);
  if (!rawName) return undefined;
  const source = asString(rec.source) ?? asString(rec.repository) ?? asString(rec.repo);
  const [splitSource, splitName] = rawName.includes("@")
    ? rawName.split("@", 2)
    : [undefined, rawName];
  return {
    name: splitName,
    source: source ?? splitSource,
    installs: asNumber(rec.installs) ?? asNumber(rec.installCount),
    description: asString(rec.description),
  };
}

function parseJson(stdout: string): SkillSearchResult[] | undefined {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const root = asRecord(parsed);
    const items = Array.isArray(parsed)
      ? parsed
      : Array.isArray(root?.results)
        ? root.results
        : Array.isArray(root?.skills)
          ? root.skills
          : Array.isArray(root?.data)
            ? root.data
            : [];
    return items.map(normalizeJsonResult).filter((x): x is SkillSearchResult => !!x);
  } catch {
    return undefined;
  }
}

/**
 * The observed `skills@1.5.7 find` help/search output does not advertise a
 * --json flag, so routes currently parse the stable text leaderboard format.
 */
export function parseSkillsFind(stdout: string): SkillSearchResult[] {
  const json = parseJson(stdout);
  if (json) return json;

  const results: SkillSearchResult[] = [];
  const ansiEscape = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  const lines = stdout
    .replace(ansiEscape, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(
      /^([^\s]+?)(?:\s+(\d[\d,.]*[kKmM]?)\s+installs?)?(?:\s+-\s*(.*))?$/i,
    );
    if (!match) continue;
    const packageId = match[1];
    if (!packageId.includes("@") || packageId.startsWith("http")) continue;
    const [source, name] = packageId.split("@", 2);
    if (!source || !name) continue;

    const next = lines[i + 1]?.replace(/^[└├│─\s]+/, "").trim();
    results.push({
      name,
      source,
      installs: asNumber(match[2]),
      description: match[3] || (next && !next.startsWith("http") ? next : undefined),
    });
  }

  return results;
}
