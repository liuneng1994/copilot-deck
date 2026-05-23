import { create } from "zustand";
import type { PermissionOption, PermissionToolCallSnapshot } from "@agent-view/shared";

export type SessionStatus = "idle" | "streaming" | "awaiting_perm" | "error";
export type MessageRole = "user" | "agent" | "system";

export interface Message {
  id: string;
  role: MessageRole;
  text: string;
  ts: number;
}

export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export interface ToolCallContentBlock {
  kind: "text" | "diff" | "terminal" | "json" | "image" | "other";
  text?: string;
  path?: string;
  oldText?: string;
  newText?: string;
  raw?: unknown;
}

export interface ToolCallState {
  id: string;
  sessionId: string;
  /** First-seen timestamp; used for timeline ordering. */
  ts: number;
  kind: string;
  title: string;
  status: ToolCallStatus;
  rawInput?: unknown;
  content: ToolCallContentBlock[];
  startedAt: number;
  finishedAt?: number;
  /** Last-known plain-text input rendering for the card header. */
  inputSummary?: string;
}

export interface ModeOption {
  name: string;
  value: string;
  description?: string;
}

export interface SessionState {
  id: string;
  cwd: string;
  title: string;
  status: SessionStatus;
  /** Mode display name (e.g. "Agent"). */
  modeName?: string;
  /** Mode value/id used in set_mode. */
  modeId?: string;
  modeOptions?: ModeOption[];
  availableCommands?: { name: string; description?: string }[];
  messages: Message[];
  toolCallIds: string[];
  createdAt: number;
  updatedAt: number;
  tokensIn?: number;
  tokensOut?: number;
}

export interface PermissionRequest {
  requestId: string;
  sessionId: string;
  toolCall: PermissionToolCallSnapshot;
  options: PermissionOption[];
  receivedAt: number;
}

export interface UIState {
  sidebarCollapsed: boolean;
  inspectorCollapsed: boolean;
  activeSessionId: string | null;
  wsConnected: boolean;
  lastError: string | null;

  sessions: Record<string, SessionState>;
  toolCalls: Record<string, ToolCallState>;
  permissionQueue: PermissionRequest[];

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
  setMode: (sessionId: string, currentValue: string, options: ModeOption[]) => void;

  upsertToolCall: (call: Partial<ToolCallState> & { id: string; sessionId: string }) => void;
  appendToolCallContent: (id: string, block: ToolCallContentBlock) => void;

  enqueuePermission: (req: PermissionRequest) => void;
  dismissPermission: (requestId: string) => void;
}

const nowId = () => Math.random().toString(36).slice(2, 10);

function summarizeInput(input: unknown): string | undefined {
  if (input == null) return undefined;
  if (typeof input === "string") return input.slice(0, 120);
  try {
    const s = JSON.stringify(input);
    if (s.length <= 80) return s;
    if (typeof input === "object") {
      const obj = input as Record<string, unknown>;
      for (const k of ["path", "file_path", "command", "filename", "query"]) {
        if (typeof obj[k] === "string") return `${k}: ${(obj[k] as string).slice(0, 100)}`;
      }
    }
    return s.slice(0, 100) + "…";
  } catch {
    return undefined;
  }
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  inspectorCollapsed: false,
  activeSessionId: null,
  wsConnected: false,
  lastError: null,
  sessions: {},
  toolCalls: {},
  permissionQueue: [],

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
        modeName: s.modeName ?? existing?.modeName,
        modeId: s.modeId ?? existing?.modeId,
        modeOptions: s.modeOptions ?? existing?.modeOptions,
        availableCommands: s.availableCommands ?? existing?.availableCommands,
        messages: s.messages ?? existing?.messages ?? [],
        toolCallIds: s.toolCallIds ?? existing?.toolCallIds ?? [],
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

  setMode: (sessionId, currentValue, options) =>
    set((state) => {
      const s = state.sessions[sessionId];
      if (!s) return state;
      const opt = options.find((o) => o.value === currentValue);
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...s,
            modeId: currentValue,
            modeName: opt?.name ?? currentValue,
            modeOptions: options,
            updatedAt: Date.now(),
          },
        },
      };
    }),

  upsertToolCall: (call) =>
    set((state) => {
      const existing = state.toolCalls[call.id];
      const now = Date.now();
      const merged: ToolCallState = {
        id: call.id,
        sessionId: call.sessionId,
        ts: existing?.ts ?? now,
        kind: call.kind ?? existing?.kind ?? "tool",
        title: call.title ?? existing?.title ?? call.kind ?? existing?.kind ?? "tool",
        status: call.status ?? existing?.status ?? "pending",
        rawInput: call.rawInput ?? existing?.rawInput,
        content: call.content ?? existing?.content ?? [],
        startedAt: existing?.startedAt ?? now,
        finishedAt:
          call.status === "completed" || call.status === "failed"
            ? now
            : existing?.finishedAt,
        inputSummary:
          existing?.inputSummary ?? summarizeInput(call.rawInput ?? existing?.rawInput),
      };

      const sessions = { ...state.sessions };
      const session = sessions[call.sessionId];
      if (session && !session.toolCallIds.includes(call.id)) {
        sessions[call.sessionId] = {
          ...session,
          toolCallIds: [...session.toolCallIds, call.id],
          updatedAt: now,
        };
      }
      return {
        toolCalls: { ...state.toolCalls, [call.id]: merged },
        sessions,
      };
    }),

  appendToolCallContent: (id, block) =>
    set((state) => {
      const existing = state.toolCalls[id];
      if (!existing) return state;
      return {
        toolCalls: {
          ...state.toolCalls,
          [id]: { ...existing, content: [...existing.content, block] },
        },
      };
    }),

  enqueuePermission: (req) =>
    set((state) => ({
      permissionQueue: [...state.permissionQueue.filter((r) => r.requestId !== req.requestId), req],
    })),

  dismissPermission: (requestId) =>
    set((state) => ({
      permissionQueue: state.permissionQueue.filter((r) => r.requestId !== requestId),
    })),
}));
