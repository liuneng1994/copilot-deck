// Persist ACP session updates into SQLite. Stateless helpers driven by the
// MessageStream aggregator owned by SessionManager.

import { randomUUID } from "node:crypto";
import type * as acp from "@agentclientprotocol/sdk";
import type { Store } from "../store.js";

/** In-flight accumulator for the current agent reply text. One per session. */
export interface MessageStream {
  agentMessageId: string | null;
  agentBuf: string;
}

interface SessionUpdateContext {
  cwd: string;
  store: Store;
  /** Caller-owned per-session stream map; we look up / create entries here. */
  streams: Map<string, MessageStream>;
}

/**
 * Mirror an incoming ACP `sessionUpdate` into SQLite. Best-effort — errors
 * are logged but never thrown, since the websocket fan-out should still happen.
 */
export function persistSessionUpdate(
  ctx: SessionUpdateContext,
  params: acp.SessionNotification,
): void {
  try {
    const sid = params.sessionId;
    const update = params.update as Record<string, unknown> & { sessionUpdate?: string };
    const kind = update?.sessionUpdate;
    const now = Date.now();

    const ensureStream = (): MessageStream => {
      let s = ctx.streams.get(sid);
      if (!s) {
        s = { agentMessageId: null, agentBuf: "" };
        ctx.streams.set(sid, s);
      }
      return s;
    };

    const ensureSession = () => {
      const existing = ctx.store.getSession(sid);
      if (existing) return existing;
      const seed = {
        id: sid,
        cwd: ctx.cwd,
        title: null as string | null,
        status: "idle" as string | null,
        modeId: null as string | null,
        modeName: null as string | null,
        modeOptions: null as { id: string; name: string; description?: string }[] | null,
        availableCommands: null as { name: string; description?: string }[] | null,
        createdAt: now,
        updatedAt: now,
        detached: false,
      };
      ctx.store.upsertSession(seed);
      return seed;
    };

    if (kind === "agent_message_chunk" || kind === "user_message_chunk") {
      const content = update.content as { type?: string; text?: string } | undefined;
      const text = content?.type === "text" ? (content.text ?? "") : "";
      if (!text) return;
      ensureSession();
      const stream = ensureStream();
      if (kind === "agent_message_chunk") {
        if (!stream.agentMessageId) {
          stream.agentMessageId = randomUUID();
          stream.agentBuf = text;
          ctx.store.insertMessage({
            id: stream.agentMessageId,
            sessionId: sid,
            role: "agent",
            text,
            ts: now,
          });
        } else {
          stream.agentBuf += text;
          ctx.store.updateMessageText(stream.agentMessageId, stream.agentBuf);
        }
      } else {
        // user_message_chunk (rare — usually we recorded on prompt). Append to a fresh msg.
        ctx.store.insertMessage({
          id: randomUUID(),
          sessionId: sid,
          role: "user",
          text,
          ts: now,
        });
      }
      return;
    }

    if (kind === "tool_call" || kind === "tool_call_update") {
      ensureSession();
      // Flush any current agent stream — tool calls slot into the message timeline.
      const stream = ctx.streams.get(sid);
      if (stream) {
        stream.agentMessageId = null;
        stream.agentBuf = "";
      }
      const u = update as Record<string, unknown>;
      const id = String(u.toolCallId ?? u.id ?? "");
      if (!id) return;
      const existing = ctx.store.getToolCall(id);
      const status = u.status as string | undefined;
      const merged = {
        id,
        sessionId: sid,
        kind: (u.kind as string | undefined) ?? existing?.kind ?? "",
        title: (u.title as string | undefined) ?? existing?.title ?? "",
        status: status ?? existing?.status ?? "pending",
        rawInput: u.rawInput ?? existing?.rawInput ?? null,
        rawOutput: u.rawOutput ?? existing?.rawOutput ?? null,
        content: (u.content as unknown[] | undefined) ?? existing?.content ?? ([] as unknown[]),
        locations:
          (u.locations as { path: string; line?: number }[] | undefined) ??
          existing?.locations ??
          null,
        startedAt: existing?.startedAt ?? now,
        finishedAt:
          status === "completed" || status === "failed" ? now : (existing?.finishedAt ?? null),
        ts: now,
      };
      ctx.store.upsertToolCall(merged);
      ctx.store.touchSession(sid);
      return;
    }

    if (kind === "current_mode_update") {
      const persisted = ensureSession();
      const modeId = (update.currentModeId as string | undefined) ?? null;
      const opt = persisted.modeOptions?.find((m) => m.id === modeId);
      ctx.store.upsertSession({
        ...persisted,
        modeId,
        modeName: opt?.name ?? persisted.modeName,
        updatedAt: now,
      });
      return;
    }

    if (kind === "available_commands_update") {
      const persisted = ensureSession();
      const cmds =
        (update.availableCommands as { name: string; description?: string }[] | undefined) ?? [];
      ctx.store.upsertSession({
        ...persisted,
        availableCommands: cmds,
        updatedAt: now,
      });
      return;
    }

    if (kind === "session_info_update") {
      // Best-effort title from first user prompt; skip for now (UI derives).
      ensureSession();
      ctx.store.touchSession(sid);
      return;
    }
  } catch (e) {
    console.error("persistSessionUpdate error", e);
  }
}
