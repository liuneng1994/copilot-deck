import { useEffect } from "react";
import { type ToolCallContentBlock, type ToolCallStatus, useUIStore } from "../stores/ui-store";
import { normalizeContentBlock } from "./normalize-content";
import { connectWs, onWsMessage } from "./ws-client";

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
  status?: unknown;
  rawInput?: unknown;
  rawOutput?: unknown;
  /** Files / lines this tool touched. Present on tool_call and tool_call_update. */
  locations?: { path?: string; line?: number }[];
  diff?: {
    path?: string;
    oldText?: string;
    newText?: string;
  };
  // session_info_update fields (best-effort, copilot may rename)
  contextUsage?: { used?: number; total?: number };
  // current_mode_update
  currentModeId?: string;
  [k: string]: unknown;
}

function isToolCallStatus(status: unknown): status is ToolCallStatus {
  return (
    status === "pending" ||
    status === "in_progress" ||
    status === "completed" ||
    status === "failed"
  );
}

function blocksFromUpdate(u: AcpUpdate): ToolCallContentBlock[] {
  const out: ToolCallContentBlock[] = [];
  const arr = Array.isArray(u.content) ? u.content : null;
  if (arr) {
    for (const c of arr) {
      out.push(normalizeContentBlock(c));
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
            title: msg.title ?? "New session",
            status: "idle",
            renderHintMode: "prompt",
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
          if (!store.activeSessionId || /^fork/.test(msg.title ?? ""))
            store.setActiveSession(msg.sessionId);
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
                status: isToolCallStatus(u.status) ? u.status : "pending",
                rawInput: u.rawInput,
                rawOutput: u.rawOutput,
                content: blocksFromUpdate(u),
                locations: u.locations
                  ?.filter((l): l is { path: string; line?: number } => typeof l.path === "string")
                  .map((l) => ({ path: l.path, line: l.line })),
              });
              break;
            }
            case "tool_call_update": {
              if (!u.toolCallId) break;
              store.upsertToolCall({
                id: u.toolCallId,
                sessionId: sid,
                status: isToolCallStatus(u.status) ? u.status : undefined,
                title: u.title,
                kind: u.kind,
                rawInput: u.rawInput,
                rawOutput: u.rawOutput,
                locations: u.locations
                  ?.filter((l): l is { path: string; line?: number } => typeof l.path === "string")
                  .map((l) => ({ path: l.path, line: l.line })),
              });
              for (const block of blocksFromUpdate(u)) {
                store.appendToolCallContent(u.toolCallId, block);
              }
              break;
            }
            case "plan": {
              const entries = (u as unknown as { entries?: unknown[] }).entries;
              if (Array.isArray(entries)) {
                store.setSessionPlan(
                  sid,
                  entries.map((raw) => {
                    const e = raw as { content?: unknown; priority?: unknown; status?: unknown };
                    const allowedPriority = ["low", "medium", "high"] as const;
                    const allowedStatus = ["pending", "in_progress", "completed"] as const;
                    return {
                      content: typeof e.content === "string" ? e.content : "",
                      priority: allowedPriority.includes(
                        e.priority as (typeof allowedPriority)[number],
                      )
                        ? (e.priority as (typeof allowedPriority)[number])
                        : undefined,
                      status: allowedStatus.includes(e.status as (typeof allowedStatus)[number])
                        ? (e.status as (typeof allowedStatus)[number])
                        : undefined,
                    };
                  }),
                );
              }
              break;
            }
            case "session_info_update": {
              const cu = u.contextUsage;
              if (cu) store.setSessionCtx(sid, cu.used, cu.total);
              break;
            }
            case "status_update": {
              const status = typeof u.status === "string" ? u.status : undefined;
              if (
                status === "idle" ||
                status === "streaming" ||
                status === "awaiting_perm" ||
                status === "reloading" ||
                status === "error"
              ) {
                store.setSessionStatus(sid, status);
                if (status === "idle") store.dismissReloadSuggestion(sid);
              }
              break;
            }
            case "agent_thought_chunk":
              // Internal thinking stream — suppress; could surface in future via
              // a dedicated "thinking" panel.
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
            // If a reattach was in flight for this session, clear the spinner
            // so the user can retry.
            store.setReattaching(msg.sessionId, false);
          } else {
            store.setLastError(msg.message);
          }
          break;
        }
        case "log":
          break;
        case "child_exit": {
          for (const sid of msg.sessionIds) {
            store.markSessionCrashed(sid, { code: msg.code, signal: msg.signal });
            store.markSessionDetached(sid, true);
            store.appendSystemMessage(
              sid,
              `⚠ copilot child exited (code=${msg.code ?? "?"} signal=${msg.signal ?? "?"}). Create a new session to continue.`,
            );
          }
          if (msg.sessionIds.length === 0) {
            store.setLastError(`copilot child for ${msg.cwd} exited`);
          }
          break;
        }
        case "hydrate": {
          store.hydrate(msg.sessions);
          for (const session of msg.sessions) {
            store.hydrateReviewed(
              session.id,
              (session.reviewed ?? []).map((item) => item.path),
            );
          }
          const after = useUIStore.getState();
          if (!after.activeSessionId && msg.sessions.length > 0) {
            after.setActiveSession(msg.sessions[0].id);
          }
          break;
        }
        case "trace_event": {
          store.appendTrace(msg.event);
          break;
        }
        case "trace_snapshot": {
          store.setTrace(msg.events);
          break;
        }
        case "extensions_list": {
          if (msg.kind === "plugins") {
            void store.loadPlugins();
          } else if (msg.kind === "marketplaces") {
            void store.loadMarketplaces();
          }
          break;
        }
        case "git_status": {
          store.recordGitStatus(msg.cwd, msg.payload);
          break;
        }
        case "files_index_invalidated": {
          store.invalidateFilesIndex(msg.cwd);
          break;
        }
        case "file_changed": {
          break;
        }
        case "grep_chunk": {
          store.appendGrepChunk(msg.opId, msg.hits);
          break;
        }
        case "grep_done": {
          store.finalizeGrep(msg.opId, msg);
          break;
        }
        case "session_reload_suggested": {
          store.suggestSessionReload(msg.sessionId, {
            reason: msg.reason,
            affectedBy: msg.affectedBy,
          });
          break;
        }
        case "extension_op_progress": {
          store.recordExtOpProgress(msg);
          break;
        }
        case "extension_op_done": {
          store.recordExtOpDone(msg);
          break;
        }
        case "models_snapshot": {
          store.setModels(msg.models, msg.defaultModel, msg.currentByCwd, msg.currentBySession);
          break;
        }
        case "model_changed": {
          store.setModelForCwd(msg.cwd, msg.model);
          // Affected sessions are already handled by child_exit broadcast.
          break;
        }
        case "session_model_changed": {
          store.setModelForSession(msg.sessionId, msg.model);
          break;
        }
        case "session_reattached": {
          store.markSessionDetached(msg.sessionId, false);
          store.setReattaching(msg.sessionId, false);
          store.setSessionStatus(msg.sessionId, "idle");
          store.dismissReloadSuggestion(msg.sessionId);
          break;
        }
        case "session_replaced": {
          const state = useUIStore.getState();
          const old = state.sessions[msg.oldSessionId];
          if (old) {
            state.upsertSession({
              id: msg.newSessionId,
              cwd: old.cwd,
              title: old.title,
              modeId: old.modeId,
              modeName: old.modeName,
              modeOptions: old.modeOptions,
              availableCommands: old.availableCommands,
              detached: false,
            });
            state.setSessionStatus(msg.newSessionId, "idle");
            state.setReattaching(msg.newSessionId, false);
          }
          state.removeSession(msg.oldSessionId);
          if (state.activeSessionId === msg.oldSessionId) {
            state.setActiveSession(msg.newSessionId);
          }
          state.dismissReloadSuggestion(msg.oldSessionId);
          break;
        }
        case "session_renamed": {
          store.upsertSession({ id: msg.sessionId, title: msg.title });
          break;
        }
        case "update_available": {
          // Honor the user's snooze deadline.
          const until = store.updateSnoozedUntil ?? 0;
          if (Date.now() < until) break;
          store.setAvailableUpdate({
            installed: msg.installed,
            latest: msg.latest,
            tag: msg.tag,
            url: msg.url,
            notes: msg.notes,
            publishedAt: msg.publishedAt,
          });
          break;
        }
      }
    });
    return () => {
      off();
    };
  }, []);
}
