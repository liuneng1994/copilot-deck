import { create } from "zustand";
import type { ContentItem } from "../lib/content-renderer/types";

/**
 * One artifact entry, scoped to a session. Created lazily as a message bubble
 * classifies its content and finds a hoist-worthy item; the payload references
 * the original `ContentItem` so renderers can re-use the same parsed data.
 *
 * The pane shows artifacts for the currently active session only. We never
 * persist these — re-classifying messages on hydrate is cheap, and saving them
 * would create stale-content risk.
 */
export interface Artifact {
  id: string;
  sessionId: string;
  sourceMsgId: string;
  createdAt: number;
  title: string;
  item: ContentItem;
  pinned: boolean;
}

interface ArtifactState {
  artifacts: Record<string, Artifact>;
  /** Stable per-session tab order, oldest first. */
  orderBySession: Record<string, string[]>;
  /** Per-session active tab id (the one shown in the body). */
  activeBySession: Record<string, string | undefined>;
  /** Per-session pane open/closed flag. Closing keeps artifacts in memory. */
  openBySession: Record<string, boolean>;
  /** Per-session right-pane width in px. */
  widthBySession: Record<string, number>;

  /** Upsert an artifact from a freshly-classified content item. */
  upsertFromItem: (
    sessionId: string,
    sourceMsgId: string,
    item: ContentItem,
    title?: string,
  ) => string;
  /** Focus an artifact tab (auto-opens the pane). */
  focus: (sessionId: string, id: string) => void;
  /** Close (hide, don't delete) the pane for a session. */
  closePane: (sessionId: string) => void;
  /** Open the pane for a session. */
  openPane: (sessionId: string) => void;
  /** Toggle pin on a tab. Pinned tabs are not affected by `clearUnpinned`. */
  togglePin: (id: string) => void;
  /** Remove a single artifact. */
  remove: (sessionId: string, id: string) => void;
  /** Drop everything for a session (e.g. session deleted). */
  clearSession: (sessionId: string) => void;
  /** Drop unpinned artifacts for a session. */
  clearUnpinned: (sessionId: string) => void;
  /** Update per-session pane width. */
  setWidth: (sessionId: string, px: number) => void;
}

function defaultTitle(item: ContentItem): string {
  switch (item.kind) {
    case "table":
    case "csv":
      return `${item.kind === "csv" ? "CSV" : "Table"} · ${item.rows.length}×${item.header.length}`;
    case "mermaid":
      return "Mermaid diagram";
    case "json":
      return `JSON · ${item.lines} lines`;
    case "code":
      return `${item.lang ?? "code"} · ${item.lines} lines`;
    case "html":
      return "HTML preview";
    case "svg":
      return "SVG";
    case "math":
      return "Math";
    case "shell":
      return `Shell · ${item.commands.length} cmd${item.commands.length === 1 ? "" : "s"}`;
    case "text":
      return "Text";
  }
}

function artifactKey(sessionId: string, item: ContentItem): string {
  return `${sessionId}:${item.id}`;
}

export const ARTIFACT_PANE_MIN = 240;
export const ARTIFACT_PANE_MAX = 900;
export const ARTIFACT_PANE_DEFAULT = 420;

export const useArtifactStore = create<ArtifactState>((set, get) => ({
  artifacts: {},
  orderBySession: {},
  activeBySession: {},
  openBySession: {},
  widthBySession: {},

  upsertFromItem(sessionId, sourceMsgId, item, title) {
    const id = artifactKey(sessionId, item);
    const existing = get().artifacts[id];
    if (existing) {
      // Refresh content (streaming updates) but keep tab order / pin / focus.
      set((s) => ({
        artifacts: { ...s.artifacts, [id]: { ...existing, item } },
      }));
      return id;
    }
    set((s) => {
      const order = s.orderBySession[sessionId] ?? [];
      const next: Artifact = {
        id,
        sessionId,
        sourceMsgId,
        createdAt: Date.now(),
        title: title ?? defaultTitle(item),
        item,
        pinned: false,
      };
      return {
        artifacts: { ...s.artifacts, [id]: next },
        orderBySession: { ...s.orderBySession, [sessionId]: [...order, id] },
        // Auto-open on first artifact + auto-focus newest if nothing active.
        openBySession: { ...s.openBySession, [sessionId]: true },
        activeBySession: {
          ...s.activeBySession,
          [sessionId]: s.activeBySession[sessionId] ?? id,
        },
      };
    });
    return id;
  },

  focus(sessionId, id) {
    set((s) => ({
      openBySession: { ...s.openBySession, [sessionId]: true },
      activeBySession: { ...s.activeBySession, [sessionId]: id },
    }));
  },

  closePane(sessionId) {
    set((s) => ({ openBySession: { ...s.openBySession, [sessionId]: false } }));
  },
  openPane(sessionId) {
    set((s) => ({ openBySession: { ...s.openBySession, [sessionId]: true } }));
  },

  togglePin(id) {
    set((s) => {
      const a = s.artifacts[id];
      if (!a) return s;
      return { artifacts: { ...s.artifacts, [id]: { ...a, pinned: !a.pinned } } };
    });
  },

  remove(sessionId, id) {
    set((s) => {
      if (!s.artifacts[id]) return s;
      const { [id]: _, ...rest } = s.artifacts;
      const order = (s.orderBySession[sessionId] ?? []).filter((x) => x !== id);
      const active = s.activeBySession[sessionId];
      const nextActive = active === id ? order[order.length - 1] : active;
      return {
        artifacts: rest,
        orderBySession: { ...s.orderBySession, [sessionId]: order },
        activeBySession: { ...s.activeBySession, [sessionId]: nextActive },
        openBySession: { ...s.openBySession, [sessionId]: order.length > 0 },
      };
    });
  },

  clearSession(sessionId) {
    set((s) => {
      const order = s.orderBySession[sessionId] ?? [];
      if (order.length === 0) return s;
      const artifacts = { ...s.artifacts };
      for (const id of order) delete artifacts[id];
      const orderBySession = { ...s.orderBySession };
      delete orderBySession[sessionId];
      const activeBySession = { ...s.activeBySession };
      delete activeBySession[sessionId];
      const openBySession = { ...s.openBySession, [sessionId]: false };
      return { artifacts, orderBySession, activeBySession, openBySession };
    });
  },

  clearUnpinned(sessionId) {
    set((s) => {
      const order = s.orderBySession[sessionId] ?? [];
      const keep = order.filter((id) => s.artifacts[id]?.pinned);
      const artifacts = { ...s.artifacts };
      for (const id of order) if (!keep.includes(id)) delete artifacts[id];
      const active = s.activeBySession[sessionId];
      return {
        artifacts,
        orderBySession: { ...s.orderBySession, [sessionId]: keep },
        activeBySession: {
          ...s.activeBySession,
          [sessionId]: keep.includes(active ?? "") ? active : keep[keep.length - 1],
        },
        openBySession: { ...s.openBySession, [sessionId]: keep.length > 0 },
      };
    });
  },

  setWidth(sessionId, px) {
    set((s) => ({
      widthBySession: {
        ...s.widthBySession,
        [sessionId]: Math.max(ARTIFACT_PANE_MIN, Math.min(ARTIFACT_PANE_MAX, px)),
      },
    }));
  },
}));

/** Selector helper: ordered artifacts for a session. */
export function selectSessionArtifacts(state: ArtifactState, sessionId: string): Artifact[] {
  const order = state.orderBySession[sessionId] ?? [];
  return order.map((id) => state.artifacts[id]).filter((a): a is Artifact => Boolean(a));
}
