import { randomUUID } from "node:crypto";
import type { AgentTaskDecision, AgentTaskKind, AgentTaskRequest } from "@agent-view/shared";

const MAX_BUFFER_CHARS = 64 * 1024;
const MAX_COMMAND_CHARS = 4096;
const MAX_TEXT_CHARS = 500;
const MAX_TASKS_PER_BLOCK = 5;
const TASK_BLOCK_RE = /```(?:copilot[-_]deck[-_]task|deck[-_]task)\s*([\s\S]*?)```/gi;

interface SessionScanState {
  buffer: string;
  seenBlocks: Set<string>;
}

type RequestDraft = {
  command: string;
  kind?: unknown;
  label?: unknown;
  reason?: unknown;
};

export class AgentTaskRequestController {
  private readonly pending = new Map<string, AgentTaskRequest>();
  private readonly bySession = new Map<string, SessionScanState>();

  beginTurn(sessionId: string): void {
    this.bySession.set(sessionId, { buffer: "", seenBlocks: new Set() });
  }

  observe(sessionId: string, cwd: string, update: unknown): AgentTaskRequest[] {
    const text = agentTextChunk(update);
    if (!text) return [];

    const state = this.stateFor(sessionId);
    state.buffer = `${state.buffer}${text}`.slice(-MAX_BUFFER_CHARS);

    const out: AgentTaskRequest[] = [];
    TASK_BLOCK_RE.lastIndex = 0;
    for (const match of state.buffer.matchAll(TASK_BLOCK_RE)) {
      const block = match[1].trim();
      if (!block || state.seenBlocks.has(block)) continue;
      state.seenBlocks.add(block);
      for (const draft of parseTaskBlock(block).slice(0, MAX_TASKS_PER_BLOCK)) {
        const request = toRequest(sessionId, cwd, draft);
        if (!request) continue;
        this.pending.set(request.id, request);
        out.push(request);
      }
    }
    return out;
  }

  resolve(requestId: string, _outcome: AgentTaskDecision): AgentTaskRequest | undefined {
    const req = this.pending.get(requestId);
    if (req) this.pending.delete(requestId);
    return req;
  }

  private stateFor(sessionId: string): SessionScanState {
    let state = this.bySession.get(sessionId);
    if (!state) {
      state = { buffer: "", seenBlocks: new Set() };
      this.bySession.set(sessionId, state);
    }
    return state;
  }
}

function agentTextChunk(update: unknown): string {
  if (!isRecord(update)) return "";
  if (update.sessionUpdate !== "agent_message_chunk") return "";
  const content = update.content;
  if (!isRecord(content) || content.type !== "text") return "";
  return typeof content.text === "string" ? content.text : "";
}

function parseTaskBlock(raw: string): RequestDraft[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const root = unwrapRoot(parsed);
  if (Array.isArray(root)) return root.filter(isRequestDraft);
  if (isRecord(root) && Array.isArray(root.tasks)) return root.tasks.filter(isRequestDraft);
  return isRequestDraft(root) ? [root] : [];
}

function unwrapRoot(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return value.copilotDeckTask ?? value.copilot_deck_task ?? value;
}

function isRequestDraft(value: unknown): value is RequestDraft {
  return isRecord(value) && typeof value.command === "string" && value.command.trim().length > 0;
}

function toRequest(sessionId: string, cwd: string, draft: RequestDraft): AgentTaskRequest | null {
  const command = draft.command.trim();
  if (!command || command.length > MAX_COMMAND_CHARS) return null;
  return {
    id: randomUUID(),
    sessionId,
    cwd,
    command,
    kind: normalizeKind(draft.kind),
    label: clipOptional(draft.label),
    reason: clipOptional(draft.reason),
    createdAt: Date.now(),
  };
}

function normalizeKind(value: unknown): AgentTaskKind {
  return value === "test" || value === "review" || value === "command" ? value : "command";
}

function clipOptional(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
