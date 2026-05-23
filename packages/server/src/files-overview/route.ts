import path from "node:path";
import type { FileEntry, GitStatus } from "@agent-view/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { runGit } from "../git/index.js";
import { parseGitStatus } from "../git/parse-status.js";
import { PathSafetyError, assertWithinCwd } from "../path-safety.js";
import type { SessionManager } from "../session-manager.js";
import { isGeneratedFile } from "./classify.js";

interface Deps {
  manager: SessionManager;
}

interface ToolCallLike {
  id: string;
  kind: string;
  rawInput: unknown;
  content: unknown[];
  locations: { path: string; line?: number }[] | null;
  ts: number;
}

interface DiffBlock {
  kind: "diff";
  path?: string;
  oldText?: string;
  newText?: string;
}

interface FileTouch {
  path: string;
  lastTouchAt: number;
  callCount: number;
  added: number;
  removed: number;
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
): Promise<{ cwd: string } | { error: string; statusCode: number }> {
  const cwd = rawCwd?.trim();
  if (!cwd) return { error: "cwd required", statusCode: 400 };
  if (!path.isAbsolute(cwd)) return { error: "absolute cwd required", statusCode: 400 };
  try {
    await assertWithinCwd(cwd, cwd, manager);
    return { cwd };
  } catch (err) {
    const statusCode = err instanceof PathSafetyError ? 400 : 500;
    return { error: errorMessage(err), statusCode };
  }
}

async function getGitStatus(cwd: string): Promise<GitStatus> {
  const result = await runGit(cwd, ["status", "--porcelain=v2", "--branch", "-z"]);
  if (result.exitCode !== 0) throw new Error(result.stderr || "git status failed");
  return parseGitStatus(result.stdout, cwd);
}

