import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type * as acp from "@agentclientprotocol/sdk";
import type {
  PermissionOption,
  PermissionOutcome,
  PermissionToolCallSnapshot,
  TraceEventDTO,
  HydratedSession,
} from "@agent-view/shared";
import { CopilotAgent } from "./acp/copilot-agent.js";
import { Store } from "./store.js";

export type SessionUpdateListener = (
  sessionId: string,
  update: acp.SessionNotification,
) => void;

export interface PermissionRequestEvent {
  requestId: string;
  sessionId: string;
  toolCall: PermissionToolCallSnapshot;
  options: PermissionOption[];
}

export type PermissionRequestListener = (ev: PermissionRequestEvent) => void;

export interface ChildExitEvent {
  cwd: string;
  sessionIds: string[];
  code: number | null;
  signal: NodeJS.Signals | null;
}

export type ChildExitListener = (ev: ChildExitEvent) => void;
export type TraceListener = (ev: TraceEventDTO) => void;
export type ModelChangeListener = (ev: { cwd: string; model: string; sessionIds: string[] }) => void;

interface SessionEntry {
  id: string;
  cwd: string;
  agent: CopilotAgent;
}

interface PendingPermission {
  resolve: (outcome: acp.RequestPermissionResponse) => void;
  options: { optionId: string; raw: acp.PermissionOption }[];
  timer: NodeJS.Timeout;
  cwd: string;
  toolName: string;
}

/** In-flight accumulator for the current agent reply text, plus the persisted user msg id. */
interface MessageStream {
  agentMessageId: string | null;
  agentBuf: string;
}

const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * SessionManager owns Copilot agent child processes and their ACP sessions.
 *
 * One CopilotAgent per cwd; sessions for the same cwd reuse the same child
 * process / ACP connection.
 */
export class SessionManager {
  private agentsByCwd = new Map<string, CopilotAgent>();
  private sessions = new Map<string, SessionEntry>();
  private listeners = new Set<SessionUpdateListener>();
  private permissionListeners = new Set<PermissionRequestListener>();
  private childExitListeners = new Set<ChildExitListener>();
  private traceListeners = new Set<TraceListener>();
  private pendingPermissions = new Map<string, PendingPermission>();
  /** (cwd, toolName) → outcome — sticky decisions, loaded from / written to store. */
  private permissionMemory = new Map<string, "allowed" | "denied">();
  /** Per-session aggregator for streaming agent messages. */
  private streams = new Map<string, MessageStream>();
  /** Set of session ids that are persisted but have no live ACP child (detached). */
  private detachedSessions = new Set<string>();
  /** Sessions being rehydrated via ACP loadSession — suppress sessionUpdate replay. */
  private replayingSessions = new Set<string>();
  /** Per-cwd selected model id (sent as `--model` when spawning). */
  private modelByCwd = new Map<string, string>();
  /** Listeners for model changes per cwd. */
  private modelListeners = new Set<ModelChangeListener>();
  /** Default model read from ~/.copilot/settings.json (or env). */
  private readonly defaultModel: string;

  constructor(private readonly store: Store) {
    this.defaultModel = readDefaultCopilotModel();
    // Hydrate sticky permission decisions.
    for (const p of store.listPermissions()) {
      this.permissionMemory.set(`${p.cwd}::${p.toolName}`, p.decision);
    }
    // Mark all previously-tracked sessions as detached until their cwd respawns.
    store.markAllDetached();
    for (const s of store.listSessions()) {
      this.detachedSessions.add(s.id);
    }
  }

