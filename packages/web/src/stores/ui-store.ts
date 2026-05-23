import type {
  HydratedSession,
  ModelInfo,
  PermissionOption,
  PermissionToolCallSnapshot,
  TraceEventDTO,
} from "@agent-view/shared";
import { create } from "zustand";

export type SessionStatus = "idle" | "streaming" | "awaiting_perm" | "error";
export type MessageRole = "user" | "agent" | "system";

export interface Message {
  id: string;
  role: MessageRole;
  text: string;
  ts: number;
  /** Stop reason populated when this message was cut short (e.g. user cancelled). */
  stopReason?: "cancelled" | "error";
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
  rawOutput?: unknown;
  content: ToolCallContentBlock[];
  /** ACP `locations` field — files the tool touched. */
  locations?: { path: string; line?: number }[];
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

export interface PlanEntry {
  content: string;
  priority?: "low" | "medium" | "high";
  status?: "pending" | "in_progress" | "completed";
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
  /** Latest ACP plan snapshot for the session. */
  plan?: PlanEntry[];
  messages: Message[];
  toolCallIds: string[];
  createdAt: number;
  updatedAt: number;
  tokensIn?: number;
  tokensOut?: number;
  /** Context window usage if session_info_update provided it. */
  ctxUsed?: number;
  ctxTotal?: number;
  /** Set to true when the underlying child process exited unexpectedly. */
  crashed?: boolean;
  crashInfo?: { code: number | null; signal: string | null };
  /** Persisted-only session whose child has exited; read-only history view. */
  detached?: boolean;
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

  /** Whether the initial hydration message has been processed. */
  hydrated: boolean;
  /** Bounded ring of recent trace events. */
  trace: TraceEventDTO[];
  /** Filters for the trace drawer. */
  traceFilters: { direction?: "in" | "out"; sessionScope: boolean };
  traceDrawerOpen: boolean;
  /** Active tab in the inspector pane. */
  inspectorTab: "plan" | "tools" | "files" | "terminal" | "config";
  /** Help/keyboard reference overlay. */
  helpOpen: boolean;
  findOpen: boolean;
  /** Banner-style transient notice shown above the conversation. */
  notice: { id: string; kind: "info" | "warn"; text: string; ts: number } | null;
  /** Curated model list (loaded on connect via list_models). */
  models: ModelInfo[];
  /** Default model id from server (read from ~/.copilot/settings.json). */
  defaultModel: string | null;
  /** Per-cwd current model — empty means "use defaultModel". */
  modelByCwd: Record<string, string>;
  /** Model picker overlay visibility. */
  modelPickerOpen: boolean;
  /** Inspector Files-tab: which path the user opened (clicked or set externally). */
  filePreviewPath: string | null;
  /** Per-session unsent composer drafts. Persisted in localStorage. */
  drafts: Record<string, string>;
  /** Per-session sent-prompt history for ↑/↓ recall. Persisted in localStorage. */
  promptHistory: Record<string, string[]>;
  /** Sidebar / Inspector pane widths in px. Persisted in localStorage. */
  sidebarWidth: number;
  inspectorWidth: number;

  toggleSidebar: () => void;
  toggleInspector: () => void;
  setActiveSession: (id: string | null) => void;
  setWsConnected: (v: boolean) => void;
  setLastError: (e: string | null) => void;

  upsertSession: (s: Partial<SessionState> & { id: string }) => void;
  removeSession: (id: string) => void;
  hydrate: (sessions: HydratedSession[]) => void;
  markSessionDetached: (sessionId: string, detached: boolean) => void;
  appendUserMessage: (sessionId: string, text: string) => string;
  appendAgentChunk: (sessionId: string, chunk: string) => void;
  appendSystemMessage: (sessionId: string, text: string) => void;
  setSessionStatus: (sessionId: string, status: SessionStatus) => void;
  /** Tag the last agent message (if any) with the given stop reason. */
  markLastAgentStopped: (sessionId: string, reason: NonNullable<Message["stopReason"]>) => void;
  setAvailableCommands: (sessionId: string, cmds: { name: string; description?: string }[]) => void;
  setSessionPlan: (sessionId: string, plan: PlanEntry[]) => void;
  setMode: (sessionId: string, currentValue: string, options: ModeOption[]) => void;

  upsertToolCall: (call: Partial<ToolCallState> & { id: string; sessionId: string }) => void;
  appendToolCallContent: (id: string, block: ToolCallContentBlock) => void;

