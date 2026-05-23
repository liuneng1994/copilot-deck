// Wire protocol between the agent-view server and the React web UI.
// Kept intentionally small for M0 (single session, hello-world flow).

export type ClientToServer =
  | { type: "create_session"; cwd: string }
  | { type: "prompt"; sessionId: string; text: string }
  | { type: "cancel"; sessionId: string };

export type ServerToClient =
  | { type: "session_created"; sessionId: string; cwd: string }
  | {
      type: "session_update";
      sessionId: string;
      update: unknown;
    }
  | { type: "prompt_done"; sessionId: string; stopReason: string }
  | { type: "error"; sessionId?: string; message: string }
  | { type: "log"; level: "info" | "warn" | "error"; message: string };
