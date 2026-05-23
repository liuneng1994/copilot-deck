// Wire protocol between the agent-view server and the React web UI.

export type PermissionOutcome = "allowed_once" | "allowed_always" | "denied";

export interface PermissionOption {
  optionId: string;
  label: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
}

export interface PermissionToolCallSnapshot {
  toolCallId: string;
  title?: string;
  kind?: string;
  rawInput?: unknown;
}

export type ClientToServer =
  | { type: "create_session"; cwd: string }
  | { type: "prompt"; sessionId: string; text: string }
  | { type: "cancel"; sessionId: string }
  | { type: "set_mode"; sessionId: string; modeId: string }
  | { type: "delete_session"; sessionId: string }
  | { type: "request_trace"; sessionId?: string; sinceId?: number; limit?: number }
  | {
      type: "permission_reply";
      requestId: string;
      outcome: PermissionOutcome;
      optionId?: string;
    };

export interface SessionModeSnapshot {
  currentModeId: string;
  availableModes: { id: string; name: string; description?: string }[];
}

export type ServerToClient =
  | {
      type: "session_created";
      sessionId: string;
      cwd: string;
      modes?: SessionModeSnapshot;
    }
  | {
      type: "session_update";
      sessionId: string;
      update: unknown;
    }
  | { type: "prompt_done"; sessionId: string; stopReason: string }
  | { type: "error"; sessionId?: string; message: string }
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  | {
      type: "permission_request";
      requestId: string;
      sessionId: string;
      toolCall: PermissionToolCallSnapshot;
      options: PermissionOption[];
    }
  | {
      // Copilot child process for a given cwd exited (crash / killed).
      // Server emits to all attached UIs; affected sessionIds are tied to cwd.
      type: "child_exit";
      cwd: string;
      sessionIds: string[];
      code: number | null;
      signal: string | null;
    }
  | {
      // Initial hydration on (re)connect with the persisted state.
      type: "hydrate";
      sessions: HydratedSession[];
    }
  | {
      // New trace event captured (live).
      type: "trace_event";
      event: TraceEventDTO;
    }
  | {
      // Response to ClientToServer request_trace.
      type: "trace_snapshot";
      events: TraceEventDTO[];
    };

export interface TraceEventDTO {
  id: number;
  sessionId: string | null;
  cwd: string | null;
  direction: "in" | "out";
  kind: string;
  payload: unknown;
  ts: number;
}

export interface HydratedSession {
  id: string;
  cwd: string;
  title: string | null;
  status: string | null;
  modeId: string | null;
  modeName: string | null;
  modeOptions: { id: string; name: string; description?: string }[] | null;
  availableCommands: { name: string; description?: string }[] | null;
  createdAt: number;
  updatedAt: number;
  detached: boolean;
  messages: { id: string; role: string; text: string; ts: number }[];
  toolCalls: {
    id: string;
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
  }[];
}
