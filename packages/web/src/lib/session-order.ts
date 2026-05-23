import type { SessionState } from "../stores/ui-store";

/**
 * Flatten sessions into the same order the sidebar renders them:
 *  - Grouped by cwd, groups in `Object.values()` iteration order
 *  - Within each group, sessions sorted by updatedAt desc
 *
 * Used by Cmd+1..9 hotkeys and numeric hints in the sidebar.
 */
export function orderedSessions(sessions: Record<string, SessionState>): SessionState[] {
  const byCwd = new Map<string, SessionState[]>();
  for (const s of Object.values(sessions)) {
    if (!byCwd.has(s.cwd)) byCwd.set(s.cwd, []);
    byCwd.get(s.cwd)!.push(s);
  }
  return [...byCwd.values()].flatMap((list) => list.sort((a, b) => b.updatedAt - a.updatedAt));
}