  setSessionCtx: (sessionId: string, used: number | undefined, total: number | undefined) => void;
  markSessionCrashed: (
    sessionId: string,
    info: { code: number | null; signal: string | null },
  ) => void;

  enqueuePermission: (req: PermissionRequest) => void;
  dismissPermission: (requestId: string) => void;

  appendTrace: (ev: TraceEventDTO) => void;
  setTrace: (events: TraceEventDTO[]) => void;
  clearTrace: () => void;
  setTraceFilters: (f: Partial<UIState["traceFilters"]>) => void;
  setTraceDrawerOpen: (open: boolean) => void;
  setInspectorTab: (tab: UIState["inspectorTab"]) => void;
  setHelpOpen: (open: boolean) => void;
  setFindOpen: (open: boolean) => void;
  setNotice: (n: UIState["notice"]) => void;
  setModels: (
    models: ModelInfo[],
    defaultModel: string,
    currentByCwd: Record<string, string>,
  ) => void;
  setModelForCwd: (cwd: string, model: string) => void;
  setModelPickerOpen: (open: boolean) => void;
  setFilePreviewPath: (path: string | null) => void;
  setDraft: (sessionId: string, text: string) => void;
  /** Update the sidebar/inspector width (px) with min/max clamp; persists to localStorage. */
  setSidebarWidth: (px: number) => void;
  setInspectorWidth: (px: number) => void;
  /**
   * Force Composer to reload its text from the persisted draft. Increment-only
   * counter Composer subscribes to; used by message-bubble Edit and similar
   * actions that change the draft from outside the textarea.
   */
  composerLoadEpoch: Record<string, number>;
  bumpComposerLoad: (sessionId: string) => void;
  pushPromptHistory: (sessionId: string, text: string) => void;
  /** Wipe messages and tool calls for a session locally (does NOT touch the DB). */
  clearSessionMessages: (sessionId: string) => void;
}

const nowId = () => Math.random().toString(36).slice(2, 10);

function sigForBlock(b: ToolCallContentBlock): string {
  if (b.kind === "diff") return `diff:${b.path ?? ""}:${b.oldText ?? ""}:${b.newText ?? ""}`;
  if (b.kind === "text") return `text:${b.text ?? ""}`;
  if (b.kind === "terminal") return `term:${b.text ?? JSON.stringify(b.raw ?? "")}`;
  try {
    return `${b.kind}:${JSON.stringify(b.raw ?? "")}`;
  } catch {
    return `${b.kind}:?`;
  }
}

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
    return `${s.slice(0, 100)}…`;
  } catch {
    return undefined;
  }
}

const DRAFTS_KEY = "agent-view:drafts:v1";
function loadDrafts(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, string>;
  } catch {}
  return {};
}
function saveDrafts(drafts: Record<string, string>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
  } catch {}
}

const HISTORY_KEY = "agent-view:prompt-history:v1";
const HISTORY_MAX_PER_SESSION = 50;
function loadPromptHistory(): Record<string, string[]> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, string[]>;
  } catch {}
  return {};
}
function savePromptHistory(history: Record<string, string[]>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {}
}

