// Read-only adapter over Copilot CLI's session store
// (`~/.copilot/session-store.db`). Used to surface "import / resume from
// Copilot CLI history" in the web UI without touching the upstream DB.

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database, { type Database as Db } from "better-sqlite3";

const DEFAULT_DB_PATH = path.join(os.homedir(), ".copilot", "session-store.db");

export interface CopilotHistorySessionSummary {
  id: string;
  cwd: string | null;
  repository: string | null;
  branch: string | null;
  /** First line of the summary text (often the first user message). */
  summary: string | null;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
}

export interface CopilotHistoryTurn {
  index: number;
  userMessage: string | null;
  assistantResponse: string | null;
  timestamp: string;
}

export interface CopilotHistorySessionDetail extends CopilotHistorySessionSummary {
  turns: CopilotHistoryTurn[];
}

export class CopilotHistoryStore {
  private db: Db | null = null;
  private opened = false;

  constructor(private readonly dbPath: string = DEFAULT_DB_PATH) {}

  /** Open the DB read-only. Returns false (and the store stays unavailable) if the file doesn't exist. */
  open(): boolean {
    if (this.opened) return this.db !== null;
    this.opened = true;
    if (!existsSync(this.dbPath)) return false;
    try {
      // readonly + fileMustExist so we never accidentally write or create.
      this.db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
      return true;
    } catch (err) {
      console.warn(`[copilot-history] cannot open ${this.dbPath}: ${(err as Error).message}`);
      this.db = null;
      return false;
    }
  }

  isAvailable(): boolean {
    if (!this.opened) this.open();
    return this.db !== null;
  }

  /**
   * List sessions ordered by recency. `cwd` filters to exact match; `q` searches
   * summary + cwd (LIKE). `limit` caps the result; defaults to 100.
   */
  listSessions(
    opts: { cwd?: string; q?: string; limit?: number } = {},
  ): CopilotHistorySessionSummary[] {
    if (!this.isAvailable() || !this.db) return [];
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (opts.cwd) {
      where.push("cwd = @cwd");
      params.cwd = opts.cwd;
    }
    if (opts.q?.trim()) {
      where.push("(summary LIKE @q OR cwd LIKE @q OR repository LIKE @q)");
      params.q = `%${opts.q.trim()}%`;
    }
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const sql = `
      SELECT s.id, s.cwd, s.repository, s.branch, s.summary, s.created_at, s.updated_at,
             (SELECT COUNT(*) FROM turns t WHERE t.session_id = s.id) AS turn_count
      FROM sessions s
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY s.updated_at DESC
      LIMIT ${limit}
    `;
    const rows = this.db.prepare(sql).all(params) as Array<{
      id: string;
      cwd: string | null;
      repository: string | null;
      branch: string | null;
      summary: string | null;
      created_at: string;
      updated_at: string;
      turn_count: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      cwd: r.cwd,
      repository: r.repository,
      branch: r.branch,
      summary: this.firstNonEmptyLine(r.summary),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      turnCount: r.turn_count,
    }));
  }

  getSession(id: string): CopilotHistorySessionDetail | null {
    if (!this.isAvailable() || !this.db) return null;
    const row = this.db
      .prepare(
        "SELECT id, cwd, repository, branch, summary, created_at, updated_at FROM sessions WHERE id = ?",
      )
      .get(id) as
      | {
          id: string;
          cwd: string | null;
          repository: string | null;
          branch: string | null;
          summary: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    const turns = this.db
      .prepare(
        `SELECT turn_index, user_message, assistant_response, timestamp FROM turns
         WHERE session_id = ? ORDER BY turn_index ASC`,
      )
      .all(id) as Array<{
      turn_index: number;
      user_message: string | null;
      assistant_response: string | null;
      timestamp: string;
    }>;
    return {
      id: row.id,
      cwd: row.cwd,
      repository: row.repository,
      branch: row.branch,
      summary: this.firstNonEmptyLine(row.summary),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      turnCount: turns.length,
      turns: turns.map((t) => ({
        index: t.turn_index,
        userMessage: t.user_message,
        assistantResponse: t.assistant_response,
        timestamp: t.timestamp,
      })),
    };
  }

  /** Returns true if this id exists in the copilot DB. */
  hasSession(id: string): boolean {
    if (!this.isAvailable() || !this.db) return false;
    const row = this.db.prepare("SELECT 1 FROM sessions WHERE id = ? LIMIT 1").get(id);
    return !!row;
  }

  close() {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // ignore
      }
    }
    this.db = null;
    this.opened = false;
  }

  private firstNonEmptyLine(text: string | null): string | null {
    if (!text) return null;
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      // Skip our own system-note marker, surface the next meaningful line.
      if (t.startsWith("<!-- system-note")) continue;
      if (t.startsWith("## ")) continue;
      return t.slice(0, 200);
    }
    return text.split(/\r?\n/, 1)[0]?.slice(0, 200) ?? null;
  }
}
