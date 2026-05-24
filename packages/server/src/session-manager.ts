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
import type { ProcessHost } from "./process-host.js";
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
  /** True after shutdownAll() begins — suppresses child_exit broadcasts caused
   * by us tearing down our own children during a graceful server shutdown. */
  private shuttingDown = false;

  constructor(
    readonly store: Store,
    private readonly processHost?: ProcessHost,
  ) {
    this.defaultModel = readDefaultCopilotModel();
    // Hydrate sticky permission decisions.
    for (const p of store.listPermissions()) {
      this.permissionMemory.set(`${p.cwd}::${p.toolName}`, p.decision);
    }
    // Mark all previously-tracked sessions as detached until their cwd respawns.
    store.markAllDetached();
    // Skip very old sessions (>30 days) from the in-memory detached set —
    // they remain in SQLite but won't bloat memory on long-running servers.
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const s of store.listSessions()) {
      if (s.updatedAt < cutoff) continue;
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

  /** Look up the cwd that owns a given session id. Returns undefined if
   *  the session is not currently attached. Used by the ACP terminal
   *  bridge to spawn child processes in the right directory. */
  cwdForSession(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.cwd;
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
    return this.store.listSessions().map((s) => {
      const totalMessages = this.store.countMessages(s.id);
      const recent = this.store.listMessagesPaged(s.id, { limit: HYDRATE_MESSAGE_LIMIT });
      const earliestLoadedTs = recent.length > 0 ? recent[0].ts : null;
      const toolCalls =
        earliestLoadedTs === null ? [] : this.store.listToolCallsSince(s.id, earliestLoadedTs);
      return {
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
        messages: recent.map((m) => ({
          id: m.id,
          role: m.role,
          text: m.text,
          ts: m.ts,
          attachments: m.attachments,
        })),
        totalMessages,
        earliestLoadedTs,
        toolCalls: toolCalls.map((c) => ({
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
      };
    });
  }

  loadOlderMessages(
    sessionId: string,
    opts: { beforeTs: number; limit: number },
  ): {
    messages: HydratedSession["messages"];
    toolCalls: HydratedSession["toolCalls"];
    earliestLoadedTs: number | null;
    hasMore: boolean;
  } {
    const limit = Math.max(1, Math.min(opts.limit, 1000));
    const older = this.store.listMessagesPaged(sessionId, {
      beforeTs: opts.beforeTs,
      limit,
    });
    const earliestLoadedTs = older.length > 0 ? older[0].ts : opts.beforeTs;
    // Tool calls in [older[0].ts, opts.beforeTs)
    const toolCalls =
      older.length > 0
        ? this.store.listToolCallsInRange(sessionId, {
            fromTs: older[0].ts,
            toTs: opts.beforeTs,
          })
        : [];
    // hasMore = any messages exist strictly before our new earliestLoadedTs
    const remaining =
      older.length > 0
        ? this.store.listMessagesPaged(sessionId, {
            beforeTs: older[0].ts,
            limit: 1,
          }).length
        : 0;
    return {
      messages: older.map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        ts: m.ts,
        attachments: m.attachments,
      })),
      toolCalls: toolCalls.map((c) => ({
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
      earliestLoadedTs,
      hasMore: remaining > 0,
    };
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
      createTerminal: async (params) => {
        if (!this.processHost) {
          throw new Error("ACP terminal extension not enabled (no ProcessHost)");
        }
        const sessionCwd = this.cwdForSession(params.sessionId) ?? cwd;
        const envObj: Record<string, string> = {};
        for (const e of params.env ?? []) envObj[e.name] = e.value;
        const { acpTerminalId } = this.processHost.createAcpTerminal({
          sessionId: params.sessionId,
          cwd: sessionCwd,
          command: params.command,
          args: params.args ?? [],
          env: envObj,
          outputByteLimit: params.outputByteLimit ?? undefined,
        });
        this.trace({
          sessionId: params.sessionId,
          cwd: sessionCwd,
          direction: "in",
          kind: "createTerminal",
          payload: { command: params.command, args: params.args, terminalId: acpTerminalId },
          ts: Date.now(),
        });
        return { terminalId: acpTerminalId };
      },
      terminalOutput: async (params) => {
        if (!this.processHost) {
          throw new Error("ACP terminal extension not enabled (no ProcessHost)");
        }
        const out = this.processHost.getOutput(params.terminalId);
        if (!out) throw new Error(`unknown terminalId: ${params.terminalId}`);
        return {
          output: out.output,
          truncated: out.truncated,
          exitStatus: out.exitStatus
            ? { exitCode: out.exitStatus.exitCode, signal: out.exitStatus.signal }
            : null,
        };
      },
      waitForTerminalExit: async (params) => {
        if (!this.processHost) {
          throw new Error("ACP terminal extension not enabled (no ProcessHost)");
        }
        const p = this.processHost.waitForExit(params.terminalId);
        if (!p) throw new Error(`unknown terminalId: ${params.terminalId}`);
        const exit = await p;
        return { exitCode: exit.exitCode, signal: exit.signal };
      },
      releaseTerminal: async (params) => {
        if (!this.processHost) {
          throw new Error("ACP terminal extension not enabled (no ProcessHost)");
        }
        this.processHost.releaseAcpTerminal(params.terminalId);
        return {};
      },
      killTerminal: async (params) => {
        if (!this.processHost) {
          throw new Error("ACP terminal extension not enabled (no ProcessHost)");
        }
        this.processHost.killAcpTerminal(params.terminalId);
        return {};
      },
    };
    const agent = new CopilotAgent(client, {
      extraArgs: ["--model", model],
      onStderr: (c) => process.stderr.write(`[copilot stderr] ${c}`),
      onExit: (code, signal) => {
        if (this.shuttingDown) {
          // Server is tearing down its own children — not a crash.
          this.agents.delete(key);
          return;
        }
        console.warn(
          `[copilot] child exited code=${code} signal=${signal} cwd=${cwd} model=${model}`,
        );
        this.agents.delete(key);
        const droppedSessionIds: string[] = [];
        for (const [sid, entry] of this.sessions) {
          if (entry.agent === agent) {
            droppedSessionIds.push(sid);
            this.sessions.delete(sid);
            this.streams.delete(sid);
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
   * Adopt a Copilot CLI session that exists in the upstream `~/.copilot/session-store.db`
   * but is unknown to agent-view. Creates a placeholder row in our DB (so
   * hydrate works), seeds it with the prior conversation turns, then calls
   * ACP `loadSession` so the live CLI process restores its in-memory state.
   *
   * Idempotent: if the id is already known to agent-view, we just reattach.
   */
  async importExternalSession(opts: {
    externalSessionId: string;
    cwd: string;
    title?: string | null;
    /** Prior turns to seed our local store with so they show up in the bubble list. */
    turns?: Array<{
      userMessage: string | null;
      assistantResponse: string | null;
      timestamp: string;
    }>;
  }): Promise<{ sessionId: string; replacedFrom?: string }> {
    const { externalSessionId, cwd, title, turns } = opts;
    // Already known? Just reattach (or no-op if attached).
    if (this.store.getSession(externalSessionId)) {
      return this.reattachSession(externalSessionId);
    }
    const now = Date.now();
    this.store.upsertSession({
      id: externalSessionId,
      cwd,
      title: title ?? null,
      status: "idle",
      modeId: null,
      modeName: null,
      modeOptions: null,
      availableCommands: null,
      createdAt: now,
      updatedAt: now,
      detached: true,
      renderHintMode: DEFAULT_RENDER_HINT_MODE,
      firstPromptSent: true,
    });
    // Seed message history from the upstream turns. We invent stable per-turn
    // ids so future loads stay idempotent. Timestamps fall back to `now` if
    // parsing fails.
    if (turns && turns.length > 0) {
      for (let i = 0; i < turns.length; i++) {
        const t = turns[i];
        if (!t) continue;
        let ts = Date.parse(t.timestamp);
        if (!Number.isFinite(ts)) ts = now + i;
        if (t.userMessage) {
          this.store.insertMessage({
            id: `${externalSessionId}-imp-u-${i}`,
            sessionId: externalSessionId,
            role: "user",
            text: t.userMessage,
            ts,
          });
        }
        if (t.assistantResponse) {
          this.store.insertMessage({
            id: `${externalSessionId}-imp-a-${i}`,
            sessionId: externalSessionId,
            role: "agent",
            text: t.assistantResponse,
            ts: ts + 1,
          });
        }
      }
    }
    // Reattach via loadSession to wake the CLI's context.
    return this.reattachSession(externalSessionId);
  }

  /**
   * Fork a session: creates a brand-new ACP session in the same cwd and
   * stores a condensed "Previous context" prefix that will be prepended to
   * its first user prompt. The prefix is built from messages up to (and
   * including) `messageId`, or the full message history if omitted.
   *
   * The new session is empty from Copilot's POV — we deliberately do NOT
   * loadSession, because forks are meant to diverge. Context is carried via
   * the user-prompt prefix only.
   */
  async forkSession(opts: {
    sourceSessionId: string;
    upToMessageId?: string;
  }): Promise<{ sessionId: string; sourceSessionId: string; prefixChars: number }> {
    const src = this.store.getSession(opts.sourceSessionId);
    if (!src) throw new Error(`unknown session ${opts.sourceSessionId}`);
    const allMessages = this.store.listMessages(opts.sourceSessionId);
    let slice = allMessages;
    if (opts.upToMessageId) {
      const idx = allMessages.findIndex((m) => m.id === opts.upToMessageId);
      if (idx >= 0) slice = allMessages.slice(0, idx + 1);
    }
    const prefix = buildForkContextPrefix(slice);

    const created = await this.createSession(src.cwd);
    if (prefix.length > 0) {
      this.store.setSessionForkPrefix(created.sessionId, prefix);
    }
    // Inherit a title hint: "fork: <original title>". If the source has no
    // title yet (first prompt hasn't auto-set one), fall back to a generic
    // marker so clients can recognise the fork by its title prefix.
    const forkTitle = src.title ? `fork: ${src.title}` : "fork";
    this.store.renameSession(created.sessionId, forkTitle);
    return {
      sessionId: created.sessionId,
      sourceSessionId: opts.sourceSessionId,
      prefixChars: prefix.length,
    };
  }

  /**
   * Reattach a previously-detached session: spawn (or reuse) the cwd's Copilot
   * agent and call ACP `loadSession`, which restores the conversation context
   * inside the CLI. Throws if the session is unknown, already attached, or the
   * agent doesn't advertise `loadSession`.
   */
  async reattachSession(sessionId: string): Promise<{
    sessionId: string;
    replacedFrom?: string;
    modeId?: string | null;
    modeName?: string | null;
    modeOptions?: { id: string; name: string; description?: string }[] | null;
  }> {
    if (this.sessions.has(sessionId)) {
      // Already attached.
      const cur = this.store.getSession(sessionId);
      return {
        sessionId,
        modeId: cur?.modeId ?? null,
        modeName: cur?.modeName ?? null,
        modeOptions: cur?.modeOptions ?? null,
      };
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
    let loadRes: acp.LoadSessionResponse | undefined;
    try {
      loadRes = await agent.connection.loadSession({ cwd, sessionId, mcpServers: [] });
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
    const advertisedModes = loadRes?.modes;
    const nextModeId = advertisedModes?.currentModeId ?? persisted.modeId ?? null;
    const nextModeOptions = advertisedModes?.availableModes
      ? advertisedModes.availableModes.map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description ?? undefined,
        }))
      : (persisted.modeOptions ?? null);
    const nextModeName =
      advertisedModes?.availableModes?.find((m) => m.id === nextModeId)?.name ??
      persisted.modeName ??
      null;
    this.store.upsertSession({
      ...persisted,
      detached: false,
      status: "idle",
      modeId: nextModeId,
      modeName: nextModeName,
      modeOptions: nextModeOptions,
      updatedAt: Date.now(),
    });
    return {
      sessionId,
      modeId: nextModeId,
      modeName: nextModeName,
      modeOptions: nextModeOptions,
    };
  }

  async prompt(
    sessionId: string,
    text: string,
    opts?: {
      attachments?: Array<{
        id: string;
        name: string;
        mimeType: string;
        size: number;
        /** base64 payload (no data: prefix) */
        data: string;
      }>;
    },
  ): Promise<acp.PromptResponse> {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error(`unknown session ${sessionId}`);

    const attachments = (opts?.attachments ?? []).filter((a) => a.mimeType.startsWith("image/"));
    const MAX_PER_ATTACHMENT = 8 * 1024 * 1024;
    const MAX_TOTAL_ATTACHMENTS = 16 * 1024 * 1024;
    let totalSize = 0;
    for (const a of attachments) {
      // size is client-reported but we re-derive from the base64 payload to be safe.
      const decoded = Math.floor((a.data.length * 3) / 4);
      if (decoded > MAX_PER_ATTACHMENT) {
        throw new Error(
          `attachment ${a.name} exceeds per-image cap (${MAX_PER_ATTACHMENT / 1024 / 1024} MB)`,
        );
      }
      totalSize += decoded;
    }
    if (totalSize > MAX_TOTAL_ATTACHMENTS) {
      throw new Error(
        `attachments total ${(totalSize / 1024 / 1024).toFixed(1)} MB exceeds cap (${MAX_TOTAL_ATTACHMENTS / 1024 / 1024} MB)`,
      );
    }
    const persistedAttachments = attachments.map((a) => ({
      id: a.id,
      name: a.name,
      mimeType: a.mimeType,
      size: a.size,
      dataUrl: `data:${a.mimeType};base64,${a.data}`,
    }));

    // Persist the user message + flush any prior in-flight agent buffer.
    const now = Date.now();
    const userMsgId = randomUUID();
    this.store.insertMessage({
      id: userMsgId,
      sessionId,
      role: "user",
      text,
      ts: now,
      attachments: persistedAttachments.length > 0 ? persistedAttachments : undefined,
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

    // Fork prefix (one-shot): synthetic "Previous context:" injected by
    // POST /api/sessions/:id/fork. Consumed on the first real prompt.
    if (!isSlash && !isEmpty) {
      const forkPrefix = this.store.getSessionForkPrefix(sessionId);
      if (forkPrefix) {
        outboundText = `${forkPrefix}\n\n---\n\n${outboundText}`;
        this.store.setSessionForkPrefix(sessionId, null);
      }
    }

    if (
      persisted &&
      persisted.renderHintMode === "prompt" &&
      !persisted.firstPromptSent &&
      !isSlash &&
      !isEmpty
    ) {
      outboundText = prefixFirstPrompt(outboundText);
      this.store.setSessionFirstPromptSent(sessionId, true);
    }

    this.trace({
      sessionId,
      cwd: entry.cwd,
      direction: "out",
      kind: "prompt",
      payload: {
        text,
        injectedHint: outboundText !== text,
        attachmentCount: attachments.length,
      },
      ts: now,
    });
    const promptBlocks: acp.ContentBlock[] = [{ type: "text", text: outboundText }];
    if (attachments.length > 0) {
      if (!entry.agent.supportsImagePrompts()) {
        console.warn(
          `[prompt] agent for ${entry.cwd} does not advertise image prompt capability; sending images anyway`,
        );
      }
      for (const a of attachments) {
        promptBlocks.push({ type: "image", data: a.data, mimeType: a.mimeType });
      }
    }
    const res = await entry.agent.connection.prompt({
      sessionId,
      prompt: promptBlocks,
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
    this.shuttingDown = true;
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

/**
 * Condense a slice of prior-session messages into a single text block to
 * prepend to a forked session's first prompt. Truncates very long agent
 * replies to keep the prefix bounded.
 */
const FORK_AGENT_TRUNCATE_CHARS = 600;
const FORK_PREFIX_HARD_CAP = 12_000;

/** Default number of most-recent messages sent on hydrate. The client can
 * pull older history via `load_older_messages`. */
const HYDRATE_MESSAGE_LIMIT = 300;

export function buildForkContextPrefix(
  messages: Array<{ role: string; text: string | null }>,
): string {
  const lines: string[] = ["Previous context (forked from a prior session):", ""];
  for (const m of messages) {
    if (!m.text) continue;
    const role = m.role === "agent" ? "Assistant" : m.role === "user" ? "User" : m.role;
    let body = m.text.trim();
    if (!body) continue;
    if (m.role === "agent" && body.length > FORK_AGENT_TRUNCATE_CHARS) {
      body = `${body.slice(0, FORK_AGENT_TRUNCATE_CHARS)} … [truncated]`;
    }
    lines.push(`[${role}]: ${body}`, "");
  }
  lines.push("--- end of prior context ---");
  let out = lines.join("\n");
  if (out.length > FORK_PREFIX_HARD_CAP) {
    out = `${out.slice(0, FORK_PREFIX_HARD_CAP)}\n… [prior context truncated]\n--- end of prior context ---`;
  }
  return out;
}
