import type { FileEntry, GitStatus, GrepHit, OutlineNode } from "@agent-view/shared";
import type { StateCreator } from "zustand";

export interface FilesOverview {
  gitStatus: GitStatus;
  touched: FileEntry[];
  generation: number;
}

export type FileSourceFilter = "touched" | "dirty" | "untracked" | "all";
export type FilesViewMode = "files" | "search" | "timeline";

export interface FilesFilters {
  source: FileSourceFilter;
  sort: "recency" | "changes" | "path";
  group: "directory" | "touch" | "turn";
  showGenerated: boolean;
  showIgnored: boolean;
  query: string;
  flat: boolean;
}

export interface FilesSlice {
  filesOverview: Record<string, FilesOverview | undefined>;
  filesViewMode: FilesViewMode;
  selectedFilePath: string | null;
  reviewed: Record<string, Set<string>>;
  filters: FilesFilters;
  grepOps: Record<string, { hits: GrepHit[]; done: boolean; truncated?: boolean; error?: string }>;
  outlineCache: Record<string, OutlineNode[] | null>;

  loadFilesOverview(cwd: string): Promise<void>;
  setSelectedFilePath(path: string | null): void;
  setFilesViewMode(mode: FilesViewMode): void;
  setFilesFilters(patch: Partial<FilesFilters>): void;
  hydrateReviewed(sessionId: string, paths: string[]): void;
  markReviewed(sessionId: string, path: string, reviewed: boolean): void;
  invalidateFilesIndex(cwd: string): void;
  recordGitStatus(cwd: string, status: GitStatus): void;
  appendGrepChunk(opId: string, hits: GrepHit[]): void;
  finalizeGrep(opId: string, info: { total: number; truncated: boolean; error?: string }): void;
}

const DEFAULT_FILTERS: FilesFilters = {
  source: "touched",
  sort: "recency",
  group: "directory",
  showGenerated: false,
  showIgnored: false,
  query: "",
  flat: false,
};

const LS_KEY = "av:files:filters";
const VIEW_MODE_LS_KEY = "av:files:viewMode";

function loadInitialFilters(): FilesFilters {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_FILTERS;
    return { ...DEFAULT_FILTERS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function loadInitialViewMode(): FilesViewMode {
  if (typeof window === "undefined") return "files";
  const raw = window.localStorage.getItem(VIEW_MODE_LS_KEY);
  return raw === "files" || raw === "search" || raw === "timeline" ? raw : "files";
}

async function sha1(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function diffHash(cwd: string, path: string): Promise<string> {
  const params = new URLSearchParams({ cwd, path, base: "HEAD" });
  const response = await fetch(`/api/git/diff?${params.toString()}`);
  if (!response.ok) throw new Error(await response.text());
  const data = (await response.json()) as { diff?: string };
  return sha1(data.diff ?? "");
}

export const createFilesSlice: StateCreator<FilesSlice & any, [], [], FilesSlice> = (set, get) => ({
  filesOverview: {},
  filesViewMode: loadInitialViewMode(),
  selectedFilePath: null,
  reviewed: {},
  filters: loadInitialFilters(),
  grepOps: {},
  outlineCache: {},

  async loadFilesOverview(cwd) {
    try {
      const response = await fetch(`/api/files/overview?cwd=${encodeURIComponent(cwd)}`);
      if (!response.ok) return;
      const data = (await response.json()) as {
        gitStatus: GitStatus;
        touched: FileEntry[];
      };
      const prev = get().filesOverview[cwd];
      set({
        filesOverview: {
          ...get().filesOverview,
          [cwd]: {
            gitStatus: data.gitStatus,
            touched: data.touched,
            generation: (prev?.generation ?? 0) + 1,
          },
        },
      });
    } catch {}
  },
  setSelectedFilePath(path) {
    set({ selectedFilePath: path });
  },
  setFilesViewMode(mode) {
    set({ filesViewMode: mode });
    try {
      window.localStorage.setItem(VIEW_MODE_LS_KEY, mode);
    } catch {}
  },
  setFilesFilters(patch) {
    const next = { ...get().filters, ...patch };
    set({ filters: next });
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {}
  },
  hydrateReviewed(sessionId, paths) {
    set({ reviewed: { ...get().reviewed, [sessionId]: new Set(paths) } });
  },
  markReviewed(sessionId, path, reviewed) {
    const current = new Set(get().reviewed[sessionId] ?? []);
    if (reviewed) current.add(path);
    else current.delete(path);
    set({ reviewed: { ...get().reviewed, [sessionId]: current } });

    void (async () => {
      const { sendWs } = await import("../lib/ws-client");
      if (!reviewed) {
        sendWs({ type: "unmark_reviewed", sessionId, path });
        return;
      }
      const cwd = get().sessions?.[sessionId]?.cwd;
      if (!cwd) return;
      sendWs({ type: "mark_reviewed", sessionId, path, diffHash: await diffHash(cwd, path) });
    })().catch(() => {});
  },
  invalidateFilesIndex(cwd) {
    void get().loadFilesOverview(cwd);
  },
  recordGitStatus(cwd, status) {
    const prev = get().filesOverview[cwd];
    if (!prev) {
      void get().loadFilesOverview(cwd);
      return;
    }
    set({
      filesOverview: {
        ...get().filesOverview,
        [cwd]: { ...prev, gitStatus: status, generation: prev.generation + 1 },
      },
    });
  },
  appendGrepChunk(opId, hits) {
    const current = get().grepOps[opId] ?? { hits: [], done: false };
    set({
      grepOps: {
        ...get().grepOps,
        [opId]: { ...current, hits: [...current.hits, ...hits] },
      },
    });
  },
  finalizeGrep(opId, info) {
    const current = get().grepOps[opId] ?? { hits: [], done: false };
    set({
      grepOps: {
        ...get().grepOps,
        [opId]: {
          ...current,
          done: true,
          truncated: info.truncated,
          error: info.error,
        },
      },
    });
  },
});
