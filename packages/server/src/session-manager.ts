import { randomUUID } from "node:crypto";
import type {
  HydratedSession,
  PermissionOption,
  PermissionOutcome,
  PermissionToolCallSnapshot,
  TraceEventDTO,
} from "@agent-view/shared";
import type * as acp from "@agentclientprotocol/sdk";
import { CopilotAgent } from "./acp/copilot-agent.js";
import { type MessageStream, persistSessionUpdate } from "./acp/persist.js";
import { PERMISSION_TIMEOUT_MS, readDefaultCopilotModel } from "./config.js";
import { captureCheckpoint } from "./git-checkpoint.js";
import {
  DEFAULT_RENDER_HINT_MODE,
  type RenderHintMode,
  prefixFirstPrompt,
  upsertAgentsMd,
} from "./render-hints.js";
import type { Store } from "./store.js";

export type SessionUpdateListener = (sessionId: string, update: acp.SessionNotification) => void;

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
export type ModelChangeListener = (ev: {
  cwd: string;
  model: string;
  sessionIds: string[];
}) => void;
export type SessionRenameListener = (ev: { sessionId: string; title: string }) => void;
export type SessionModelChangeListener = (ev: { sessionId: string; model: string }) => void;

interface SessionEntry {
  id: string;
  cwd: string;
  agent: CopilotAgent;
  /** Effective model used by the agent serving this session. */
  model: string;
}

interface PendingPermission {
  resolve: (outcome: acp.RequestPermissionResponse) => void;
  options: { optionId: string; raw: acp.PermissionOption }[];
  timer: NodeJS.Timeout;
  cwd: string;
  toolName: string;
}

/**
 * SessionManager owns Copilot agent child processes and their ACP sessions.
 *
 * One CopilotAgent per cwd; sessions for the same cwd reuse the same child
 * process / ACP connection.
 */
export class SessionManager {
  /** Active CopilotAgent children keyed by `${cwd}::${model}` so different
   * model overrides within the same cwd run side-by-side without trampling. */
  private agents = new Map<string, CopilotAgent>();
  private sessions = new Map<string, SessionEntry>();
  /** Sessions with an explicit per-session model override (sessionId → model).
   * Hydrated from SQLite on startup. */
  private modelBySession = new Map<string, string>();
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
  /** Listeners for session renames. */
  private renameListeners = new Set<SessionRenameListener>();
  /** Listeners for per-session model changes. */
  private sessionModelListeners = new Set<SessionModelChangeListener>();
  /** Default model read from ~/.copilot/settings.json (or env). */
  private readonly defaultModel: string;

