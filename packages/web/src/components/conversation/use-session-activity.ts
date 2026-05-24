import { useUIStore } from "../../stores/ui-store";
import type { SessionState, ToolCallState } from "../../stores/ui-store";

export interface SessionActivity {
  verb: string;
  kind: string;
  location: string;
  opIndex: number;
  inProgress: boolean;
}

export function verbFor(kind: string): string {
  switch (kind) {
    case "edit":
      return "editing";
    case "read":
      return "reading";
    case "search":
      return "searching";
    case "execute":
      return "running";
    case "fetch":
      return "fetching";
    case "think":
      return "thinking";
    default:
      return "working";
  }
}

function shortLocation(call: ToolCallState): string {
  const loc = call.locations?.[0]?.path;
  if (loc) {
    const parts = loc.split("/");
    return parts.slice(-2).join("/");
  }
  return call.inputSummary || call.title || "";
}

/** Derive "what is this session currently doing" from its tool-call stream.
 * Returns null when the session is not streaming or has no in-turn tool calls.
 */
export function deriveActivity(
  session: SessionState,
  toolCalls: Record<string, ToolCallState>,
): SessionActivity | null {
  if (session.status !== "streaming") return null;
  const calls = session.toolCallIds
    .map((id) => toolCalls[id])
    .filter((c): c is ToolCallState => !!c)
    .sort((a, b) => a.ts - b.ts);
  if (calls.length === 0) return null;
  const lastUserTs = [...session.messages].reverse().find((m) => m.role === "user")?.ts ?? 0;
  const turnCalls = calls.filter((c) => c.ts >= lastUserTs);
  if (turnCalls.length === 0) return null;
  const inProgress = [...turnCalls].reverse().find((c) => c.status === "in_progress");
  const target = inProgress ?? turnCalls[turnCalls.length - 1];
  return {
    verb: verbFor(target.kind),
    kind: target.kind,
    location: shortLocation(target),
    opIndex: turnCalls.indexOf(target) + 1,
    inProgress: !!inProgress,
  };
}

export function useSessionActivity(sessionId: string): SessionActivity | null {
  const session = useUIStore((s) => s.sessions[sessionId]);
  const toolCalls = useUIStore((s) => s.toolCalls);
  if (!session) return null;
  return deriveActivity(session, toolCalls);
}
