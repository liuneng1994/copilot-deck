// Static configuration helpers for the agent-view server.
//
// Values are read at process start; restart the server to pick up changes.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** How long we wait for the user to decide on a tool-call permission prompt. */
export const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Read the user-configured default Copilot model. Resolution order:
 *
 *   1. `COPILOT_DEFAULT_MODEL` env var
 *   2. `model` field in `~/.copilot/settings.json`
 *   3. Hardcoded fallback (`claude-sonnet-4.5`)
 */
export function readDefaultCopilotModel(): string {
  const envModel = process.env.COPILOT_DEFAULT_MODEL?.trim();
  if (envModel) return envModel;
  try {
    const p = path.join(homedir(), ".copilot", "settings.json");
    const raw = readFileSync(p, "utf8");
    const json = JSON.parse(raw) as { model?: unknown };
    if (typeof json.model === "string" && json.model) return json.model;
  } catch {
    // fall through to hardcoded default
  }
  return "claude-sonnet-4.5";
}
