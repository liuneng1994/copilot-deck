import { create } from "zustand";

export type ThemePref = "light" | "dark" | "system";
export type Density = "comfortable" | "compact";

export type UserPrefs = {
  theme: ThemePref;
  notificationsEnabled: boolean;
  density: Density;
  fontSize: number;
};

export type UserPrefsState = UserPrefs & {
  setTheme(t: ThemePref): void;
  setNotificationsEnabled(v: boolean): void;
  setDensity(d: Density): void;
  setFontSize(px: number): void;
  reset(): void;
};

const USER_PREFS_KEY = "copilot-deck:user-prefs";
const DEFAULT_USER_PREFS: UserPrefs = {
  theme: "system",
  notificationsEnabled: false,
  density: "comfortable",
  fontSize: 14,
};

function clampFontSize(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_USER_PREFS.fontSize;
  return Math.min(20, Math.max(12, px));
}

function readPrefs(state: UserPrefs): UserPrefs {
  return {
    theme: state.theme,
    notificationsEnabled: state.notificationsEnabled,
    density: state.density,
    fontSize: state.fontSize,
  };
}

function loadUserPrefs(): UserPrefs {
  if (typeof window === "undefined") return DEFAULT_USER_PREFS;
  try {
    const raw = window.localStorage.getItem(USER_PREFS_KEY);
    if (!raw) return DEFAULT_USER_PREFS;
    const parsed = JSON.parse(raw) as Partial<UserPrefs>;
    return {
      ...DEFAULT_USER_PREFS,
      ...parsed,
      fontSize: clampFontSize(parsed.fontSize ?? DEFAULT_USER_PREFS.fontSize),
    };
  } catch {
    return DEFAULT_USER_PREFS;
  }
}

function persist(prefs: UserPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(USER_PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

export const useUserPrefs = create<UserPrefsState>((set) => ({
  ...loadUserPrefs(),
  setTheme: (theme) =>
    set((state) => {
      const prefs = { ...readPrefs(state), theme };
      persist(prefs);
      return { theme };
    }),
  setNotificationsEnabled: (notificationsEnabled) =>
    set((state) => {
      const prefs = { ...readPrefs(state), notificationsEnabled };
      persist(prefs);
      return { notificationsEnabled };
    }),
  setDensity: (density) =>
    set((state) => {
      const prefs = { ...readPrefs(state), density };
      persist(prefs);
      return { density };
    }),
  setFontSize: (px) =>
    set((state) => {
      const fontSize = clampFontSize(px);
      const prefs = { ...readPrefs(state), fontSize };
      persist(prefs);
      return { fontSize };
    }),
  reset: () => {
    persist(DEFAULT_USER_PREFS);
    set(DEFAULT_USER_PREFS);
  },
}));

export const userPrefsStore = useUserPrefs;
