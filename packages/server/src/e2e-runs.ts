import { promises as fs, constants as fsConstants } from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";

interface E2eRunSummary {
  available: boolean;
  status: "available" | "missing";
  reportUrl: string | null;
  reportPath: string | null;
  testResultsPath: string | null;
  workDirPath: string | null;
  workspaces: string[];
  updatedAt: number | null;
}

const repoRoot = path.resolve(import.meta.dirname ?? __dirname, "../../..");
const reportPath = path.join(repoRoot, "playwright-report", "index.html");
const testResultsPath = path.join(repoRoot, "test-results");
const workDirPath = path.join(repoRoot, ".e2e-work");

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function mtimeMs(target: string): Promise<number | null> {
  try {
    return (await fs.stat(target)).mtimeMs;
  } catch {
    return null;
  }
}

async function listE2eWorkspaces(): Promise<string[]> {
  if (!(await exists(workDirPath))) return [];
  const entries = await fs.readdir(workDirPath, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const repoPath = path.join(workDirPath, entry.name, "repo");
    if (await exists(repoPath)) out.push(repoPath);
  }
  return out.sort();
}

async function latestE2eRun(): Promise<E2eRunSummary> {
  const hasReport = await exists(reportPath);
  const hasResults = await exists(testResultsPath);
  const hasWorkDir = await exists(workDirPath);
  const workspaces = await listE2eWorkspaces();
  const updatedAt = Math.max(
    ...(
      await Promise.all([mtimeMs(reportPath), mtimeMs(testResultsPath), mtimeMs(workDirPath)])
    ).filter((value): value is number => typeof value === "number"),
    0,
  );

  return {
    available: hasReport || hasResults || hasWorkDir,
    status: hasReport || hasResults || hasWorkDir ? "available" : "missing",
    reportUrl: hasReport ? "/e2e-report" : null,
    reportPath: hasReport ? reportPath : null,
    testResultsPath: hasResults ? testResultsPath : null,
    workDirPath: hasWorkDir ? workDirPath : null,
    workspaces,
    updatedAt: updatedAt > 0 ? updatedAt : null,
  };
}

function sendError(reply: FastifyReply, statusCode: number, error: string): { error: string } {
  reply.code(statusCode);
  return { error };
}

export function registerE2eRunRoutes(app: FastifyInstance): void {
  app.get("/api/e2e-runs/latest", async () => latestE2eRun());

  app.get("/e2e-report", async (_req, reply) => {
    try {
      const html = await fs.readFile(reportPath, "utf8");
      reply.type("text/html; charset=utf-8");
      return html;
    } catch {
      return sendError(reply, 404, "Playwright report not found. Run e2e tests first.");
    }
  });
}
