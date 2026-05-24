// Resolves the Copilot Deck data directory and performs a one-shot migration
// from the legacy ~/.agent-view/ location used before the project rename.
//
// Lookup order:
//   1. env AGENT_VIEW_DB           — full path to db.sqlite (legacy override)
//   2. env COPILOT_DECK_HOME       — directory; db.sqlite inside it
//   3. ~/.copilot-deck/db.sqlite   — default
//
// On first start, if ~/.copilot-deck is absent but ~/.agent-view/db.sqlite
// exists, we **copy** the legacy dir (db + WAL files + permissions/checkpoints
// state if present) over so users keep their history. The legacy dir is left
// untouched as a safety net. A marker file records that we've migrated so we
// don't try again on subsequent starts.

import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MIGRATION_MARKER = ".migrated-from-agent-view";

export interface DataDirResolution {
  /** Absolute path to the data directory (always exists when returned). */
  dir: string;
  /** Absolute path to db.sqlite. */
  dbPath: string;
  /** True when a legacy dir was copied this invocation. */
  migrated: boolean;
  /** Origin of the resolution, for diagnostics. */
  source: "AGENT_VIEW_DB" | "COPILOT_DECK_HOME" | "default";
}

export function resolveDataDir(): DataDirResolution {
  // 1. legacy explicit db override — caller knows what they're doing
  if (process.env.AGENT_VIEW_DB) {
    const dbPath = process.env.AGENT_VIEW_DB;
    const dir = path.dirname(dbPath);
    mkdirSync(dir, { recursive: true });
    return { dir, dbPath, migrated: false, source: "AGENT_VIEW_DB" };
  }

  // 2. explicit home dir
  if (process.env.COPILOT_DECK_HOME) {
    const dir = process.env.COPILOT_DECK_HOME;
    mkdirSync(dir, { recursive: true });
    return {
      dir,
      dbPath: path.join(dir, "db.sqlite"),
      migrated: false,
      source: "COPILOT_DECK_HOME",
    };
  }

  // 3. default — ~/.copilot-deck with legacy migration
  const home = os.homedir();
  const dir = path.join(home, ".copilot-deck");
  const legacy = path.join(home, ".agent-view");
  const legacyDb = path.join(legacy, "db.sqlite");

  let migrated = false;
  if (!existsSync(dir) && existsSync(legacyDb)) {
    try {
      cpSync(legacy, dir, { recursive: true });
      writeFileSync(
        path.join(dir, MIGRATION_MARKER),
        `Copied from ${legacy} on ${new Date().toISOString()}\n`,
        "utf8",
      );
      migrated = true;
    } catch (e) {
      // Don't block startup — fall through to creating an empty dir.
      process.stderr.write(
        `[copilot-deck] warning: failed to migrate from ${legacy}: ${
          e instanceof Error ? e.message : String(e)
        }\n`,
      );
    }
  }
  mkdirSync(dir, { recursive: true });
  return {
    dir,
    dbPath: path.join(dir, "db.sqlite"),
    migrated,
    source: "default",
  };
}
