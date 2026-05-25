import type { FileEntry, GitStatus, GrepHit, OutlineNode } from "@agent-view/shared";
import type { StateCreator } from "zustand";

export interface FilesOverview {
  gitStatus: GitStatus;
  touched: FileEntry[];
  /** Paths (relative to cwd) the agent has edited during this session.
   *  Overlaid as a 🤖 badge on matching rows in the Files tab. The list
   *  itself is driven by git status, not by this set, so commits drain it. */
  agentTouched: string[];
  generation: number;
}

export type FileSourceFilter = "touched" | "dirty" | "untracked" | "all";
export type FilesViewMode =
  | "files"
  | "code"
  | "symbols"
  | "tests"
  | "context"
  | "search"
  | "timeline";

export interface WorkbenchSymbol {
  id: string;
  name: string;
  kind: string;
  path: string;
  startLine: number;
  endLine: number;
}

export type WorksetItem =
  | { id: string; kind: "file"; path: string; label: string }
  | {
      id: string;
      kind: "symbol";
      path: string;
      label: string;
      startLine: number;
      endLine: number;
    }
  | { id: string; kind: "test"; path: string; label: string; testName?: string }
  | { id: string; kind: "buildTarget"; label: string; command: string };

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
  focusedSymbol: WorkbenchSymbol | null;
  worksetItems: WorksetItem[];
  reviewed: Record<string, Set<string>>;
  filters: FilesFilters;
  grepOps: Record<string, { hits: GrepHit[]; done: boolean; truncated?: boolean; error?: string }>;
  outlineCache: Record<string, OutlineNode[] | null>;

  loadFilesOverview(cwd: string): Promise<void>;
  setSelectedFilePath(path: string | null): void;
  setFocusedSymbol(symbol: WorkbenchSymbol | null): void;
  setFilesViewMode(mode: FilesViewMode): void;
  setFilesFilters(patch: Partial<FilesFilters>): void;
  addWorksetItem(item: WorksetItem): void;
  removeWorksetItem(id: string): void;
  clearWorksetItems(): void;
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
  return raw === "files" ||
    raw === "code" ||
    raw === "symbols" ||
    raw === "tests" ||
    raw === "context" ||
    raw === "search" ||
    raw === "timeline"
    ? raw
    : "files";
}

export function formatWorksetPrompt(items: WorksetItem[], userText: string): string {
  if (items.length === 0) return userText;
  const lines = ["Use this workset:"];
  for (const item of items) {
    if (item.kind === "file") lines.push(`- File: ${item.path}`);
    else if (item.kind === "symbol")
      lines.push(`- Symbol: ${item.label} at ${item.path}:${item.startLine}-${item.endLine}`);
    else if (item.kind === "test")
      lines.push(`- Test: ${item.label}${item.testName ? ` (${item.testName})` : ""}`);
    else lines.push(`- Validate: ${item.command}`);
  }
  return `${lines.join("\n")}\n\nTask:\n${userText}`;
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
  focusedSymbol: null,
  worksetItems: [],
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
        agentTouched?: string[];
      };
      const prev = get().filesOverview[cwd];
      set({
        filesOverview: {
          ...get().filesOverview,
          [cwd]: {
            gitStatus: data.gitStatus,
            touched: data.touched,
            agentTouched: data.agentTouched ?? [],
            generation: (prev?.generation ?? 0) + 1,
          },
        },
      });
    } catch {}
  },
  setSelectedFilePath(path) {
    set({ selectedFilePath: path });
  },
  setFocusedSymbol(symbol) {
    set({ focusedSymbol: symbol });
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
  addWorksetItem(item) {
    set((state: FilesSlice) => {
      if (state.worksetItems.some((existing: WorksetItem) => existing.id === item.id)) {
        return state;
      }
      return { worksetItems: [...state.worksetItems, item] };
    });
  },
  removeWorksetItem(id) {
    set((state: FilesSlice) => ({
      worksetItems: state.worksetItems.filter((item: WorksetItem) => item.id !== id),
    }));
  },
  clearWorksetItems() {
    set({ worksetItems: [] });
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
    void get().loadFilesOverview(cwd);
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
