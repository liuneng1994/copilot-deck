import { create } from "zustand";

export type SessionStatus = "idle" | "streaming" | "awaiting_perm" | "error";
export type MessageRole = "user" | "agent" | "system";

export interface Message {
  id: string;
  role: MessageRole;
  text: string;
  ts: number;
}

export interface SessionState {
  id: string;
  cwd: string;
  title: string;
  status: SessionStatus;
  mode?: string;
  modeOptions?: { name: string; value: string; description?: string }[];
  availableCommands?: { name: string; description?: string }[];
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  tokensIn?: number;
  tokensOut?: number;
}

export interface UIState {
  sidebarCollapsed: boolean;
  inspectorCollapsed: boolean;
  activeSessionId: string | null;
  wsConnected: boolean;
  lastError: string | null;

  sessions: Record<string, SessionState>;

  toggleSidebar: () => void;
  toggleInspector: () => void;
  setActiveSession: (id: string | null) => void;
  setWsConnected: (v: boolean) => void;
  setLastError: (e: string | null) => void;

  upsertSession: (s: Partial<SessionState> & { id: string }) => void;
  removeSession: (id: string) => void;
  appendUserMessage: (sessionId: string, text: string) => string;
  appendAgentChunk: (sessionId: string, chunk: string) => void;
  appendSystemMessage: (sessionId: string, text: string) => void;
  setSessionStatus: (sessionId: string, status: SessionStatus) => void;
  setAvailableCommands: (
    sessionId: string,
    cmds: { name: string; description?: string }[],
  ) => void;
  setModeOptions: (
    sessionId: string,
    current: string,
    options: { name: string; value: string; description?: string }[],
  ) => void;
}

const nowId = () => Math.random().toString(36).slice(2, 10);

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  inspectorCollapsed: false,
  activeSessionId: null,
  wsConnected: false,
  lastError: null,
  sessions: {},

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleInspector: () => set((s) => ({ inspectorCollapsed: !s.inspectorCollapsed })),
  setActiveSession: (id) => set({ activeSessionId: id }),
  setWsConnected: (v) => set({ wsConnected: v }),
  setLastError: (e) => set({ lastError: e }),

  upsertSession: (s) =>
    set((state) => {
      const existing = state.sessions[s.id];
      const merged: SessionState = {
        id: s.id,
        cwd: s.cwd ?? existing?.cwd ?? "",
        title: s.title ?? existing?.title ?? "New session",
        status: s.status ?? existing?.status ?? "idle",
        mode: s.mode ?? existing?.mode,
        modeOptions: s.modeOptions ?? existing?.modeOptions,
        availableCommands: s.availableCommands ?? existing?.availableCommands,
        messages: s.messages ?? existing?.messages ?? [],
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        tokensIn: s.tokensIn ?? existing?.tokensIn,
        tokensOut: s.tokensOut ?? existing?.tokensOut,
      };
      return { sessions: { ...state.sessions, [s.id]: merged } };
    }),

  removeSession: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.sessions;
      return {
        sessions: rest,
        activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
      };
    }),

  appendUserMessage: (sessionId, text) => {
    const id = nowId();
    set((state) => {
      const s = state.sessions[sessionId];
      if (!s) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...s,
            messages: [...s.messages, { id, role: "user", text, ts: Date.now() }],
            updatedAt: Date.now(),
            title: s.messages.length === 0 ? text.slice(0, 60) : s.title,
          },
        },
      };
    });
    return id;
  },

  appendAgentChunk: (sessionId, chunk) =>
    set((state) => {
      const s = state.sessions[sessionId];
      if (!s) return state;
      const last = s.messages[s.messages.length - 1];
      let messages: Message[];
      if (last && last.role === "agent") {
        messages = [
          ...s.messages.slice(0, -1),
          { ...last, text: last.text + chunk, ts: Date.now() },
        ];
      } else {
        messages = [
          ...s.messages,
          { id: nowId(), role: "agent", text: chunk, ts: Date.now() },
        ];
      }
      return {
        sessions: { ...state.sessions, [sessionId]: { ...s, messages, updatedAt: Date.now() } },
      };
    }),

  appendSystemMessage: (sessionId, text) =>
    set((state) => {
      const s = state.sessions[sessionId];
      if (!s) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...s,
            messages: [
              ...s.messages,
              { id: nowId(), role: "system", text, ts: Date.now() },
            ],
            updatedAt: Date.now(),
          },
        },
      };
    }),

  setSessionStatus: (sessionId, status) =>
    set((state) => {
      const s = state.sessions[sessionId];
      if (!s) return state;
      return {
        sessions: { ...state.sessions, [sessionId]: { ...s, status, updatedAt: Date.now() } },
      };
    }),

  setAvailableCommands: (sessionId, cmds) =>
    set((state) => {
      const s = state.sessions[sessionId];
      if (!s) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...s, availableCommands: cmds, updatedAt: Date.now() },
        },
      };
    }),

  setModeOptions: (sessionId, current, options) =>
    set((state) => {
      const s = state.sessions[sessionId];
      if (!s) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...s, mode: current, modeOptions: options, updatedAt: Date.now() },
        },
      };
    }),
}));