  constructor(readonly store: Store) {
    this.defaultModel = readDefaultCopilotModel();
    // Hydrate sticky permission decisions.
    for (const p of store.listPermissions()) {
      this.permissionMemory.set(`${p.cwd}::${p.toolName}`, p.decision);
    }
    // Mark all previously-tracked sessions as detached until their cwd respawns.
    store.markAllDetached();
    for (const s of store.listSessions()) {
      this.detachedSessions.add(s.id);
      if (s.model) this.modelBySession.set(s.id, s.model);
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

  onSessionRename(l: SessionRenameListener) {
    this.renameListeners.add(l);
    return () => this.renameListeners.delete(l);
  }

  onSessionModelChange(l: SessionModelChangeListener) {
    this.sessionModelListeners.add(l);
    return () => this.sessionModelListeners.delete(l);
  }

  getDefaultModel(): string {
    return this.defaultModel;
  }

  /** Snapshot of {cwd → model}. Only includes cwds the user has set explicitly. */
  getModelsByCwd(): Record<string, string> {
    return Object.fromEntries(this.modelByCwd);
  }

  /** Snapshot of {sessionId → model}. Only includes sessions with an
   * explicit per-session override (default = inherit cwd). */
  getModelsBySession(): Record<string, string> {
    return Object.fromEntries(this.modelBySession);
  }

  /** Resolve the effective model for (cwd, sessionId?) — falls back through
   * session override → cwd default → global default. */
  resolveModel(cwd: string, sessionId?: string): string {
    if (sessionId) {
      const s = this.modelBySession.get(sessionId);
      if (s) return s;
    }
    return this.modelByCwd.get(cwd) ?? this.defaultModel;
  }

  /**
   * Switch the model for a given cwd. Sessions in that cwd that don't have
   * their own per-session override get reattached on the (cwd, new-model) agent;
   * sessions with an override are left as-is. Returns the affected session ids.
   */
  async setModel(cwd: string, model: string): Promise<string[]> {
    const prev = this.modelByCwd.get(cwd) ?? this.defaultModel;
    this.modelByCwd.set(cwd, model);
    const affected: string[] = [];
    if (prev !== model) {
      // Find sessions that follow the cwd default (no per-session override).
      const oldKey = this.agentKey(cwd, prev);
      const oldAgent = this.agents.get(oldKey);
      if (oldAgent) {
        for (const [sid, entry] of this.sessions) {
          if (entry.cwd === cwd && !this.modelBySession.has(sid)) {
            affected.push(sid);
          }
        }
        // shutdown triggers onExit which will detach sessions on this agent.
        await oldAgent.shutdown();
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

  /**
   * Switch the model for a single session (per-session override). The session
   * is detached from its current (cwd, prevModel) agent and reattached on the
   * (cwd, newModel) agent via ACP loadSession so its LLM context is preserved.
   * Other sessions sharing the previous agent are unaffected.
   */
  async setSessionModel(sessionId: string, model: string): Promise<void> {
    const persisted = this.store.getSession(sessionId);
    if (!persisted) throw new Error(`unknown session ${sessionId}`);
    const cwd = persisted.cwd;
    const prevModel = this.resolveModel(cwd, sessionId);
    this.modelBySession.set(sessionId, model);
    this.store.setSessionModel(sessionId, model);

    if (prevModel !== model) {
      try {
        await this.respawnSession(sessionId, model, "model_change");
      } catch (e) {
        console.warn(`[setSessionModel] reattach failed for ${sessionId}:`, e);
      }
    }

    for (const l of this.sessionModelListeners) {
      try {
        l({ sessionId, model });
      } catch (e) {
        console.error("sessionModelChange listener error", e);
      }
    }
  }

  async reloadSession(sessionId: string, reason: string): Promise<void> {
    const persisted = this.store.getSession(sessionId);
    if (!persisted) throw new Error(`unknown session ${sessionId}`);
    await this.respawnSession(sessionId, this.resolveModel(persisted.cwd, sessionId), reason);
  }

  private agentKey(cwd: string, model: string): string {
    return `${cwd}::${model}`;
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
      plan: s.plan,
      model: s.model,
      renderHintMode: s.renderHintMode,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      detached: s.detached,
      reviewed: this.store.loadReviewed(s.id),
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

  markReviewed(sessionId: string, path: string, diffHash: string): void {
    if (!this.store.getSession(sessionId)) throw new Error("session not found");
    this.store.markReviewed(sessionId, path, diffHash);
  }

  unmarkReviewed(sessionId: string, path: string): void {
    if (!this.store.getSession(sessionId)) throw new Error("session not found");
    this.store.unmarkReviewed(sessionId, path);
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
    this.modelBySession.delete(sessionId);
    this.store.deleteSession(sessionId);
  }

  renameSession(sessionId: string, title: string): boolean {
    const trimmed = title.trim().slice(0, 200);
    if (!trimmed) return false;
    const existing = this.store.getSession(sessionId);
    if (!existing) return false;
    this.store.renameSession(sessionId, trimmed);
    for (const l of this.renameListeners) {
      try {
        l({ sessionId, title: trimmed });
      } catch (e) {
        console.error("rename listener error", e);
      }
    }
    return true;
  }

  /** Read-only access for export endpoints. */
  getStoredSession(sessionId: string) {
    return this.store.getSession(sessionId);
  }
  listStoredMessages(sessionId: string) {
    return this.store.listMessages(sessionId);
  }
  listStoredToolCalls(sessionId: string) {
    return this.store.listToolCalls(sessionId);
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

  private emitStatus(sessionId: string, status: string, reason?: string) {
    this.emit(sessionId, {
      sessionId,
      update: { sessionUpdate: "status_update", status, reason },
    } as unknown as acp.SessionNotification);
  }

  private async respawnSession(
    sessionId: string,
    newEffectiveModel: string,
    reason: string,
  ): Promise<void> {
    const persisted = this.store.getSession(sessionId);
    if (!persisted) throw new Error(`unknown session ${sessionId}`);
    const cwd = persisted.cwd;
    const entry = this.sessions.get(sessionId);
    if (!entry) return;

    this.store.touchSession(sessionId, "reloading");
    this.emitStatus(sessionId, "reloading", reason);

    try {
      await entry.agent.connection.cancel({ sessionId });
    } catch {
      // Best-effort cancel; ignore errors.
    }

    this.sessions.delete(sessionId);
    this.detachedSessions.add(sessionId);
    this.streams.delete(sessionId);
    this.store.markSessionDetached(sessionId, true);

    let stillUsed = false;
    for (const e of this.sessions.values()) {
      if (e.agent === entry.agent) {
        stillUsed = true;
        break;
      }
    }
    if (!stillUsed) {
      try {
        await entry.agent.shutdown();
      } catch {
        // ignore
      }
    }

    try {
      await this.reattachSession(sessionId);
      this.store.touchSession(sessionId, "idle");
      this.emitStatus(sessionId, "idle", reason);
      const reattached = this.sessions.get(sessionId);
      if (reattached) reattached.model = newEffectiveModel;
    } catch (e) {
      this.store.touchSession(sessionId, "error");
      this.emitStatus(sessionId, "error", reason);
      throw e;
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

  private async getOrCreateAgent(cwd: string, model: string): Promise<CopilotAgent> {
    const key = this.agentKey(cwd, model);
    const existing = this.agents.get(key);
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
        this.persistUpdate(cwd, params);
        this.emit(params.sessionId, params);
      },
    };
    const agent = new CopilotAgent(client, {
      extraArgs: ["--model", model],
      onStderr: (c) => process.stderr.write(`[copilot stderr] ${c}`),
      onExit: (code, signal) => {
        console.warn(
          `[copilot] child exited code=${code} signal=${signal} cwd=${cwd} model=${model}`,
        );
        this.agents.delete(key);
        const droppedSessionIds: string[] = [];
        for (const [sid, entry] of this.sessions) {
          if (entry.agent === agent) {
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

    this.agents.set(key, agent);
    await agent.initialize();
    return agent;
  }

  private async handlePermission(
    cwd: string,
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    const toolName = params.toolCall?.kind ?? params.toolCall?.title ?? "tool";
    const memKey = `${cwd}::${toolName}`;
    const folderKey = `${cwd}::*`;
    const sticky = this.permissionMemory.get(memKey) ?? this.permissionMemory.get(folderKey);
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
  replyPermission(
    requestId: string,
    outcome: PermissionOutcome,
    optionId?: string,
    trustFolder?: boolean,
  ) {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) return false;
    this.pendingPermissions.delete(requestId);
    clearTimeout(pending.timer);

    let picked = optionId ? pending.options.find((o) => o.optionId === optionId) : undefined;
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
      if (trustFolder) {
        // Folder-wide trust: any subsequent tool in this cwd auto-allows.
        this.rememberPermission(pending.cwd, "*", "allowed");
      }
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
    const model = this.resolveModel(cwd);
    const agent = await this.getOrCreateAgent(cwd, model);
    this.trace({
      sessionId: null,
      cwd,
      direction: "out",
      kind: "newSession",
      payload: { cwd, model },
      ts: Date.now(),
    });
    const res = await agent.connection.newSession({ cwd, mcpServers: [] });
    this.sessions.set(res.sessionId, { id: res.sessionId, cwd, agent, model });
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
      renderHintMode: DEFAULT_RENDER_HINT_MODE,
      firstPromptSent: false,
    });
    return { sessionId: res.sessionId, modes: res.modes ?? undefined };
  }

  /**
   * Reattach a previously-detached session: spawn (or reuse) the cwd's Copilot
   * agent and call ACP `loadSession`, which restores the conversation context
   * inside the CLI. Throws if the session is unknown, already attached, or the
   * agent doesn't advertise `loadSession`.
   */
  async reattachSession(sessionId: string): Promise<{ sessionId: string; replacedFrom?: string }> {
    if (this.sessions.has(sessionId)) {
      // Already attached.
      return { sessionId };
    }
    const persisted = this.store.getSession(sessionId);
    if (!persisted) throw new Error(`unknown session ${sessionId}`);
    const cwd = persisted.cwd;
    const model = this.resolveModel(cwd, sessionId);
    const agent = await this.getOrCreateAgent(cwd, model);
    // Defensive: ensure capabilities have populated before checking. initialize()
    // is idempotent (returns the cached promise), so this is a cheap await.
    await agent.initialize();
    if (!agent.supportsLoadSession()) {
      const caps = agent.initResponse?.agentCapabilities;
      throw new Error(
        `agent does not support loadSession (advertised capabilities: ${JSON.stringify(caps ?? null)})`,
      );
    }
    this.trace({
      sessionId,
      cwd,
      direction: "out",
      kind: "loadSession",
      payload: { cwd, sessionId, model },
      ts: Date.now(),
    });
    this.replayingSessions.add(sessionId);
    try {
      await agent.connection.loadSession({ cwd, sessionId, mcpServers: [] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/not found/i.test(msg)) {
        // Copilot has no saved history for this session — almost always because
        // the session was created but the user never sent a prompt. Rather than
        // forcing them through "session is broken, create a new one" friction,
        // we transparently spin up a fresh ACP session bound to the same cwd
        // and drop the empty placeholder. The UI receives a `session_replaced`
        // event to rebind any references to the old id.
        const messageCount = this.store.listMessages(sessionId).length;
        if (messageCount === 0) {
          this.replayingSessions.delete(sessionId);
          const fresh = await this.createSession(cwd);
          this.store.deleteSession(sessionId);
          this.detachedSessions.delete(sessionId);
          return { sessionId: fresh.sessionId, replacedFrom: sessionId };
        }
        throw new Error(
          "Copilot has no saved history for this session despite recorded messages. " +
            "The Copilot CLI may have been re-initialized; create a new session.",
        );
      }
      throw e;
    } finally {
      this.replayingSessions.delete(sessionId);
    }
    this.sessions.set(sessionId, { id: sessionId, cwd, agent, model });
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

    // Best-effort git checkpoint *before* the agent touches anything.
    // Skip slash commands & empty input — they don't mutate files.
    const trimmedForCkpt = text.trimStart();
    if (trimmedForCkpt.length > 0 && !trimmedForCkpt.startsWith("/")) {
      captureCheckpoint({
        store: this.store,
        sessionId,
        cwd: entry.cwd,
        messageId: userMsgId,
        label: trimmedForCkpt.slice(0, 80),
      }).catch((e) => {
        console.warn(`[checkpoint] capture failed for ${sessionId}:`, e?.message ?? e);
      });
    }

    const stream = this.streams.get(sessionId);
    if (stream) {
      stream.agentMessageId = null;
      stream.agentBuf = "";
    }
    this.store.touchSession(sessionId, "streaming");

    // Render-hint injection: under `prompt` mode we prepend the canonical hint
    // body to the *first* user prompt only, so the model anchors on the
    // formatting conventions without paying token cost on every turn.
    // Skip slash commands and empty prompts — they're consumed by the CLI's
    // own command router, not the model, so injection would either break the
    // command or be wasted. We leave `firstPromptSent` false so the hint is
    // still attached to the next real natural-language prompt.
    let outboundText = text;
    const persisted = this.store.getSession(sessionId);
    const trimmed = text.trimStart();
    const isSlash = trimmed.startsWith("/");
    const isEmpty = trimmed.length === 0;
    if (
      persisted &&
      persisted.renderHintMode === "prompt" &&
      !persisted.firstPromptSent &&
      !isSlash &&
      !isEmpty
    ) {
      outboundText = prefixFirstPrompt(text);
      this.store.setSessionFirstPromptSent(sessionId, true);
    }

    this.trace({
      sessionId,
      cwd: entry.cwd,
      direction: "out",
      kind: "prompt",
      payload: { text, injectedHint: outboundText !== text },
      ts: now,
    });
    const res = await entry.agent.connection.prompt({
      sessionId,
      prompt: [{ type: "text", text: outboundText }],
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

  /**
   * Update the render-hint delivery mode for a session.
   * Switching back to `prompt` clears the `firstPromptSent` flag so the hint
   * will be re-injected on the next prompt (useful if the user changed mind).
   */
  setRenderHintMode(sessionId: string, mode: RenderHintMode): void {
    const persisted = this.store.getSession(sessionId);
    if (!persisted) throw new Error(`unknown session ${sessionId}`);
    this.store.setSessionRenderHintMode(sessionId, mode);
    if (mode === "prompt") this.store.setSessionFirstPromptSent(sessionId, false);
  }

  /**
   * Materialise the canonical hint block into `<cwd>/AGENTS.md` for a session.
   * Returns metadata about the change (created / updated / no-op).
   */
  async writeAgentsMd(sessionId: string): Promise<{
    filePath: string;
    created: boolean;
    updated: boolean;
  }> {
    const persisted = this.store.getSession(sessionId);
    if (!persisted) throw new Error(`unknown session ${sessionId}`);
    return upsertAgentsMd(persisted.cwd);
  }

  /** List all checkpoints for a session (ascending by createdAt). */
  listCheckpoints(sessionId: string) {
    return this.store.listCheckpoints(sessionId);
  }

  list() {
    return [...this.sessions.values()].map((s) => ({ id: s.id, cwd: s.cwd }));
  }

  async shutdownAll() {
    await Promise.all([...this.agents.values()].map((a) => a.shutdown()));
    this.agents.clear();
    this.sessions.clear();
  }

  /**
   * Mirror an incoming sessionUpdate into SQLite. Best-effort; failures are logged.
   */
  private persistUpdate(cwd: string, params: acp.SessionNotification): void {
    persistSessionUpdate({ cwd, store: this.store, streams: this.streams }, params);
  }
}
