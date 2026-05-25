import { promises as fs } from "node:fs";
import path from "node:path";
import type { OutlineNode } from "@agent-view/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { listFiles } from "../file-index.js";
import { detectOutlineLanguage, getOutline } from "../outline/index.js";
import { PathSafetyError, assertWithinCwd } from "../path-safety.js";
import type { SessionManager } from "../session-manager.js";

interface Deps {
  manager: SessionManager;
}

interface WorkbenchSymbol {
  id: string;
  name: string;
  kind: string;
  path: string;
  startLine: number;
  endLine: number;
}

function sendError(reply: FastifyReply, statusCode: number, error: string): { error: string } {
  reply.code(statusCode);
  return { error };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
    return { error: errorMessage(err), statusCode: err instanceof PathSafetyError ? 403 : 500 };
  }
}

function parsePositiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function symbolKindAndName(node: OutlineNode): { kind: string; name: string } {
  const [kind, ...rest] = node.name.split(/\s+/);
  return {
    kind: rest.length > 0 ? kind : node.kind,
    name: rest.length > 0 ? rest.join(" ") : node.name,
  };
}

function flattenSymbols(nodes: OutlineNode[], relPath: string, out: WorkbenchSymbol[]): void {
  for (const node of nodes) {
    const { kind, name } = symbolKindAndName(node);
    const id = `${relPath}:${node.startLine}:${node.endLine}:${name}`;
    out.push({
      id,
      name,
      kind,
      path: relPath,
      startLine: node.startLine,
      endLine: node.endLine,
    });
    if (node.children) flattenSymbols(node.children, relPath, out);
  }
}

function symbolScore(symbol: WorkbenchSymbol, query: string): number | null {
  if (!query) return 0;
  const haystack = `${symbol.name} ${symbol.kind} ${symbol.path}`.toLowerCase();
  const q = query.toLowerCase();
  if (haystack.includes(q)) {
    let score = 50;
    if (symbol.name.toLowerCase().includes(q)) score += 50;
    if (symbol.name.toLowerCase().startsWith(q)) score += 25;
    return score - Math.floor(symbol.path.length / 50);
  }
  let cursor = 0;
  let score = 0;
  for (const ch of q) {
    const idx = haystack.indexOf(ch, cursor);
    if (idx < 0) return null;
    score += idx === cursor ? 4 : 1;
    cursor = idx + 1;
  }
  return score;
}

function baseNameWithoutExt(filePath: string): string {
  return path.basename(filePath).replace(/\.[^.]+$/, "");
}

function normalizeToken(value: string): string {
  return value
    .replace(/Test(s)?$|IT$/i, "")
    .replace(/[_\-.]?test$/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isTestPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const base = path.basename(normalized);
  return (
    normalized.includes("/test/") ||
    normalized.includes("/tests/") ||
    /\.test\.[jt]sx?$/.test(base) ||
    /\.spec\.[jt]sx?$/.test(base) ||
    /(^|[_\-.])test\.(cc|cpp|cxx|c|h|hpp)$/.test(base) ||
    /^test[_\-.]/.test(base) ||
    /(test|tests|it)\.java$/.test(base)
  );
}

async function detectValidationCommands(realCwd: string, testPath: string): Promise<string[]> {
  const base = baseNameWithoutExt(testPath);
  const commands: string[] = [];
  if (await exists(path.join(realCwd, "build.gradle"))) {
    commands.push(`./gradlew test --tests '*${base}*'`);
  }
  if (await exists(path.join(realCwd, "build.gradle.kts"))) {
    commands.push(`./gradlew test --tests '*${base}*'`);
  }
  if (await exists(path.join(realCwd, "pom.xml"))) {
    commands.push(`mvn test -Dtest=${base}`);
  }
  if (await exists(path.join(realCwd, "CMakeLists.txt"))) {
    commands.push(`ctest -R ${base.replace(/test/i, "") || base}`);
  }
  if (await exists(path.join(realCwd, "package.json"))) {
    commands.push(`pnpm test -- ${base}`);
  }
  return [...new Set(commands)];
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function registerWorkbenchRoutes(app: FastifyInstance, deps: Deps): void {
  app.get<{ Querystring: { cwd?: string; q?: string; limit?: string } }>(
    "/api/workbench/symbols",
    async (req, reply) => {
      const validated = await validateCwd(req.query.cwd, deps.manager);
      if ("error" in validated) return sendError(reply, validated.statusCode, validated.error);

      const query = req.query.q?.trim() ?? "";
      const limit = parsePositiveInt(req.query.limit, 80, 200);
      const files = await listFiles({ cwd: validated.realCwd, query: "", limit: 2500 });
      const symbols: WorkbenchSymbol[] = [];

      for (const rel of files) {
        const absPath = path.join(validated.realCwd, rel);
        const language = detectOutlineLanguage(absPath);
        if (!language) continue;
        try {
          const stat = await fs.stat(absPath);
          if (!stat.isFile() || stat.size > 512 * 1024) continue;
          const outline = await getOutline(absPath, stat.mtimeMs);
          if (outline) flattenSymbols(outline, rel.replace(/\\/g, "/"), symbols);
        } catch {
          // Skip files that disappear during indexing.
        }
      }

      const scored = symbols
        .map((symbol) => ({ symbol, score: symbolScore(symbol, query) }))
        .filter((item): item is { symbol: WorkbenchSymbol; score: number } => item.score !== null)
        .sort((a, b) => b.score - a.score || a.symbol.path.localeCompare(b.symbol.path))
        .slice(0, limit)
        .map((item) => item.symbol);

      return { cwd: validated.cwd, symbols: scored };
    },
  );

  app.get<{ Querystring: { cwd?: string; path?: string; symbol?: string; limit?: string } }>(
    "/api/workbench/tests",
    async (req, reply) => {
      const validated = await validateCwd(req.query.cwd, deps.manager);
      if ("error" in validated) return sendError(reply, validated.statusCode, validated.error);

      const limit = parsePositiveInt(req.query.limit, 20, 80);
      const focusPath = req.query.path?.trim() ?? "";
      const symbol = req.query.symbol?.trim() ?? "";
      const focusBase = focusPath ? baseNameWithoutExt(focusPath) : "";
      const tokens = [focusBase, symbol].filter(Boolean).map(normalizeToken).filter(Boolean);

      const files = await listFiles({ cwd: validated.realCwd, query: "", limit: 5000 });
      const tests = files
        .filter(isTestPath)
        .map((file) => {
          const normalized = normalizeToken(baseNameWithoutExt(file));
          const score = tokens.reduce((sum, token) => {
            if (!token) return sum;
            if (normalized.includes(token) || token.includes(normalized)) return sum + 10;
            if (file.toLowerCase().includes(token)) return sum + 3;
            return sum;
          }, 0);
          return { file, score };
        })
        .filter((item) => item.score > 0 || tokens.length === 0)
        .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
        .slice(0, limit);

      const commands = new Set<string>();
      for (const test of tests.slice(0, 5)) {
        for (const command of await detectValidationCommands(validated.realCwd, test.file)) {
          commands.add(command);
        }
      }

      return {
        cwd: validated.cwd,
        tests: tests.map((item) => ({ path: item.file, score: item.score })),
        commands: [...commands],
      };
    },
  );
}
