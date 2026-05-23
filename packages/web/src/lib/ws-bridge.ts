import { useEffect } from "react";
import { connectWs, onWsMessage } from "./ws-client";
import { useUIStore } from "../stores/ui-store";

// Lightweight typed view over the ACP SessionNotification.update payload we care about.
interface AcpUpdate {
  sessionUpdate: string;
  content?: { type: string; text?: string };
  availableCommands?: { name: string; description?: string }[];
  configOptions?: {
    currentValue: string;
    category?: string;
    options: { name: string; value: string; description?: string }[];
  }[];
  [k: string]: unknown;
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
          if (!store.activeSessionId) store.setActiveSession(msg.sessionId);
          break;
        }
        case "session_update": {
          const u = msg.update as AcpUpdate;
          const sid = msg.sessionId;
          switch (u.sessionUpdate) {
            case "agent_message_chunk":
              if (u.content?.type === "text" && u.content.text) {
                store.appendAgentChunk(sid, u.content.text);
              }
              break;
            case "user_message_chunk":
              // mostly a replay/echo; ignore for now
              break;
            case "available_commands_update":
              store.setAvailableCommands(sid, u.availableCommands ?? []);
              break;
            case "config_option_update": {
              const modeCfg = u.configOptions?.find(
                (c) => c.category === "mode" || c.options?.some((o) => o.name === "Agent"),
              );
              if (modeCfg) {
                store.setModeOptions(sid, modeCfg.currentValue, modeCfg.options);
              }
              break;
            }
            default:
              store.appendSystemMessage(
                sid,
                `· ${u.sessionUpdate}`,
              );
          }
          break;
        }
        case "prompt_done": {
          store.setSessionStatus(msg.sessionId, "idle");
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
          // future: route to Inspector → Logs
          break;
      }
    });
    return () => {
      off();
    };
  }, []);
}
