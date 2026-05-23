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
    };
