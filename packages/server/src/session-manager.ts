import type * as acp from "@agentclientprotocol/sdk";
import { CopilotAgent } from "./acp/copilot-agent.js";

export type SessionUpdateListener = (
  sessionId: string,
  update: acp.SessionNotification,
) => void;

interface SessionEntry {
  id: string;
  cwd: string;
  agent: CopilotAgent;
}

/**
 * SessionManager owns Copilot agent child processes and their ACP sessions.
 *
 * M0 strategy: one CopilotAgent per cwd. Sessions for the same cwd reuse the
 * same child process / ACP connection.
 */
export class SessionManager {
  private agentsByCwd = new Map<string, CopilotAgent>();
  private sessions = new Map<string, SessionEntry>();
  private listeners = new Set<SessionUpdateListener>();

  onSessionUpdate(l: SessionUpdateListener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
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

  private async getOrCreateAgent(cwd: string): Promise<CopilotAgent> {
    const existing = this.agentsByCwd.get(cwd);
    if (existing) return existing;

    const client: acp.Client = {
      requestPermission: async () => {
        // M0: always cancel — we'll implement a real broker in M2.
        return { outcome: { outcome: "cancelled" } };
      },
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
      },
    });

    this.agentsByCwd.set(cwd, agent);
    await agent.initialize();
    return agent;
  }

  async createSession(cwd: string): Promise<string> {
    const agent = await this.getOrCreateAgent(cwd);
    const res = await agent.connection.newSession({ cwd, mcpServers: [] });
    this.sessions.set(res.sessionId, { id: res.sessionId, cwd, agent });
    return res.sessionId;
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

  list() {
    return [...this.sessions.values()].map((s) => ({ id: s.id, cwd: s.cwd }));
  }

  async shutdownAll() {
    await Promise.all([...this.agentsByCwd.values()].map((a) => a.shutdown()));
    this.agentsByCwd.clear();
    this.sessions.clear();
  }
}
