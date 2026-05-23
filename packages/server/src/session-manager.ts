import { randomUUID } from "node:crypto";
import type * as acp from "@agentclientprotocol/sdk";
import type {
  PermissionOption,
  PermissionOutcome,
  PermissionToolCallSnapshot,
} from "@agent-view/shared";
import { CopilotAgent } from "./acp/copilot-agent.js";

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
  private pendingPermissions = new Map<string, PendingPermission>();
  /** (cwd, toolName) → outcome — sticky decisions until process restart. */
  private permissionMemory = new Map<string, "allowed" | "denied">();

  onSessionUpdate(l: SessionUpdateListener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  onPermissionRequest(l: PermissionRequestListener) {
    this.permissionListeners.add(l);
    return () => this.permissionListeners.delete(l);
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
      requestPermission: async (params) => this.handlePermission(cwd, params),
      sessionUpdate: async (params) => {
        this.emit(params.sessionId, params);
      },
    };

    const agent = new CopilotAgent(client, {
      onStderr: (c) => process.stderr.write(`[copilot stderr] ${c}`),
      onExit: (code, signal) => {
        console.warn(`[copilot] child exited code=${code} signal=${signal} cwd=${cwd}`);
        this.agentsByCwd.delete(cwd);
        for (const [sid, entry] of this.sessions) {
          if (entry.cwd === cwd) this.sessions.delete(sid);
        }
        // Reject any pending permissions tied to this cwd.
        for (const [id, p] of this.pendingPermissions) {
          clearTimeout(p.timer);
          p.resolve({ outcome: { outcome: "cancelled" } });
          this.pendingPermissions.delete(id);
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
  }

  sessionCwd(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.cwd;
  }

  async createSession(cwd: string): Promise<{ sessionId: string; modes?: acp.SessionModeState }> {
    const agent = await this.getOrCreateAgent(cwd);
    const res = await agent.connection.newSession({ cwd, mcpServers: [] });
    this.sessions.set(res.sessionId, { id: res.sessionId, cwd, agent });
    return { sessionId: res.sessionId, modes: res.modes ?? undefined };
  }

  async prompt(sessionId: string, text: string): Promise<acp.PromptResponse> {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error(`unknown session ${sessionId}`);
    return entry.agent.connection.prompt({
      sessionId,
      prompt: [{ type: "text", text }],
    });
  }

  async cancel(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    await entry.agent.connection.cancel({ sessionId });
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error(`unknown session ${sessionId}`);
    await entry.agent.connection.setSessionMode({ sessionId, modeId });
  }

  list() {
    return [...this.sessions.values()].map((s) => ({ id: s.id, cwd: s.cwd }));
  }

  async shutdownAll() {
    await Promise.all([...this.agentsByCwd.values()].map((a) => a.shutdown()));
    this.agentsByCwd.clear();
    this.sessions.clear();
  }
}
