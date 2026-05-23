import type { ClientToServer, ServerToClient } from "@agent-view/shared";
import { useUIStore } from "../stores/ui-store";

export type WsHandler = (msg: ServerToClient) => void;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const handlers = new Set<WsHandler>();

export function connectWs() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}/ws`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    useUIStore.getState().setWsConnected(true);
  };
  ws.onclose = () => {
    useUIStore.getState().setWsConnected(false);
    scheduleReconnect();
  };
  ws.onerror = () => {
    // onclose will run too
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "") as ServerToClient;
      for (const h of handlers) h(msg);
    } catch {
      // ignore
    }
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWs();
  }, 1500);
}

export function sendWs(msg: ClientToServer) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn("[ws] not open, dropping", msg);
    return;
  }
  ws.send(JSON.stringify(msg));
}

export function onWsMessage(handler: WsHandler) {
  handlers.add(handler);
  return () => handlers.delete(handler);
}
