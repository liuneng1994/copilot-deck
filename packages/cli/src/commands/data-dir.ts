import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export async function runDataDir(): Promise<void> {
  const explicit = process.env.AGENT_VIEW_DB
    ? `AGENT_VIEW_DB=${process.env.AGENT_VIEW_DB}`
    : process.env.COPILOT_DECK_HOME
      ? `COPILOT_DECK_HOME=${process.env.COPILOT_DECK_HOME}`
      : null;

  const dir = process.env.COPILOT_DECK_HOME ?? path.join(homedir(), ".copilot-deck");
  const legacy = path.join(homedir(), ".agent-view");
  process.stdout.write(`Resolved: ${dir}\n`);
  if (existsSync(path.join(dir, "db.sqlite"))) {
    process.stdout.write("  db.sqlite: present\n");
  } else {
    process.stdout.write("  db.sqlite: missing (will be created on first start)\n");
  }
  if (existsSync(legacy)) {
    process.stdout.write(`Legacy:   ${legacy} (present — kept as backup)\n`);
  }
  if (explicit) process.stdout.write(`Source:   ${explicit}\n`);
}
