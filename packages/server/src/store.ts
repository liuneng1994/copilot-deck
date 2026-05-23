import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  cwd TEXT NOT NULL,
  title TEXT,
  mode_id TEXT,
  mode_name TEXT,
  mode_options TEXT,
  available_commands TEXT,
  status TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  /** When detached=1, the originating Copilot child has exited and the session
   * is read-only until the user re-opens it (which spawns a new child). */
  detached INTEGER DEFAULT 0,
  /** JSON-encoded ACP plan entries (most-recent plan update wins). */
  plan TEXT,
  /** Per-session model override (null = inherit cwd default). */
  model TEXT,
  /** "agents_md" | "prompt" | "off" — controls render-hint injection. */
  render_hint_mode TEXT,
  /** 1 once we've injected the prompt-mode hint into the first user prompt. */
  first_prompt_sent INTEGER DEFAULT 0,
  /** One-shot text prepended to the next prompt — used by session fork to
   * inject prior-session context into the first user prompt. Cleared after use. */
  fork_prefix TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  ts INTEGER NOT NULL,
  /** JSON array of attachments (images today, future media). Nullable. */
  attachments TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, ts);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  raw_input TEXT,
  raw_output TEXT,
  content TEXT,
  locations TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  ts INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id, ts);

CREATE TABLE IF NOT EXISTS session_files (
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  source TEXT,
  reviewed_at INTEGER,
  last_diff_hash TEXT,
  PRIMARY KEY (session_id, path),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_session_files_reviewed ON session_files(session_id, reviewed_at);

CREATE TABLE IF NOT EXISTS permissions (
  cwd TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  decision TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (cwd, tool_name)
);

CREATE TABLE IF NOT EXISTS trace_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  cwd TEXT,
  direction TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trace_session_ts ON trace_events(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_trace_ts ON trace_events(ts);

CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_id TEXT,
  cwd TEXT NOT NULL,
  -- git stash commit SHA (created via git stash create, NOT pushed to stash list)
  ref TEXT NOT NULL,
  -- HEAD sha at snapshot time, for context
  head_sha TEXT,
  -- short user-facing label (auto: "before prompt: ...")
  label TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_checkpoints_message ON checkpoints(session_id, message_id);

-- Cross-session full-text search over message bodies.
-- Uses contentless FTS5 so we don't double-store text.
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  text,
  content='messages',
  content_rowid='rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.rowid, old.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.rowid, old.text);
  INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
END;
`;

const TRACE_MAX_ROWS = Number(process.env.AGENT_VIEW_TRACE_MAX ?? 5000);

function defaultDbPath(): string {
  if (process.env.AGENT_VIEW_DB) return process.env.AGENT_VIEW_DB;
  const dir = path.join(os.homedir(), ".agent-view");
  mkdirSync(dir, { recursive: true });
  return path.join(dir, "db.sqlite");
}

export interface PlanEntry {
  /** Plan-item text from the agent (markdown allowed). */
  content: string;
  priority?: "low" | "medium" | "high";
  status?: "pending" | "in_progress" | "completed";
}

export interface PersistedSession {
  id: string;
  cwd: string;
  title: string | null;
  modeId: string | null;
  modeName: string | null;
  modeOptions: { id: string; name: string; description?: string }[] | null;
  availableCommands: { name: string; description?: string }[] | null;
  status: string | null;
  createdAt: number;
  updatedAt: number;
  detached: boolean;
  plan: PlanEntry[] | null;
  /** Per-session model override (null = inherit cwd default). */
  model: string | null;
  /** "agents_md" | "prompt" | "off" — controls render-hint injection. */
  renderHintMode: "agents_md" | "prompt" | "off";
  /** True once we've injected the prompt-mode hint into the first user prompt. */
  firstPromptSent: boolean;
}

export interface PersistedAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  /** data URL or http(s) reference for rendering. */
  dataUrl: string;
}

export interface PersistedMessage {
  id: string;
  sessionId: string;
  role: string;
  text: string;
  ts: number;
  attachments?: PersistedAttachment[];
}

export interface PersistedToolCall {
  id: string;
  sessionId: string;
  kind: string;
  title: string;
  status: string;
  rawInput: unknown;
  rawOutput: unknown;
  content: unknown[];
  locations: { path: string; line?: number }[] | null;
  startedAt: number;
  finishedAt: number | null;
  ts: number;
}

export interface ReviewedFile {
  path: string;
  reviewed_at: number;
  last_diff_hash: string | null;
}

export interface CheckpointRow {
  id: string;
  sessionId: string;
  messageId: string | null;
  cwd: string;
  ref: string;
  headSha: string | null;
  label: string | null;
  createdAt: number;
}

export interface TraceEvent {
  id?: number;
  sessionId: string | null;
  cwd: string | null;
  direction: "in" | "out";
  kind: string;
  payload: unknown;
  ts: number;
}

export class Store {
  readonly db: Database.Database;

  constructor(file?: string) {
    const dbPath = file ?? defaultDbPath();
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
    // Lightweight migration: ensure newer columns exist on older DBs that
    // were created before they were introduced.
    this.ensureColumn("sessions", "plan", "TEXT");
    this.ensureColumn("sessions", "model", "TEXT");
    this.ensureColumn("sessions", "render_hint_mode", "TEXT");
    this.ensureColumn("sessions", "first_prompt_sent", "INTEGER DEFAULT 0");
    this.ensureColumn("session_files", "source", "TEXT");
    this.ensureColumn("session_files", "reviewed_at", "INTEGER");
    this.ensureColumn("session_files", "last_diff_hash", "TEXT");
    this.ensureColumn("sessions", "fork_prefix", "TEXT");
    this.ensureColumn("messages", "attachments", "TEXT");
    this.backfillMessagesFts();
  }

  /**
   * One-time backfill: if `messages_fts` has no indexed docs but `messages`
   * is not empty, rebuild the FTS index from the source table. We detect
   * this via the docsize shadow table since the virtual table itself
   * reports a misleading count from content='messages' mode.
   */
  private backfillMessagesFts(): void {
    try {
      const ftsDocs = (
        this.db.prepare("SELECT count(*) AS n FROM messages_fts_docsize").get() as {
          n: number;
        }
      ).n;
      const msgCount = (
        this.db.prepare("SELECT count(*) AS n FROM messages").get() as { n: number }
      ).n;
      if (ftsDocs === 0 && msgCount > 0) {
        this.db.exec("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')");
      }
    } catch {
      // FTS5 may not be compiled in extremely minimal builds; skip silently.
    }
  }

  /**
   * SQLite has no IF NOT EXISTS for column adds; this helper checks
   * pragma_table_info and emits an ALTER only when the column is missing.
   */
  private ensureColumn(table: string, column: string, ddl: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!rows.some((r) => r.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
  }

  close() {
    this.db.close();
  }

  // ───── sessions ─────
  upsertSession(
    s: Omit<
      PersistedSession,
      "detached" | "plan" | "model" | "renderHintMode" | "firstPromptSent"
    > & {
      detached?: boolean;
      plan?: PlanEntry[] | null;
      model?: string | null;
      renderHintMode?: "agents_md" | "prompt" | "off";
      firstPromptSent?: boolean;
    },
  ) {
    this.db
      .prepare(
        `INSERT INTO sessions (id, cwd, title, mode_id, mode_name, mode_options, available_commands, status, created_at, updated_at, detached)
         VALUES (@id, @cwd, @title, @modeId, @modeName, @modeOptions, @availableCommands, @status, @createdAt, @updatedAt, @detached)
         ON CONFLICT(id) DO UPDATE SET
           cwd = excluded.cwd,
           title = excluded.title,
           mode_id = excluded.mode_id,
           mode_name = excluded.mode_name,
           mode_options = excluded.mode_options,
           available_commands = excluded.available_commands,
           status = excluded.status,
           updated_at = excluded.updated_at,
           detached = excluded.detached`,
      )
      .run({
        id: s.id,
        cwd: s.cwd,
        title: s.title,
        modeId: s.modeId,
        modeName: s.modeName,
        modeOptions: s.modeOptions ? JSON.stringify(s.modeOptions) : null,
        availableCommands: s.availableCommands ? JSON.stringify(s.availableCommands) : null,
        status: s.status,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        detached: s.detached ? 1 : 0,
      });
  }

  markSessionDetached(sessionId: string, detached: boolean) {
    this.db
      .prepare("UPDATE sessions SET detached = ?, updated_at = ? WHERE id = ?")
      .run(detached ? 1 : 0, Date.now(), sessionId);
  }

  renameSession(sessionId: string, title: string) {
    this.db
      .prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?")
      .run(title, Date.now(), sessionId);
  }

  markAllDetached() {
    this.db.prepare("UPDATE sessions SET detached = 1").run();
  }

  deleteSession(sessionId: string) {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }

  listSessions(): PersistedSession[] {
    const rows = this.db
      .prepare(
        `SELECT id, cwd, title, mode_id, mode_name, mode_options, available_commands, status, created_at, updated_at, detached, plan, model, render_hint_mode, first_prompt_sent
         FROM sessions ORDER BY updated_at DESC`,
      )
      .all() as Record<string, unknown>[];
    return rows.map(rowToSession);
  }

  getSession(id: string): PersistedSession | null {
    const row = this.db
      .prepare(
        `SELECT id, cwd, title, mode_id, mode_name, mode_options, available_commands, status, created_at, updated_at, detached, plan, model, render_hint_mode, first_prompt_sent
         FROM sessions WHERE id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToSession(row) : null;
  }

  setSessionPlan(id: string, plan: PlanEntry[] | null): void {
    this.db
      .prepare("UPDATE sessions SET plan = ?, updated_at = ? WHERE id = ?")
      .run(plan ? JSON.stringify(plan) : null, Date.now(), id);
  }

  setSessionModel(id: string, model: string | null): void {
    this.db
      .prepare("UPDATE sessions SET model = ?, updated_at = ? WHERE id = ?")
      .run(model, Date.now(), id);
  }

  setSessionRenderHintMode(id: string, mode: "agents_md" | "prompt" | "off"): void {
    this.db
      .prepare("UPDATE sessions SET render_hint_mode = ?, updated_at = ? WHERE id = ?")
      .run(mode, Date.now(), id);
  }

  setSessionFirstPromptSent(id: string, sent: boolean): void {
    this.db.prepare("UPDATE sessions SET first_prompt_sent = ? WHERE id = ?").run(sent ? 1 : 0, id);
  }

  setSessionForkPrefix(id: string, prefix: string | null): void {
    this.db.prepare("UPDATE sessions SET fork_prefix = ? WHERE id = ?").run(prefix, id);
  }

  getSessionForkPrefix(id: string): string | null {
    const r = this.db.prepare("SELECT fork_prefix FROM sessions WHERE id = ?").get(id) as
      | { fork_prefix: string | null }
      | undefined;
    return r?.fork_prefix ?? null;
  }

  touchSession(id: string, status?: string) {
    if (status !== undefined) {
      this.db
        .prepare("UPDATE sessions SET updated_at = ?, status = ? WHERE id = ?")
        .run(Date.now(), status, id);
    } else {
      this.db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(Date.now(), id);
    }
  }

  // ───── messages ─────
  insertMessage(m: PersistedMessage) {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO messages (id, session_id, role, text, ts, attachments) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        m.id,
        m.sessionId,
        m.role,
        m.text,
        m.ts,
        m.attachments && m.attachments.length > 0 ? JSON.stringify(m.attachments) : null,
      );
  }

  updateMessageText(id: string, text: string) {
    this.db.prepare("UPDATE messages SET text = ? WHERE id = ?").run(text, id);
  }

  listMessages(sessionId: string): PersistedMessage[] {
    const rows = this.db
      .prepare(
        "SELECT id, session_id, role, text, ts, attachments FROM messages WHERE session_id = ? ORDER BY ts ASC",
      )
      .all(sessionId) as Record<string, unknown>[];
    return rows.map((r) => {
      const out: PersistedMessage = {
        id: r.id as string,
        sessionId: r.session_id as string,
        role: r.role as string,
        text: r.text as string,
        ts: r.ts as number,
      };
      if (typeof r.attachments === "string" && r.attachments.length > 0) {
        try {
          out.attachments = JSON.parse(r.attachments) as PersistedAttachment[];
        } catch {
          // ignore malformed attachments JSON
        }
      }
      return out;
    });
  }

  // ───── tool calls ─────
  upsertToolCall(c: PersistedToolCall) {
    this.db
      .prepare(
        `INSERT INTO tool_calls (id, session_id, kind, title, status, raw_input, raw_output, content, locations, started_at, finished_at, ts)
         VALUES (@id, @sessionId, @kind, @title, @status, @rawInput, @rawOutput, @content, @locations, @startedAt, @finishedAt, @ts)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           title = excluded.title,
           status = excluded.status,
           raw_input = excluded.raw_input,
           raw_output = excluded.raw_output,
           content = excluded.content,
           locations = excluded.locations,
           started_at = excluded.started_at,
           finished_at = excluded.finished_at`,
      )
      .run({
        id: c.id,
        sessionId: c.sessionId,
        kind: c.kind,
        title: c.title,
        status: c.status,
        rawInput: c.rawInput === undefined ? null : JSON.stringify(c.rawInput),
        rawOutput: c.rawOutput === undefined ? null : JSON.stringify(c.rawOutput),
        content: JSON.stringify(c.content),
        locations: c.locations ? JSON.stringify(c.locations) : null,
        startedAt: c.startedAt,
        finishedAt: c.finishedAt,
        ts: c.ts,
      });
  }

  listToolCalls(sessionId: string): PersistedToolCall[] {
    const rows = this.db
      .prepare(
        `SELECT id, session_id, kind, title, status, raw_input, raw_output, content, locations, started_at, finished_at, ts
         FROM tool_calls WHERE session_id = ? ORDER BY ts ASC`,
      )
      .all(sessionId) as Record<string, unknown>[];
    return rows.map(rowToToolCall);
  }

  getToolCall(id: string): PersistedToolCall | null {
    const row = this.db
      .prepare(
        `SELECT id, session_id, kind, title, status, raw_input, raw_output, content, locations, started_at, finished_at, ts
         FROM tool_calls WHERE id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    return row ? rowToToolCall(row) : null;
  }

  // ───── session files ─────
  markReviewed(sessionId: string, path: string, diffHash: string): void {
    this.db
      .prepare(
        `INSERT INTO session_files (session_id, path, reviewed_at, last_diff_hash)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id, path) DO UPDATE SET
           reviewed_at = excluded.reviewed_at,
           last_diff_hash = excluded.last_diff_hash`,
      )
      .run(sessionId, path, Date.now(), diffHash);
  }

  unmarkReviewed(sessionId: string, path: string): void {
    this.db
      .prepare("UPDATE session_files SET reviewed_at = NULL WHERE session_id = ? AND path = ?")
      .run(sessionId, path);
  }

  loadReviewed(sessionId: string): ReviewedFile[] {
    return this.db
      .prepare(
        `SELECT path, reviewed_at, last_diff_hash
         FROM session_files
         WHERE session_id = ? AND reviewed_at IS NOT NULL
         ORDER BY reviewed_at ASC`,
      )
      .all(sessionId) as ReviewedFile[];
  }

  // ───── permissions ─────
  setPermission(cwd: string, toolName: string, decision: "allowed" | "denied") {
    this.db
      .prepare(
        `INSERT INTO permissions (cwd, tool_name, decision, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(cwd, tool_name) DO UPDATE SET decision = excluded.decision, updated_at = excluded.updated_at`,
      )
      .run(cwd, toolName, decision, Date.now());
  }

  clearPermission(cwd: string, toolName: string) {
    this.db.prepare("DELETE FROM permissions WHERE cwd = ? AND tool_name = ?").run(cwd, toolName);
  }

  listPermissions(): {
    cwd: string;
    toolName: string;
    decision: "allowed" | "denied";
    updatedAt: number;
  }[] {
    const rows = this.db
      .prepare("SELECT cwd, tool_name, decision, updated_at FROM permissions")
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      cwd: r.cwd as string,
      toolName: r.tool_name as string,
      decision: r.decision as "allowed" | "denied",
      updatedAt: r.updated_at as number,
    }));
  }

  // ───── trace ─────
  insertTrace(t: TraceEvent): number {
    const info = this.db
      .prepare(
        "INSERT INTO trace_events (session_id, cwd, direction, kind, payload, ts) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(t.sessionId, t.cwd, t.direction, t.kind, JSON.stringify(t.payload), t.ts);
    this.pruneTrace();
    return Number(info.lastInsertRowid);
  }

  private pruneCounter = 0;
  private pruneTrace() {
    if (++this.pruneCounter % 200 !== 0) return;
    const count = (this.db.prepare("SELECT COUNT(*) as c FROM trace_events").get() as { c: number })
      .c;
    if (count <= TRACE_MAX_ROWS) return;
    this.db
      .prepare(
        "DELETE FROM trace_events WHERE id IN (SELECT id FROM trace_events ORDER BY id ASC LIMIT ?)",
      )
      .run(count - TRACE_MAX_ROWS);
  }

  listTrace(opts: { sessionId?: string; sinceId?: number; limit?: number } = {}): TraceEvent[] {
    const limit = Math.min(opts.limit ?? 500, 2000);
    let sql =
      "SELECT id, session_id, cwd, direction, kind, payload, ts FROM trace_events WHERE 1=1";
    const params: unknown[] = [];
    if (opts.sessionId) {
      sql += " AND session_id = ?";
      params.push(opts.sessionId);
    }
    if (opts.sinceId != null) {
      sql += " AND id > ?";
      params.push(opts.sinceId);
    }
    sql += " ORDER BY id DESC LIMIT ?";
    params.push(limit);
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows
      .map((r) => ({
        id: r.id as number,
        sessionId: (r.session_id ?? null) as string | null,
        cwd: (r.cwd ?? null) as string | null,
        direction: r.direction as "in" | "out",
        kind: r.kind as string,
        payload: JSON.parse(r.payload as string),
        ts: r.ts as number,
      }))
      .reverse();
  }

  // ───── checkpoints ─────
  insertCheckpoint(c: CheckpointRow): void {
    this.db
      .prepare(
        `INSERT INTO checkpoints (id, session_id, message_id, cwd, ref, head_sha, label, created_at)
         VALUES (@id, @sessionId, @messageId, @cwd, @ref, @headSha, @label, @createdAt)`,
      )
      .run({
        id: c.id,
        sessionId: c.sessionId,
        messageId: c.messageId,
        cwd: c.cwd,
        ref: c.ref,
        headSha: c.headSha,
        label: c.label,
        createdAt: c.createdAt,
      });
  }

  listCheckpoints(sessionId: string): CheckpointRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, session_id, message_id, cwd, ref, head_sha, label, created_at
         FROM checkpoints WHERE session_id = ? ORDER BY created_at ASC`,
      )
      .all(sessionId) as Record<string, unknown>[];
    return rows.map(rowToCheckpoint);
  }

  getCheckpoint(id: string): CheckpointRow | null {
    const r = this.db
      .prepare(
        `SELECT id, session_id, message_id, cwd, ref, head_sha, label, created_at
         FROM checkpoints WHERE id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    return r ? rowToCheckpoint(r) : null;
  }

  deleteCheckpoint(id: string): void {
    this.db.prepare("DELETE FROM checkpoints WHERE id = ?").run(id);
  }

  // ───── search ─────

  /**
   * Full-text search across all messages. Returns rows with session metadata
   * + a snippet with FTS5 highlight markers. Query is the raw user input;
   * we sanitise it to a safe FTS5 MATCH expression.
   */
  searchMessages(rawQuery: string, opts: { limit?: number; sessionId?: string } = {}): SearchHit[] {
    const q = toFtsQuery(rawQuery);
    if (!q) return [];
    const limit = Math.max(1, Math.min(200, opts.limit ?? 50));
    try {
      const sql = opts.sessionId
        ? `SELECT m.id AS message_id, m.session_id, m.role, m.ts,
                  s.cwd AS cwd, s.title AS title,
                  snippet(messages_fts, 0, '<mark>', '</mark>', '…', 16) AS snippet,
                  bm25(messages_fts) AS score
           FROM messages_fts
           JOIN messages m ON m.rowid = messages_fts.rowid
           JOIN sessions s ON s.id = m.session_id
           WHERE messages_fts MATCH ? AND m.session_id = ?
           ORDER BY score
           LIMIT ?`
        : `SELECT m.id AS message_id, m.session_id, m.role, m.ts,
                  s.cwd AS cwd, s.title AS title,
                  snippet(messages_fts, 0, '<mark>', '</mark>', '…', 16) AS snippet,
                  bm25(messages_fts) AS score
           FROM messages_fts
           JOIN messages m ON m.rowid = messages_fts.rowid
           JOIN sessions s ON s.id = m.session_id
           WHERE messages_fts MATCH ?
           ORDER BY score
           LIMIT ?`;
      const params = opts.sessionId ? [q, opts.sessionId, limit] : [q, limit];
      const rows = this.db.prepare(sql).all(...params) as Array<{
        message_id: string;
        session_id: string;
        role: string;
        ts: number;
        cwd: string;
        title: string | null;
        snippet: string;
        score: number;
      }>;
      return rows.map((r) => ({
        messageId: r.message_id,
        sessionId: r.session_id,
        role: r.role as "user" | "agent",
        ts: r.ts,
        cwd: r.cwd,
        title: r.title,
        snippet: r.snippet,
        score: r.score,
      }));
    } catch {
      // Malformed FTS query — return empty rather than 500.
      return [];
    }
  }
}

export interface SearchHit {
  messageId: string;
  sessionId: string;
  role: "user" | "agent";
  ts: number;
  cwd: string;
  title: string | null;
  /** Snippet with `<mark>…</mark>` around the matched terms. */
  snippet: string;
  score: number;
}

/**
 * Convert a raw user search string into a safe FTS5 MATCH expression.
 *  - splits on whitespace
 *  - drops FTS-meaningful punctuation
 *  - wraps each token in double quotes and ANDs with implicit space
 *  - appends `*` to the last token for prefix matching
 */
function toFtsQuery(raw: string): string {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/["()\-*:]/g, ""))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return "";
  const quoted = tokens.map((t, i) => (i === tokens.length - 1 ? `"${t}"*` : `"${t}"`));
  return quoted.join(" ");
}

function rowToCheckpoint(r: Record<string, unknown>): CheckpointRow {
  return {
    id: r.id as string,
    sessionId: r.session_id as string,
    messageId: (r.message_id ?? null) as string | null,
    cwd: r.cwd as string,
    ref: r.ref as string,
    headSha: (r.head_sha ?? null) as string | null,
    label: (r.label ?? null) as string | null,
    createdAt: r.created_at as number,
  };
}

function rowToSession(r: Record<string, unknown>): PersistedSession {
  return {
    id: r.id as string,
    cwd: r.cwd as string,
    title: (r.title ?? null) as string | null,
    modeId: (r.mode_id ?? null) as string | null,
    modeName: (r.mode_name ?? null) as string | null,
    modeOptions: r.mode_options
      ? (JSON.parse(r.mode_options as string) as PersistedSession["modeOptions"])
      : null,
    availableCommands: r.available_commands
      ? (JSON.parse(r.available_commands as string) as PersistedSession["availableCommands"])
      : null,
    status: (r.status ?? null) as string | null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    detached: (r.detached as number) === 1,
    plan: r.plan ? (JSON.parse(r.plan as string) as PlanEntry[]) : null,
    model: (r.model ?? null) as string | null,
    renderHintMode: (r.render_hint_mode ?? "prompt") as "agents_md" | "prompt" | "off",
    firstPromptSent: (r.first_prompt_sent as number) === 1,
  };
}

function rowToToolCall(r: Record<string, unknown>): PersistedToolCall {
  return {
    id: r.id as string,
    sessionId: r.session_id as string,
    kind: r.kind as string,
    title: r.title as string,
    status: r.status as string,
    rawInput: r.raw_input ? JSON.parse(r.raw_input as string) : null,
    rawOutput: r.raw_output ? JSON.parse(r.raw_output as string) : null,
    content: JSON.parse((r.content as string) ?? "[]"),
    locations: r.locations ? JSON.parse(r.locations as string) : null,
    startedAt: r.started_at as number,
    finishedAt: (r.finished_at ?? null) as number | null,
    ts: r.ts as number,
  };
}
