import { useEffect } from "react";
import { connectWs, onWsMessage } from "./ws-client";
import { useUIStore, type ToolCallContentBlock, type ToolCallStatus } from "../stores/ui-store";

// Lightweight typed view over the ACP SessionNotification.update payload we care about.
interface AcpUpdate {
  sessionUpdate: string;
  // For agent_message_chunk / user_message_chunk this is a single content object.
  // For tool_call / tool_call_update this is an array of content blocks (diff / terminal / text).
  content?:
    | { type: string; text?: string }
    | Array<{
        type?: string;
        path?: string;
        oldText?: string;
        newText?: string;
        content?: { type: string; text?: string };
        [k: string]: unknown;
      }>;
  availableCommands?: { name: string; description?: string }[];
  configOptions?: {
    currentValue: string;
    category?: string;
    options: { name: string; value: string; description?: string }[];
  }[];
  toolCallId?: string;
  title?: string;
  kind?: string;
  status?: ToolCallStatus;
  rawInput?: unknown;
  rawOutput?: unknown;
  diff?: {
    path?: string;
    oldText?: string;
    newText?: string;
  };
  // session_info_update fields (best-effort, copilot may rename)
  contextUsage?: { used?: number; total?: number };
  [k: string]: unknown;
}

function inferKindFromAcp(
  raw: { type?: string; content?: { type?: string } } | undefined,
): ToolCallContentBlock["kind"] {
  if (!raw) return "other";
  const t = raw.type ?? raw.content?.type;
  if (t === "diff") return "diff";
  if (t === "terminal" || t === "terminal_output") return "terminal";
  if (t === "text") return "text";
  if (t === "image") return "image";
  return "other";
}

function blocksFromUpdate(u: AcpUpdate): ToolCallContentBlock[] {
  const out: ToolCallContentBlock[] = [];
  const arr = Array.isArray(u.content) ? u.content : null;
  if (arr) {
    for (const c of arr) {
      const kind = inferKindFromAcp(c);
      const block: ToolCallContentBlock = { kind, raw: c };
      const inner = (c as { content?: { type?: string; text?: string } }).content;
      if (inner?.type === "text" && typeof inner.text === "string") block.text = inner.text;
      if (kind === "diff") {
        block.path = c.path;
        block.oldText = c.oldText;
        block.newText = c.newText;
      }
      out.push(block);
    }
  }
  if (u.diff) {
    out.push({
      kind: "diff",
      path: u.diff.path,
      oldText: u.diff.oldText,
      newText: u.diff.newText,
    });
  }
  return out;
}

/** Subscribes to the WS stream and pushes updates into the UI store. */
export function useWsBridge() {
  useEffect(() => {
    connectWs();
    const off = onWsMessage((msg) => {
      const store = useUIStore.getState();
      switch (msg.type) {
        case "session_created": {
          store.upsertSession({
            id: msg.sessionId,
            cwd: msg.cwd,
            title: "New session",
            status: "idle",
          });
          if (msg.modes) {
            store.setMode(
              msg.sessionId,
              msg.modes.currentModeId,
              msg.modes.availableModes.map((m) => ({
                value: m.id,
                name: m.name,
                description: m.description,
              })),
            );
          }
          if (!store.activeSessionId) store.setActiveSession(msg.sessionId);
          break;
        }
        case "session_update": {
          const u = msg.update as AcpUpdate;
          const sid = msg.sessionId;
          // Some updates (e.g. available_commands_update, config_option_update)
          // arrive BEFORE the session_created reply lands. Ensure a shell exists.
          if (!store.sessions[sid]) {
            store.upsertSession({ id: sid, cwd: "", title: "New session", status: "idle" });
          }
          switch (u.sessionUpdate) {
            case "agent_message_chunk": {
              const c = u.content;
              if (c && !Array.isArray(c) && c.type === "text" && c.text) {
                store.appendAgentChunk(sid, c.text);
              }
              break;
            }
            case "user_message_chunk":
              break;
            case "available_commands_update":
              store.setAvailableCommands(sid, u.availableCommands ?? []);
              break;
            case "config_option_update": {
              const modeCfg = u.configOptions?.find(
                (c) => c.category === "mode" || c.options?.some((o) => o.name === "Agent"),
              );
              if (modeCfg) {
                store.setMode(sid, modeCfg.currentValue, modeCfg.options);
              }
              break;
            }
            case "current_mode_update": {
              const cmu = u as unknown as { currentModeId?: string };
              const existing = store.sessions[sid];
              if (cmu.currentModeId && existing?.modeOptions) {
                store.setMode(sid, cmu.currentModeId, existing.modeOptions);
              }
              break;
            }
            case "tool_call": {
              if (!u.toolCallId) break;
              store.upsertToolCall({
                id: u.toolCallId,
                sessionId: sid,
                kind: u.kind ?? "tool",
                title: u.title ?? u.kind ?? "tool",
                status: u.status ?? "pending",
                rawInput: u.rawInput,
                content: blocksFromUpdate(u),
              });
              break;
            }
            case "tool_call_update": {
              if (!u.toolCallId) break;
              store.upsertToolCall({
                id: u.toolCallId,
                sessionId: sid,
                status: u.status,
                title: u.title,
                kind: u.kind,
                rawInput: u.rawInput,
              });
              for (const block of blocksFromUpdate(u)) {
                store.appendToolCallContent(u.toolCallId, block);
              }
              break;
            }
            case "plan":
            case "session_info_update":
              // future: dedicated handling; for now silently absorbed.
              break;
            default:
              store.appendSystemMessage(sid, `· ${u.sessionUpdate}`);
          }
          break;
        }
        case "prompt_done": {
          store.setSessionStatus(msg.sessionId, "idle");
          break;
        }
        case "permission_request": {
          store.enqueuePermission({
            requestId: msg.requestId,
            sessionId: msg.sessionId,
            toolCall: msg.toolCall,
            options: msg.options,
            receivedAt: Date.now(),
          });
          store.setSessionStatus(msg.sessionId, "awaiting_perm");
          break;
        }
        case "error": {
          if (msg.sessionId) {
            store.setSessionStatus(msg.sessionId, "error");
            store.appendSystemMessage(msg.sessionId, `error: ${msg.message}`);
          } else {
            store.setLastError(msg.message);
          }
          break;
        }
        case "log":
          break;
      }
    });
    return () => {
      off();
    };
  }, []);
}
