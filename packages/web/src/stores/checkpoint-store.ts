import { create } from "zustand";

export interface Checkpoint {
  id: string;
  sessionId: string;
  messageId: string | null;
  cwd: string;
  ref: string;
  headSha: string | null;
  label: string | null;
  createdAt: number;
}

interface CheckpointStore {
  /** sessionId → checkpoints (sorted ascending by createdAt) */
  bySession: Record<string, Checkpoint[]>;
  loading: Record<string, boolean>;

  load: (sessionId: string) => Promise<void>;
  /** Force a refetch (e.g. after sending a prompt that may create one). */
  invalidate: (sessionId: string) => void;
  /** Lookup by messageId — handy for per-bubble buttons. */
  findByMessage: (sessionId: string, messageId: string) => Checkpoint | undefined;
  /** Restore + invalidate. */
  restore: (
    sessionId: string,
    checkpointId: string,
    opts?: { removeAdded?: boolean },
  ) => Promise<{ changed: string[] }>;
  /** Preview which paths would change. */
  preview: (checkpointId: string) => Promise<{ paths: string[]; total: number }>;
  remove: (sessionId: string, checkpointId: string) => Promise<void>;
}

export const useCheckpointStore = create<CheckpointStore>((set, get) => ({
  bySession: {},
  loading: {},

  load: async (sessionId) => {
    if (get().loading[sessionId]) return;
    set((s) => ({ loading: { ...s.loading, [sessionId]: true } }));
    try {
      const r = await fetch(`/api/sessions/${sessionId}/checkpoints`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { checkpoints: Checkpoint[] };
      set((s) => ({
        bySession: { ...s.bySession, [sessionId]: data.checkpoints },
      }));
    } catch {
      // best-effort; leave previous state
    } finally {
      set((s) => ({ loading: { ...s.loading, [sessionId]: false } }));
    }
  },

  invalidate: (sessionId) => {
    // Re-fetch in background; deliberately fire-and-forget.
    void get().load(sessionId);
  },

  findByMessage: (sessionId, messageId) =>
    (get().bySession[sessionId] ?? []).find((c) => c.messageId === messageId),

  restore: async (sessionId, checkpointId, opts) => {
    const r = await fetch(`/api/checkpoints/${checkpointId}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removeAdded: !!opts?.removeAdded }),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`Restore failed (${r.status}): ${text}`);
    }
    const data = (await r.json()) as { changed: string[] };
    get().invalidate(sessionId);
    return data;
  },

  preview: async (checkpointId) => {
    const r = await fetch(`/api/checkpoints/${checkpointId}/preview`);
    if (!r.ok) throw new Error(`Preview failed (${r.status})`);
    const data = (await r.json()) as { paths: string[]; total: number };
    return data;
  },

  remove: async (sessionId, checkpointId) => {
    const r = await fetch(`/api/checkpoints/${checkpointId}`, { method: "DELETE" });
    if (!r.ok) throw new Error(`Delete failed (${r.status})`);
    get().invalidate(sessionId);
  },
}));