function pickPath(input: unknown, fields: string[]): string | undefined {
  if (input == null || typeof input !== "object") return undefined;
  for (const field of fields) {
    const value = (input as Record<string, unknown>)[field];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function countLines(text: string): number {
  if (text === "") return 0;
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.length;
}

function lineArray(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function lcsLength(a: string[], b: string[]): number {
  let prev = new Array(b.length + 1).fill(0) as number[];
  for (const left of a) {
    const next = new Array(b.length + 1).fill(0) as number[];
    for (let j = 0; j < b.length; j++) {
      next[j + 1] = left === b[j] ? prev[j] + 1 : Math.max(next[j], prev[j + 1]);
    }
    prev = next;
  }
  return prev[b.length] ?? 0;
}

function diffStatsForBlock(block: { oldText?: string; newText?: string }): {
  added: number;
  removed: number;
} {
  const oldText = block.oldText ?? "";
  const newText = block.newText ?? "";
  if (!oldText && !newText) return { added: 0, removed: 0 };
  if (!oldText) return { added: countLines(newText), removed: 0 };
  if (!newText) return { added: 0, removed: countLines(oldText) };

  let oldLines = lineArray(oldText);
  let newLines = lineArray(newText);
  while (oldLines.length > 0 && newLines.length > 0 && oldLines[0] === newLines[0]) {
    oldLines = oldLines.slice(1);
    newLines = newLines.slice(1);
  }
  while (
    oldLines.length > 0 &&
    newLines.length > 0 &&
    oldLines[oldLines.length - 1] === newLines[newLines.length - 1]
  ) {
    oldLines = oldLines.slice(0, -1);
    newLines = newLines.slice(0, -1);
  }

  if (oldLines.length * newLines.length > 200_000) {
    return { added: newLines.length, removed: oldLines.length };
  }
  const common = lcsLength(oldLines, newLines);
  return { added: newLines.length - common, removed: oldLines.length - common };
}

function normalizeContentBlock(raw: unknown): DiffBlock | null {
  if (raw == null || typeof raw !== "object") return null;
  const block = raw as Record<string, unknown>;
  const content = block.content;
  const contentType =
    content && typeof content === "object" ? (content as Record<string, unknown>).type : undefined;
  const kind = block.kind ?? block.type ?? contentType;
  if (kind !== "diff") return null;
  return {
    kind: "diff",
    path: typeof block.path === "string" ? block.path : undefined,
    oldText: typeof block.oldText === "string" ? block.oldText : undefined,
    newText: typeof block.newText === "string" ? block.newText : undefined,
  };
}

function looksWrite(call: ToolCallLike): boolean {
  const kind = call.kind.toLowerCase();
  return (
    kind.includes("write") ||
    kind.includes("edit") ||
    kind.includes("create") ||
    kind.includes("patch") ||
    kind.includes("modify")
  );
}

function normalizeTouchedPath(cwd: string, rawPath: string): { abs: string; rel: string } | null {
  if (!rawPath || rawPath.includes("\0")) return null;
  const abs = path.isAbsolute(rawPath) ? path.normalize(rawPath) : path.resolve(cwd, rawPath);
  const rel = path.relative(cwd, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return { abs, rel };
}

function aggregateTouched(cwd: string, manager: SessionManager): FileTouch[] {
  const activeIds = new Set(
    manager
      .list()
      .filter((session) => path.resolve(session.cwd) === path.resolve(cwd))
      .map((session) => session.id),
  );
  const map = new Map<string, FileTouch>();

  for (const session of manager.hydrate()) {
    if (!activeIds.has(session.id)) continue;
    for (const call of session.toolCalls as ToolCallLike[]) {
      const seen = new Set<string>();
      const perPathStats = new Map<string, { added: number; removed: number }>();

      if (Array.isArray(call.locations)) {
        for (const loc of call.locations) {
          if (typeof loc.path === "string") seen.add(loc.path);
        }
      }

      for (const rawBlock of call.content) {
        const block = normalizeContentBlock(rawBlock);
        if (block?.path) {
          seen.add(block.path);
          const stats = diffStatsForBlock({ oldText: block.oldText, newText: block.newText });
          const prev = perPathStats.get(block.path) ?? { added: 0, removed: 0 };
          perPathStats.set(block.path, {
            added: prev.added + stats.added,
            removed: prev.removed + stats.removed,
          });
        }
      }

      const rawPath = pickPath(call.rawInput, ["path", "file_path", "filename", "file"]);
      if (rawPath) seen.add(rawPath);

      if (rawPath && !perPathStats.has(rawPath) && looksWrite(call)) {
        const raw = call.rawInput && typeof call.rawInput === "object" ? call.rawInput : null;
        const input = raw as Record<string, unknown> | null;
        const newText =
          (typeof input?.content === "string" && input.content) ||
          (typeof input?.new_content === "string" && input.new_content) ||
          (typeof input?.newContent === "string" && input.newContent) ||
          "";
        const oldText =
          (typeof input?.old_content === "string" && input.old_content) ||
          (typeof input?.oldContent === "string" && input.oldContent) ||
          "";
        if (newText || oldText) {
          perPathStats.set(rawPath, diffStatsForBlock({ oldText, newText }));
        }
      }

      for (const rawSeenPath of seen) {
        const normalized = normalizeTouchedPath(cwd, rawSeenPath);
        if (!normalized) continue;
        const stats = perPathStats.get(rawSeenPath) ?? { added: 0, removed: 0 };
        const prev = map.get(normalized.rel);
        if (!prev) {
          map.set(normalized.rel, {
            path: normalized.abs,
            lastTouchAt: call.ts,
            callCount: 1,
            added: stats.added,
            removed: stats.removed,
          });
        } else {
          map.set(normalized.rel, {
            path: normalized.abs,
            lastTouchAt: Math.max(prev.lastTouchAt, call.ts),
            callCount: prev.callCount + 1,
            added: prev.added + stats.added,
            removed: prev.removed + stats.removed,
          });
        }
      }
    }
  }

  return [...map.values()].sort((a, b) => b.lastTouchAt - a.lastTouchAt);
}

function sourceForGitFile(file: GitStatus["files"][number]): "dirty" | "untracked" {
  return file.x === "?" || file.y === "?" ? "untracked" : "dirty";
}

export async function buildOverview(
  cwd: string,
  manager: SessionManager,
): Promise<{ gitStatus: GitStatus; touched: FileEntry[] }> {
  const gitStatus = await getGitStatus(cwd);
  const gitByRel = new Map(gitStatus.files.map((file) => [file.path, file]));
  const entries: FileEntry[] = [];
  const touchedRels = new Set<string>();

  for (const touch of aggregateTouched(cwd, manager)) {
    const rel = path.relative(cwd, touch.path);
    const gitFile = gitByRel.get(rel);
    touchedRels.add(rel);
    entries.push({
      path: touch.path,
      rel,
      source: "agent",
      gitX: gitFile?.x,
      gitY: gitFile?.y,
      isGenerated: isGeneratedFile(rel),
      lastTouchAt: touch.lastTouchAt,
      added: touch.added,
      removed: touch.removed,
      callCount: touch.callCount,
    });
  }

  const gitEntries = gitStatus.files
    .filter((file) => !touchedRels.has(file.path))
    .map<FileEntry>((file) => {
      const abs = path.resolve(cwd, file.path);
      return {
        path: abs,
        rel: file.path,
        source: sourceForGitFile(file),
        gitX: file.x,
        gitY: file.y,
        isGenerated: isGeneratedFile(file.path),
      };
    })
    .sort((a, b) => a.rel.localeCompare(b.rel));

  entries.push(...gitEntries);
  return { gitStatus, touched: entries };
}

export function registerFilesOverviewRoutes(app: FastifyInstance, deps: Deps): void {
  const { manager } = deps;

  app.get<{ Querystring: { cwd?: string } }>("/api/files/overview", async (req, reply) => {
    const validated = await validateCwd(req.query.cwd, manager);
    if ("error" in validated) return sendError(reply, validated.statusCode, validated.error);

    try {
      return await buildOverview(validated.cwd, manager);
    } catch (err) {
      return sendError(reply, 500, errorMessage(err));
    }
  });
}