const PANEL_WIDTHS_KEY = "agent-view:panel-widths:v1";
export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 480;
export const INSPECTOR_MIN = 240;
export const INSPECTOR_MAX = 640;
function loadPanelWidths(): { sidebar: number; inspector: number } {
  const defaults = { sidebar: 256, inspector: 320 };
  if (typeof localStorage === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(PANEL_WIDTHS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as { sidebar?: unknown; inspector?: unknown };
    return {
      sidebar:
        typeof parsed.sidebar === "number" && parsed.sidebar >= SIDEBAR_MIN
          ? Math.min(SIDEBAR_MAX, parsed.sidebar)
          : defaults.sidebar,
      inspector:
        typeof parsed.inspector === "number" && parsed.inspector >= INSPECTOR_MIN
          ? Math.min(INSPECTOR_MAX, parsed.inspector)
          : defaults.inspector,
    };
  } catch {}
  return defaults;
}
function savePanelWidths(w: { sidebar: number; inspector: number }): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PANEL_WIDTHS_KEY, JSON.stringify(w));
  } catch {}
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
  hydrated: false,
  trace: [],
  traceFilters: { sessionScope: true },
  traceDrawerOpen: false,
  inspectorTab: "tools",
  helpOpen: false,
  findOpen: false,
  notice: null,
  models: [],
  defaultModel: null,
  modelByCwd: {},
  modelPickerOpen: false,
  filePreviewPath: null,
  drafts: loadDrafts(),
  promptHistory: loadPromptHistory(),
  composerLoadEpoch: {},
  sidebarWidth: loadPanelWidths().sidebar,
  inspectorWidth: loadPanelWidths().inspector,

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
        detached: s.detached ?? existing?.detached,
        crashed: s.crashed ?? existing?.crashed,
        crashInfo: s.crashInfo ?? existing?.crashInfo,
        ctxUsed: s.ctxUsed ?? existing?.ctxUsed,
        ctxTotal: s.ctxTotal ?? existing?.ctxTotal,
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
        messages = [...s.messages, { id: nowId(), role: "agent", text: chunk, ts: Date.now() }];
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
            messages: [...s.messages, { id: nowId(), role: "system", text, ts: Date.now() }],
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

  markLastAgentStopped: (sessionId, reason) =>
    set((state) => {
      const s = state.sessions[sessionId];
      if (!s) return state;
      // Walk backward; tag the most recent agent message that doesn't already
      // carry a stopReason (e.g. cancel-immediately-after-cancel is a no-op).
      let idx = -1;
      for (let i = s.messages.length - 1; i >= 0; i--) {
        const m = s.messages[i];
        if (!m) continue;
        if (m.role === "agent") {
          if (!m.stopReason) idx = i;
          break;
        }
      }
      if (idx < 0) return state;
      const messages = [...s.messages];
      const target = messages[idx];
      if (!target) return state;
      messages[idx] = { ...target, stopReason: reason };
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...s, messages, updatedAt: Date.now() },
        },
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

  setSessionPlan: (sessionId, plan) =>
    set((state) => {
      const s = state.sessions[sessionId];
      if (!s) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...s, plan, updatedAt: Date.now() },
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
        rawOutput: call.rawOutput ?? existing?.rawOutput,
        content: call.content ?? existing?.content ?? [],
        locations: call.locations ?? existing?.locations,
        startedAt: existing?.startedAt ?? now,
        finishedAt:
          call.status === "completed" || call.status === "failed" ? now : existing?.finishedAt,
        inputSummary: existing?.inputSummary ?? summarizeInput(call.rawInput ?? existing?.rawInput),
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
      const sig = sigForBlock(block);
      if (existing.content.some((b) => sigForBlock(b) === sig)) return state;
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

  setSessionCtx: (sessionId, used, total) =>
    set((state) => {
      const existing = state.sessions[sessionId];
      if (!existing) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...existing, ctxUsed: used, ctxTotal: total },
        },
      };
    }),

  markSessionCrashed: (sessionId, info) =>
    set((state) => {
      const existing = state.sessions[sessionId];
      if (!existing) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...existing,
            status: "error",
            crashed: true,
            crashInfo: info,
            updatedAt: Date.now(),
          },
        },
      };
    }),

  markSessionDetached: (sessionId, detached) =>
    set((state) => {
      const existing = state.sessions[sessionId];
      if (!existing) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...existing,
            detached,
            // Reattaching also clears the crashed flag / banner.
            ...(detached ? {} : { crashed: false, crashInfo: undefined }),
            updatedAt: Date.now(),
          },
        },
      };
    }),

  hydrate: (hydrated) =>
    set((state) => {
      const sessions: Record<string, SessionState> = { ...state.sessions };
      const toolCalls: Record<string, ToolCallState> = { ...state.toolCalls };
      for (const h of hydrated) {
        // Don't trample an already-live session (e.g. one created in this tab pre-WS-ready).
        if (sessions[h.id] && sessions[h.id].messages.length > 0) continue;
        const messages: Message[] = h.messages.map((m) => ({
          id: m.id,
          role: m.role as MessageRole,
          text: m.text,
          ts: m.ts,
        }));
        const toolCallIds: string[] = [];
        for (const c of h.toolCalls) {
          toolCallIds.push(c.id);
          toolCalls[c.id] = {
            id: c.id,
            sessionId: h.id,
            ts: c.ts,
            kind: c.kind,
            title: c.title || c.kind,
            status: (c.status as ToolCallStatus) ?? "completed",
            rawInput: c.rawInput,
            rawOutput: c.rawOutput,
            content: (c.content as ToolCallContentBlock[]) ?? [],
            locations: c.locations ?? undefined,
            startedAt: c.startedAt,
            finishedAt: c.finishedAt ?? undefined,
            inputSummary: summarizeInput(c.rawInput),
          };
        }
        sessions[h.id] = {
          id: h.id,
          cwd: h.cwd,
          title: h.title ?? messages[0]?.text.slice(0, 60) ?? "Session",
          status: h.detached ? "idle" : ((h.status as SessionStatus) ?? "idle"),
          modeName: h.modeName ?? undefined,
          modeId: h.modeId ?? undefined,
          modeOptions: h.modeOptions
            ? h.modeOptions.map((m) => ({ name: m.name, value: m.id, description: m.description }))
            : undefined,
          availableCommands: h.availableCommands ?? undefined,
          plan: h.plan ?? undefined,
          messages,
          toolCallIds,
          createdAt: h.createdAt,
          updatedAt: h.updatedAt,
          detached: h.detached,
        };
      }
      return { sessions, toolCalls, hydrated: true };
    }),

  appendTrace: (ev) =>
    set((state) => {
      const next = [...state.trace, ev];
      // bounded ring
      if (next.length > 1000) next.splice(0, next.length - 1000);
      return { trace: next };
    }),
  setTrace: (events) => set({ trace: events.slice(-1000) }),
  clearTrace: () => set({ trace: [] }),
  setTraceFilters: (f) => set((s) => ({ traceFilters: { ...s.traceFilters, ...f } })),
  setTraceDrawerOpen: (open) => set({ traceDrawerOpen: open }),
  setInspectorTab: (tab) => set({ inspectorTab: tab }),
  setHelpOpen: (open) => set({ helpOpen: open }),
  setFindOpen: (open) => set({ findOpen: open }),
  setNotice: (n) => set({ notice: n }),
  setModels: (models, defaultModel, currentByCwd) =>
    set({ models, defaultModel, modelByCwd: { ...currentByCwd } }),
  setModelForCwd: (cwd, model) => set((s) => ({ modelByCwd: { ...s.modelByCwd, [cwd]: model } })),
  setModelPickerOpen: (open) => set({ modelPickerOpen: open }),
  setFilePreviewPath: (path) => set({ filePreviewPath: path }),
  setDraft: (sessionId, text) =>
    set((s) => {
      const next: Record<string, string> = { ...s.drafts };
      if (text) next[sessionId] = text;
      else delete next[sessionId];
      saveDrafts(next);
      return { drafts: next };
    }),
  setSidebarWidth: (px) =>
    set((s) => {
      const clamped = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(px)));
      if (clamped === s.sidebarWidth) return s;
      savePanelWidths({ sidebar: clamped, inspector: s.inspectorWidth });
      return { sidebarWidth: clamped };
    }),
  setInspectorWidth: (px) =>
    set((s) => {
      const clamped = Math.max(INSPECTOR_MIN, Math.min(INSPECTOR_MAX, Math.round(px)));
      if (clamped === s.inspectorWidth) return s;
      savePanelWidths({ sidebar: s.sidebarWidth, inspector: clamped });
      return { inspectorWidth: clamped };
    }),
  bumpComposerLoad: (sessionId) =>
    set((s) => ({
      composerLoadEpoch: {
        ...s.composerLoadEpoch,
        [sessionId]: (s.composerLoadEpoch[sessionId] ?? 0) + 1,
      },
    })),
  pushPromptHistory: (sessionId, text) =>
    set((s) => {
      const t = text.trim();
      if (!t) return s;
      const prev = s.promptHistory[sessionId] ?? [];
      // De-dup if last entry is identical.
      const filtered = prev[prev.length - 1] === t ? prev : [...prev, t];
      const trimmed = filtered.slice(-HISTORY_MAX_PER_SESSION);
      const next = { ...s.promptHistory, [sessionId]: trimmed };
      savePromptHistory(next);
      return { promptHistory: next };
    }),
  clearSessionMessages: (sessionId) =>
    set((state) => {
      const s = state.sessions[sessionId];
      if (!s) return state;
      const toolCalls = { ...state.toolCalls };
      for (const id of s.toolCallIds) delete toolCalls[id];
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...s, messages: [], toolCallIds: [], updatedAt: Date.now() },
        },
        toolCalls,
      };
    }),
}));
