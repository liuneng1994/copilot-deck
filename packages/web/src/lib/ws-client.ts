import type { ClientToServer, ServerToClient } from "@agent-view/shared";
import { useUIStore } from "../stores/ui-store";

export type WsHandler = (msg: ServerToClient) => void;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = 500;
const BACKOFF_MAX = 8000;
const handlers = new Set<WsHandler>();

export function connectWs() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const url = `${proto}://${location.host}/ws`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    backoffMs = 500;
    useUIStore.getState().setWsConnected(true);
    // Fetch the curated model list once we're connected.
    try {
      ws?.send(JSON.stringify({ type: "list_models" } satisfies ClientToServer));
    } catch {
      // ignore
    }
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
  const wait = backoffMs;
  backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWs();
  }, wait);
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