  onSessionUpdate(l: SessionUpdateListener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onPermissionRequest(l: PermissionRequestListener) {
    this.permissionListeners.add(l);
    return () => this.permissionListeners.delete(l);
  }

  onChildExit(l: ChildExitListener) {
    this.childExitListeners.add(l);
    return () => this.childExitListeners.delete(l);
  }

  onTrace(l: TraceListener) {
    this.traceListeners.add(l);
    return () => this.traceListeners.delete(l);
  }

  onModelChange(l: ModelChangeListener) {
    this.modelListeners.add(l);
    return () => this.modelListeners.delete(l);
  }

  getDefaultModel(): string {
    return this.defaultModel;
  }

  /** Snapshot of {cwd → model}. Only includes cwds the user has set explicitly. */
  getModelsByCwd(): Record<string, string> {
    return Object.fromEntries(this.modelByCwd);
  }

  /**
   * Switch the model for a given cwd. If a child process is running for that
   * cwd, it is shut down so the next prompt (or proactive respawn) starts
   * with the new model. Returns the affected session ids.
   */
  async setModel(cwd: string, model: string): Promise<string[]> {
    const current = this.modelByCwd.get(cwd) ?? this.defaultModel;
    this.modelByCwd.set(cwd, model);
    const affected: string[] = [];
    if (current === model) {
      // No-op for the agent process but still emit so the UI updates.
    } else {
      const agent = this.agentsByCwd.get(cwd);
      if (agent) {
        for (const [sid, entry] of this.sessions) {
          if (entry.cwd === cwd) affected.push(sid);
        }
        // shutdown triggers onExit which will detach affected sessions.
        await agent.shutdown();
      }
    }
    for (const l of this.modelListeners) {
      try {
        l({ cwd, model, sessionIds: affected });
      } catch (e) {
        console.error("modelChange listener error", e);
      }
    }
    return affected;
  }

  private trace(ev: Omit<TraceEventDTO, "id">) {
    const id = this.store.insertTrace(ev);
    const dto: TraceEventDTO = { id, ...ev };
    for (const l of this.traceListeners) {
      try {
        l(dto);
      } catch (e) {
        console.error("trace listener error", e);
      }
    }
  }

  /** Get a hydration snapshot for a fresh WS client. */
  hydrate(): HydratedSession[] {
    return this.store.listSessions().map((s) => ({
      id: s.id,
      cwd: s.cwd,
      title: s.title,
      status: s.status,
      modeId: s.modeId,
      modeName: s.modeName,
      modeOptions: s.modeOptions,
      availableCommands: s.availableCommands,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      detached: s.detached,
      messages: this.store.listMessages(s.id).map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        ts: m.ts,
      })),
      toolCalls: this.store.listToolCalls(s.id).map((c) => ({
        id: c.id,
        kind: c.kind,
        title: c.title,
        status: c.status,
        rawInput: c.rawInput,
        rawOutput: c.rawOutput,
        content: c.content,
        locations: c.locations,
        startedAt: c.startedAt,
        finishedAt: c.finishedAt,
        ts: c.ts,
      })),
    }));
  }

  /** Surface trace snapshot for a UI request. */
  listTrace(opts: { sessionId?: string; sinceId?: number; limit?: number }): TraceEventDTO[] {
    return this.store.listTrace(opts).map((t) => ({
      id: t.id ?? 0,
      sessionId: t.sessionId,
      cwd: t.cwd,
      direction: t.direction,
      kind: t.kind,
      payload: t.payload,
      ts: t.ts,
    }));
  }

  deleteSession(sessionId: string) {
    const entry = this.sessions.get(sessionId);
    if (entry) {
      void entry.agent.connection.cancel({ sessionId }).catch(() => undefined);
      this.sessions.delete(sessionId);
    }
    this.detachedSessions.delete(sessionId);
    this.streams.delete(sessionId);
    this.store.deleteSession(sessionId);
  }

  private emit(sessionId: string, update: acp.SessionNotification) {
    for (const l of this.listeners) {
      try {
        l(sessionId, update);
      } catch (e) {
        console.error("listener error", e);
      }
    }
  }

  private emitPermission(ev: PermissionRequestEvent) {
    for (const l of this.permissionListeners) {
      try {
        l(ev);
      } catch (e) {
        console.error("permission listener error", e);
      }
    }
  }

  private async getOrCreateAgent(cwd: string): Promise<CopilotAgent> {
    const existing = this.agentsByCwd.get(cwd);
    if (existing) return existing;

    const client: acp.Client = {
      requestPermission: async (params) => {
        this.trace({
          sessionId: params.sessionId ?? null,
          cwd,
          direction: "in",
          kind: "requestPermission",
          payload: params,
          ts: Date.now(),
        });
        return this.handlePermission(cwd, params);
      },
      sessionUpdate: async (params) => {
        // While we're replaying a session via loadSession, Copilot resends the
        // entire conversation as session updates. We already have everything
        // in SQLite — suppress to avoid duplicating message text on screen.
        if (params.sessionId && this.replayingSessions.has(params.sessionId)) {
          this.trace({
            sessionId: params.sessionId,
            cwd,
            direction: "in",
            kind: "sessionUpdate[replay-suppressed]",
            payload: { kind: (params.update as { sessionUpdate?: string })?.sessionUpdate },
            ts: Date.now(),
          });
          return;
        }
        this.trace({
          sessionId: params.sessionId ?? null,
          cwd,
          direction: "in",
          kind: (params.update as { sessionUpdate?: string })?.sessionUpdate ?? "sessionUpdate",
          payload: params,
          ts: Date.now(),
        });
        this.persistSessionUpdate(cwd, params);
        this.emit(params.sessionId, params);
      },
    };

    const agent = new CopilotAgent(client, {
      extraArgs: ["--model", this.modelByCwd.get(cwd) ?? this.defaultModel],
      onStderr: (c) => process.stderr.write(`[copilot stderr] ${c}`),
      onExit: (code, signal) => {
        console.warn(`[copilot] child exited code=${code} signal=${signal} cwd=${cwd}`);
        this.agentsByCwd.delete(cwd);
        const droppedSessionIds: string[] = [];
        for (const [sid, entry] of this.sessions) {
          if (entry.cwd === cwd) {
            droppedSessionIds.push(sid);
            this.sessions.delete(sid);
            this.detachedSessions.add(sid);
            this.store.markSessionDetached(sid, true);
          }
        }
        // Reject any pending permissions tied to this cwd.
        for (const [id, p] of this.pendingPermissions) {
          clearTimeout(p.timer);
          p.resolve({ outcome: { outcome: "cancelled" } });
          this.pendingPermissions.delete(id);
        }
        for (const l of this.childExitListeners) {
          try {
            l({ cwd, sessionIds: droppedSessionIds, code, signal });
          } catch (e) {
            console.error("childExit listener error", e);
          }
        }
      },
    });

    this.agentsByCwd.set(cwd, agent);
    await agent.initialize();
    return agent;
  }

  private async handlePermission(
    cwd: string,
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    const toolName = params.toolCall?.kind ?? params.toolCall?.title ?? "tool";
    const memKey = `${cwd}::${toolName}`;
    const sticky = this.permissionMemory.get(memKey);
    if (sticky === "allowed") {
      const allow = params.options.find(
        (o) => o.kind === "allow_once" || o.kind === "allow_always",
      );
      if (allow) return { outcome: { outcome: "selected", optionId: allow.optionId } };
    } else if (sticky === "denied") {
      const deny = params.options.find(
        (o) => o.kind === "reject_once" || o.kind === "reject_always",
      );
      if (deny) return { outcome: { outcome: "selected", optionId: deny.optionId } };
    }

    const requestId = randomUUID();
    return new Promise<acp.RequestPermissionResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPermissions.delete(requestId);
        // Default-deny on timeout: pick the first reject option, else cancel.
        const reject = params.options.find(
          (o) => o.kind === "reject_once" || o.kind === "reject_always",
        );
        if (reject) {
          resolve({ outcome: { outcome: "selected", optionId: reject.optionId } });
        } else {
          resolve({ outcome: { outcome: "cancelled" } });
        }
      }, PERMISSION_TIMEOUT_MS);

      this.pendingPermissions.set(requestId, {
        resolve,
        options: params.options.map((o) => ({ optionId: o.optionId, raw: o })),
        timer,
        cwd,
        toolName,
      });

      const opts: PermissionOption[] = params.options.map((o) => ({
        optionId: o.optionId,
        label: o.name,
        kind: o.kind,
      }));

      this.emitPermission({
        requestId,
        sessionId: params.sessionId,
        toolCall: {
          toolCallId: params.toolCall?.toolCallId ?? "",
          title: params.toolCall?.title ?? undefined,
          kind: (params.toolCall?.kind as string | undefined) ?? undefined,
          rawInput: params.toolCall?.rawInput,
        },
        options: opts,
      });
    });
  }

  /** Resolve a pending permission with the user's decision. */
  replyPermission(requestId: string, outcome: PermissionOutcome, optionId?: string) {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) return false;
    this.pendingPermissions.delete(requestId);
    clearTimeout(pending.timer);

    let picked = optionId
      ? pending.options.find((o) => o.optionId === optionId)
      : undefined;
    if (!picked) {
      // Fall back: map outcome → first matching option kind.
      const want: acp.PermissionOption["kind"][] =
        outcome === "allowed_once"
          ? ["allow_once", "allow_always"]
          : outcome === "allowed_always"
            ? ["allow_always", "allow_once"]
            : ["reject_once", "reject_always"];
      for (const kind of want) {
        picked = pending.options.find((o) => o.raw.kind === kind);
        if (picked) break;
      }
    }

    if (outcome === "allowed_always" || outcome === "allowed_once") {
      // Sticky tracking deferred to post-pick (uses pending.cwd / toolName).
    }

    if (!picked) {
      pending.resolve({ outcome: { outcome: "cancelled" } });
      return true;
    }
    // Sticky memory only when the user picked an *always* variant.
    if (picked.raw.kind === "allow_always") {
      this.rememberPermission(pending.cwd, pending.toolName, "allowed");
    } else if (picked.raw.kind === "reject_always") {
      this.rememberPermission(pending.cwd, pending.toolName, "denied");
    }
    pending.resolve({
      outcome: { outcome: "selected", optionId: picked.optionId },
    });
    return true;
  }

  /** Update sticky permission memory; called by the gateway when allow_always/reject_always picked. */
  rememberPermission(cwd: string, toolName: string, decision: "allowed" | "denied") {
    this.permissionMemory.set(`${cwd}::${toolName}`, decision);
    this.store.setPermission(cwd, toolName, decision);
  }

  sessionCwd(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.cwd;
  }

  async createSession(cwd: string): Promise<{ sessionId: string; modes?: acp.SessionModeState }> {
    const agent = await this.getOrCreateAgent(cwd);
    this.trace({
      sessionId: null,
      cwd,
      direction: "out",
      kind: "newSession",
      payload: { cwd },
      ts: Date.now(),
    });
    const res = await agent.connection.newSession({ cwd, mcpServers: [] });
    this.sessions.set(res.sessionId, { id: res.sessionId, cwd, agent });
    this.detachedSessions.delete(res.sessionId);
    const now = Date.now();
    const modes = res.modes;
    this.store.upsertSession({
      id: res.sessionId,
      cwd,
      title: null,
      status: "idle",
      modeId: modes?.currentModeId ?? null,
      modeName:
        (modes?.availableModes ?? []).find((m) => m.id === modes?.currentModeId)?.name ?? null,
      modeOptions:
        (modes?.availableModes ?? []).map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description ?? undefined,
        })) ?? null,
      availableCommands: null,
      createdAt: now,
      updatedAt: now,
      detached: false,
    });
    return { sessionId: res.sessionId, modes: res.modes ?? undefined };
  }

  /**
   * Reattach a previously-detached session: spawn (or reuse) the cwd's Copilot
   * agent and call ACP `loadSession`, which restores the conversation context
   * inside the CLI. Throws if the session is unknown, already attached, or the
   * agent doesn't advertise `loadSession`.
   */
  async reattachSession(sessionId: string): Promise<{ sessionId: string }> {
    if (this.sessions.has(sessionId)) {
      // Already attached.
      return { sessionId };
    }
    const persisted = this.store.getSession(sessionId);
    if (!persisted) throw new Error(`unknown session ${sessionId}`);
    const cwd = persisted.cwd;
    const agent = await this.getOrCreateAgent(cwd);
    if (!agent.supportsLoadSession()) {
      throw new Error("agent does not support loadSession");
    }
    this.trace({
      sessionId,
      cwd,
      direction: "out",
      kind: "loadSession",
      payload: { cwd, sessionId },
      ts: Date.now(),
    });
    this.replayingSessions.add(sessionId);
    try {
      await agent.connection.loadSession({ cwd, sessionId, mcpServers: [] });
    } catch (e) {
      // Copilot returns "Resource not found" for sessions with no turns. The
      // session ID is still in our SQLite — surface a friendlier hint.
      const msg = e instanceof Error ? e.message : String(e);
      if (/not found/i.test(msg)) {
        throw new Error(
          "Copilot has no saved history for this session (it had no completed turns). Create a new session instead.",
        );
      }
      throw e;
    } finally {
      this.replayingSessions.delete(sessionId);
    }
    this.sessions.set(sessionId, { id: sessionId, cwd, agent });
    this.detachedSessions.delete(sessionId);
    this.streams.delete(sessionId);
    this.store.markSessionDetached(sessionId, false);
    this.store.upsertSession({
      ...persisted,
      detached: false,
      status: "idle",
      updatedAt: Date.now(),
    });
    return { sessionId };
  }

  async prompt(sessionId: string, text: string): Promise<acp.PromptResponse> {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error(`unknown session ${sessionId}`);
    // Persist the user message + flush any prior in-flight agent buffer.
    const now = Date.now();
    const userMsgId = randomUUID();
    this.store.insertMessage({
      id: userMsgId,
      sessionId,
      role: "user",
      text,
      ts: now,
    });
    const stream = this.streams.get(sessionId);
    if (stream) {
      stream.agentMessageId = null;
      stream.agentBuf = "";
    }
    this.store.touchSession(sessionId, "streaming");
    this.trace({
      sessionId,
      cwd: entry.cwd,
      direction: "out",
      kind: "prompt",
      payload: { text },
      ts: now,
    });
    const res = await entry.agent.connection.prompt({
      sessionId,
      prompt: [{ type: "text", text }],
    });
    this.store.touchSession(sessionId, "idle");
    this.trace({
      sessionId,
      cwd: entry.cwd,
      direction: "in",
      kind: "promptResponse",
      payload: res,
      ts: Date.now(),
    });
    return res;
  }

  async cancel(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    this.trace({
      sessionId,
      cwd: entry.cwd,
      direction: "out",
      kind: "cancel",
      payload: {},
      ts: Date.now(),
    });
    await entry.agent.connection.cancel({ sessionId });
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error(`unknown session ${sessionId}`);
    this.trace({
      sessionId,
      cwd: entry.cwd,
      direction: "out",
      kind: "setMode",
      payload: { modeId },
      ts: Date.now(),
    });
    await entry.agent.connection.setSessionMode({ sessionId, modeId });
    // Optimistically reflect — current_mode_update will also arrive via sessionUpdate.
    const persisted = this.store.getSession(sessionId);
    if (persisted) {
      const opt = persisted.modeOptions?.find((m) => m.id === modeId);
      this.store.upsertSession({
        ...persisted,
        modeId,
        modeName: opt?.name ?? persisted.modeName,
        updatedAt: Date.now(),
      });
    }
  }

  list() {
    return [...this.sessions.values()].map((s) => ({ id: s.id, cwd: s.cwd }));
  }

  async shutdownAll() {
    await Promise.all([...this.agentsByCwd.values()].map((a) => a.shutdown()));
    this.agentsByCwd.clear();
    this.sessions.clear();
  }

  /**
   * Mirror an incoming sessionUpdate into SQLite. Best-effort; failures are logged.
   */
  private persistSessionUpdate(cwd: string, params: acp.SessionNotification): void {
    try {
      const sid = params.sessionId;
      const update = params.update as Record<string, unknown> & { sessionUpdate?: string };
      const kind = update?.sessionUpdate;
      const now = Date.now();

      const ensureStream = (): MessageStream => {
        let s = this.streams.get(sid);
        if (!s) {
          s = { agentMessageId: null, agentBuf: "" };
          this.streams.set(sid, s);
        }
        return s;
      };

      const ensureSession = () => {
        const existing = this.store.getSession(sid);
        if (existing) return existing;
        const seed = {
          id: sid,
          cwd,
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
        this.store.upsertSession(seed);
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
            this.store.insertMessage({
              id: stream.agentMessageId,
              sessionId: sid,
              role: "agent",
              text,
              ts: now,
            });
          } else {
            stream.agentBuf += text;
            this.store.updateMessageText(stream.agentMessageId, stream.agentBuf);
          }
        } else {
          // user_message_chunk (rare — usually we recorded on prompt). Append to a fresh msg.
          this.store.insertMessage({
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
        const stream = this.streams.get(sid);
        if (stream) {
          stream.agentMessageId = null;
          stream.agentBuf = "";
        }
        const u = update as Record<string, unknown>;
        const id = String(u.toolCallId ?? u.id ?? "");
        if (!id) return;
        const existing = this.store.getToolCall(id);
        const merged = {
          id,
          sessionId: sid,
          kind: (u.kind as string | undefined) ?? existing?.kind ?? "",
          title: (u.title as string | undefined) ?? existing?.title ?? "",
          status: (u.status as string | undefined) ?? existing?.status ?? "pending",
          rawInput: u.rawInput ?? existing?.rawInput ?? null,
          rawOutput: u.rawOutput ?? existing?.rawOutput ?? null,
          content:
            (u.content as unknown[] | undefined) ?? existing?.content ?? ([] as unknown[]),
          locations:
            (u.locations as { path: string; line?: number }[] | undefined) ??
            existing?.locations ??
            null,
          startedAt: existing?.startedAt ?? now,
          finishedAt:
            (u.status as string | undefined) === "completed" ||
            (u.status as string | undefined) === "failed"
              ? now
              : (existing?.finishedAt ?? null),
          ts: now,
        };
        this.store.upsertToolCall(merged);
        this.store.touchSession(sid);
        return;
      }

      if (kind === "current_mode_update") {
        const persisted = ensureSession();
        const modeId = (update.currentModeId as string | undefined) ?? null;
        const opt = persisted.modeOptions?.find((m) => m.id === modeId);
        this.store.upsertSession({
          ...persisted,
          modeId,
          modeName: opt?.name ?? persisted.modeName,
          updatedAt: now,
        });
        return;
      }

      if (kind === "available_commands_update") {
        const persisted = ensureSession();
        const cmds = (update.availableCommands as { name: string; description?: string }[] | undefined) ?? [];
        this.store.upsertSession({
          ...persisted,
          availableCommands: cmds,
          updatedAt: now,
        });
        return;
      }

      if (kind === "session_info_update") {
        // Best-effort title from first user prompt; skip for now (UI derives).
        ensureSession();
        this.store.touchSession(sid);
        return;
      }
    } catch (e) {
      console.error("persistSessionUpdate error", e);
    }
  }
}


/** Read the user default model from ~/.copilot/settings.json, falling back to env or hardcoded. */
function readDefaultCopilotModel(): string {
  const envModel = process.env.COPILOT_DEFAULT_MODEL?.trim();
  if (envModel) return envModel;
  try {
    const p = path.join(homedir(), ".copilot", "settings.json");
    const raw = readFileSync(p, "utf8");
    const json = JSON.parse(raw) as { model?: unknown };
    if (typeof json.model === "string" && json.model) return json.model;
  } catch {
    // fall through
  }
  return "claude-sonnet-4.5";
}
