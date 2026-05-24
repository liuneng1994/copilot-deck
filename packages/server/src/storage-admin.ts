import { stat } from "node:fs/promises";
import type { PruneRequest, PruneResult, StorageStats } from "@agent-view/shared";
import type Database from "better-sqlite3";

export type { PruneRequest, PruneResult, StorageStats };

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function dbSize(dbPath: string): Promise<number> {
  const sizes = await Promise.all([dbPath, `${dbPath}-wal`, `${dbPath}-shm`].map(fileSize));
  return sizes.reduce((sum, size) => sum + size, 0);
}

function activePlaceholders(activeSessionIds: Set<string>): string {
  return [...activeSessionIds].map(() => "?").join(", ");
}

function inactiveSessionWhere(activeSessionIds: Set<string>): { sql: string; params: string[] } {
  const params = [...activeSessionIds];
  const notActive =
    params.length > 0 ? ` AND id NOT IN (${activePlaceholders(activeSessionIds)})` : "";
  return {
    sql: `(status IS NULL OR status NOT IN ('active', 'running', 'reloading'))${notActive}`,
    params,
  };
}

function traceActiveWhere(activeSessionIds: Set<string>): { sql: string; params: string[] } {
  const params = [...activeSessionIds];
  if (params.length === 0) return { sql: "", params };
  return {
    sql: ` AND (session_id IS NULL OR session_id NOT IN (${activePlaceholders(activeSessionIds)}))`,
    params,
  };
}

export async function getStorageStats(
  db: Database.Database,
  dbPath: string,
): Promise<StorageStats> {
  const [size, sessionRow, traceRow, activityRow] = await Promise.all([
    dbSize(dbPath),
    Promise.resolve(
      db.prepare("SELECT COUNT(*) AS count FROM sessions").get() as { count: number },
    ),
    Promise.resolve(
      db.prepare("SELECT COUNT(*) AS count FROM trace_events").get() as { count: number },
    ),
    Promise.resolve(
      db
        .prepare(
          `SELECT MIN(activity_at) AS oldestActivityAt
           FROM (
             SELECT updated_at AS activity_at FROM sessions
             UNION ALL
             SELECT ts AS activity_at FROM trace_events
           )`,
        )
        .get() as { oldestActivityAt: number | null },
    ),
  ]);

  return {
    dbPath,
    dbSizeBytes: size,
    sessionCount: sessionRow.count,
    traceEventCount: traceRow.count,
    oldestActivityAt: activityRow.oldestActivityAt ?? null,
  };
}

export async function pruneOld(
  db: Database.Database,
  dbPath: string,
  req: PruneRequest,
  activeSessionIds = new Set<string>(),
): Promise<PruneResult> {
  if (!Number.isFinite(req.olderThanDays) || req.olderThanDays < 1) {
    throw new RangeError("olderThanDays must be at least 1");
  }

  const before = await dbSize(dbPath);
  const cutoff = Date.now() - Math.floor(req.olderThanDays) * 24 * 60 * 60 * 1000;
  const traceWhere = traceActiveWhere(activeSessionIds);
  const sessionWhere = inactiveSessionWhere(activeSessionIds);

  const run = db.transaction(() => {
    const oldTraceEvents = (
      db
        .prepare(`SELECT COUNT(*) AS count FROM trace_events WHERE ts < ?${traceWhere.sql}`)
        .get(cutoff, ...traceWhere.params) as { count: number }
    ).count;

    let deletedSessions = 0;
    let deletedTraceEvents = oldTraceEvents;
    let sessionsToDelete: string[] = [];
    if (req.pruneSessions) {
      sessionsToDelete = (
        db
          .prepare(`SELECT id FROM sessions WHERE updated_at < ? AND ${sessionWhere.sql}`)
          .all(cutoff, ...sessionWhere.params) as { id: string }[]
      ).map((row) => row.id);
      deletedSessions = sessionsToDelete.length;

      if (sessionsToDelete.length > 0) {
        const placeholders = sessionsToDelete.map(() => "?").join(", ");
        const sessionTraceEvents = (
          db
            .prepare(
              `SELECT COUNT(*) AS count FROM trace_events WHERE session_id IN (${placeholders})`,
            )
            .get(...sessionsToDelete) as { count: number }
        ).count;
        const overlappingOldTraceEvents = (
          db
            .prepare(
              `SELECT COUNT(*) AS count FROM trace_events WHERE ts < ? AND session_id IN (${placeholders})`,
            )
            .get(cutoff, ...sessionsToDelete) as { count: number }
        ).count;
        deletedTraceEvents = oldTraceEvents + sessionTraceEvents - overlappingOldTraceEvents;
      }
    }

    if (!req.dryRun) {
      db.prepare(`DELETE FROM trace_events WHERE ts < ?${traceWhere.sql}`).run(
        cutoff,
        ...traceWhere.params,
      );
      for (const sessionId of sessionsToDelete) {
        db.prepare("DELETE FROM trace_events WHERE session_id = ?").run(sessionId);
        db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
      }
    }

    return { deletedSessions, deletedTraceEvents };
  });

  const result = run();
  const after = req.dryRun ? before : await dbSize(dbPath);
  return {
    ...result,
    freedBytes: Math.max(0, before - after),
  };
}

export async function vacuum(
  db: Database.Database,
  dbPath: string,
): Promise<{ freedBytes: number }> {
  const before = await dbSize(dbPath);
  db.exec("VACUUM");
  const after = await dbSize(dbPath);
  return { freedBytes: Math.max(0, before - after) };
}
