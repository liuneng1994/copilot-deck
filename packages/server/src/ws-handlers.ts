// WebSocket message handlers. Each entry is a handler for one ClientToServer
// message kind. Keeping them in a map (instead of a switch) lets us add new
// commands without touching the connection lifecycle in main.ts.

import { CURATED_MODELS, type ClientToServer, type ServerToClient } from "@agent-view/shared";
import type { FastifyBaseLogger } from "fastify";
import type { SessionManager } from "./session-manager.js";

export interface WsContext {
  manager: SessionManager;
  send: (msg: ServerToClient) => void;
  log: FastifyBaseLogger;
}

type ClientMsg = ClientToServer;
type Handler<K extends ClientMsg["type"]> = (
  msg: Extract<ClientMsg, { type: K }>,
  ctx: WsContext,
) => Promise<void> | void;

type HandlerMap = Partial<{ [K in ClientMsg["type"]]: Handler<K> }>;

export const wsHandlers: HandlerMap = {
  async create_session(msg, { manager, send }) {
    const { sessionId, modes } = await manager.createSession(msg.cwd);
    send({
      type: "session_created",
      sessionId,
      cwd: msg.cwd,
      modes: modes
        ? {
            currentModeId: modes.currentModeId,
            availableModes: modes.availableModes.map((m) => ({
              id: m.id,
              name: m.name,
              description: m.description ?? undefined,
            })),
          }
        : undefined,
    });
  },

  async prompt(msg, { manager, send }) {
    const res = await manager.prompt(msg.sessionId, msg.text, { attachments: msg.attachments });
    send({ type: "prompt_done", sessionId: msg.sessionId, stopReason: res.stopReason });
  },

  async cancel(msg, { manager }) {
    await manager.cancel(msg.sessionId);
  },

  async set_mode(msg, { manager, send, log }) {
    try {
      await manager.setMode(msg.sessionId, msg.modeId);
    } catch (e) {
      const err = e as { code?: number; data?: { details?: string }; message?: string };
      const details = err?.data?.details ?? err?.message ?? "Unknown error";
      let friendly = `Mode switch failed: ${details}`;
      if (typeof details === "string" && details.toLowerCase().includes("permission service")) {
        friendly =
          "Mode switch failed: Copilot CLI cannot enable this mode for sessions imported from history (its internal permission service only initializes for freshly created sessions). Create a new session in the same folder to use this mode.";
      }
      log.warn({ err }, "set_mode failed");
      send({ type: "error", sessionId: msg.sessionId, message: friendly, severity: "warning" });
    }
  },

  delete_session(msg, { manager }) {
    manager.deleteSession(msg.sessionId);
  },

  rename_session(msg, { manager, send }) {
    const ok = manager.renameSession(msg.sessionId, msg.title);
    if (!ok) {
      send({
        type: "error",
        sessionId: msg.sessionId,
        message: "Rename failed: empty title or unknown session.",
      });
    }
  },

  async duplicate_session(msg, { manager, send }) {
    const src = manager.getStoredSession(msg.sessionId);
    if (!src) {
      send({ type: "error", sessionId: msg.sessionId, message: "Session not found." });
      return;
    }
    const { sessionId, modes } = await manager.createSession(src.cwd);
    send({
      type: "session_created",
      sessionId,
      cwd: src.cwd,
      modes: modes
        ? {
            currentModeId: modes.currentModeId,
            availableModes: modes.availableModes.map((m) => ({
              id: m.id,
              name: m.name,
              description: m.description ?? undefined,
            })),
          }
        : undefined,
    });
  },

  async fork_session(msg, { manager, send }) {
    const src = manager.getStoredSession(msg.sessionId);
    if (!src) {
      send({ type: "error", sessionId: msg.sessionId, message: "Session not found." });
      return;
    }
    try {
      const { sessionId } = await manager.forkSession({
        sourceSessionId: msg.sessionId,
        upToMessageId: msg.messageId,
      });
      // Fetch persisted row to grab the title we just set via renameSession.
      const persisted = manager.getStoredSession(sessionId);
      // The agent's `session_created` notification will also fire when ACP
      // hands us the modes, but we send our own so the requester can switch
      // immediately and learn the new title.
      send({
        type: "session_created",
        sessionId,
        cwd: src.cwd,
        title: persisted?.title ?? undefined,
      });
    } catch (e) {
      send({
        type: "error",
        sessionId: msg.sessionId,
        message: `Fork failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  },

  request_trace(msg, { manager, send }) {
    const events = manager.listTrace({
      sessionId: msg.sessionId,
      sinceId: msg.sinceId,
      limit: msg.limit,
    });
    send({ type: "trace_snapshot", events });
  },

  list_models(_msg, { manager, send }) {
    send({
      type: "models_snapshot",
      models: CURATED_MODELS,
      defaultModel: manager.getDefaultModel(),
      currentByCwd: manager.getModelsByCwd(),
      currentBySession: manager.getModelsBySession(),
    });
  },

  async set_model(msg, { manager }) {
    await manager.setModel(msg.cwd, msg.model);
  },

  async set_session_model(msg, { manager }) {
    await manager.setSessionModel(msg.sessionId, msg.model);
  },

  async reload_session(msg, { manager }) {
    await manager.reloadSession(msg.sessionId, "user");
  },

  async load_older_messages(msg, { manager, send }) {
    try {
      const result = manager.loadOlderMessages(msg.sessionId, {
        beforeTs: msg.beforeTs,
        limit: msg.limit,
      });
      send({
        type: "older_messages",
        sessionId: msg.sessionId,
        messages: result.messages,
        toolCalls: result.toolCalls,
        earliestLoadedTs: result.earliestLoadedTs,
        hasMore: result.hasMore,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      send({
        type: "error",
        sessionId: msg.sessionId,
        message: `Load older failed: ${message}`,
      });
    }
  },

  async reattach_session(msg, { manager, send }) {
    try {
      const result = await manager.reattachSession(msg.sessionId);
      if (result.replacedFrom) {
        send({
          type: "session_replaced",
          oldSessionId: result.replacedFrom,
          newSessionId: result.sessionId,
        });
      } else {
        send({
          type: "session_reattached",
          sessionId: msg.sessionId,
          modeId: result.modeId ?? null,
          modeName: result.modeName ?? null,
          modeOptions: result.modeOptions ?? null,
        });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      send({
        type: "error",
        sessionId: msg.sessionId,
        message: `Reattach failed: ${message}`,
      });
    }
  },

  permission_reply(msg, { manager, log }) {
    const handled = manager.replyPermission(
      msg.requestId,
      msg.outcome,
      msg.optionId,
      msg.trustFolder,
    );
    if (!handled) {
      log.warn({ requestId: msg.requestId }, "stale permission reply");
    }
  },
};

/**
 * Dispatch a parsed client message to its handler. Unknown types are ignored.
 * Errors thrown by handlers are caught and reported back over the socket.
 */
export async function dispatchWs(msg: ClientToServer, ctx: WsContext): Promise<void> {
  const handler = wsHandlers[msg.type] as Handler<typeof msg.type> | undefined;
  if (!handler) {
    ctx.log.warn({ type: msg.type }, "unknown ws message type");
    return;
  }
  try {
    await handler(msg as never, ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.log.error({ err }, "ws handler error");
    ctx.send({
      type: "error",
      sessionId: "sessionId" in msg ? msg.sessionId : undefined,
      message,
    });
  }
}
