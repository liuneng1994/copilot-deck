// Periodic GitHub Releases poll to surface new Copilot Deck versions.
//
// Caches the most-recent successful response in <dataDir>/update-cache.json so
// network failures (offline laptop, 429 rate limit) don't lose the last known
// state. Comparison is a strict semver-with-prerelease compare against the
// installed version supplied by main.ts.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const RELEASES_URL = "https://api.github.com/repos/liuneng1994/copilot-deck/releases/latest";
const POLL_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const REQUEST_TIMEOUT_MS = 10_000;
const USER_AGENT = "copilot-deck-update-check";

export interface UpdateInfo {
  /** Semver tag without the leading 'v'. */
  latest: string;
  /** Tag name as published (e.g. v1.2.3). */
  tag: string;
  /** Release page URL. */
  url: string;
  /** Release notes body (markdown). */
  notes: string;
  /** ISO publishedAt. */
  publishedAt: string;
}

export interface UpdateCache {
  installed: string;
  latest: UpdateInfo | null;
  /** ms epoch of last successful poll. */
  checkedAt: number;
  /** ms epoch of last attempt (success or failure). */
  attemptedAt: number;
  /** Error from the most recent failed poll, if any. */
  lastError?: string;
}

export interface UpdateCheckOptions {
  installedVersion: string;
  dataDir: string;
  onUpdate?: (info: UpdateInfo, installed: string) => void;
  /** Override interval for tests. */
  intervalMs?: number;
  /** Disable network entirely (still serves from cache). */
  offline?: boolean;
}

export class UpdateChecker {
  private cache: UpdateCache;
  private cachePath: string;
  private timer: NodeJS.Timeout | null = null;
  private opts: UpdateCheckOptions;

  constructor(opts: UpdateCheckOptions) {
    this.opts = opts;
    this.cachePath = path.join(opts.dataDir, "update-cache.json");
    this.cache = this.loadCache();
  }

  start(): void {
    // First poll on next tick so server startup isn't blocked.
    setImmediate(() => this.poll().catch(() => {}));
    const interval = this.opts.intervalMs ?? POLL_INTERVAL_MS;
    this.timer = setInterval(() => this.poll().catch(() => {}), interval);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getCache(): UpdateCache {
    return this.cache;
  }

  /** Force-refresh now; returns the latest cache. */
  async refresh(): Promise<UpdateCache> {
    await this.poll();
    return this.cache;
  }

  private loadCache(): UpdateCache {
    try {
      const raw = readFileSync(this.cachePath, "utf8");
      const parsed = JSON.parse(raw) as UpdateCache;
      return { ...parsed, installed: this.opts.installedVersion };
    } catch {
      return {
        installed: this.opts.installedVersion,
        latest: null,
        checkedAt: 0,
        attemptedAt: 0,
      };
    }
  }

  private saveCache(): void {
    try {
      writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2), "utf8");
    } catch {
      // best-effort, no rethrow
    }
  }

  private async poll(): Promise<void> {
    if (this.opts.offline) return;
    this.cache.attemptedAt = Date.now();
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(RELEASES_URL, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": USER_AGENT,
        },
        signal: ctl.signal,
      }).finally(() => clearTimeout(timer));
      if (!res.ok) {
        this.cache.lastError = `HTTP ${res.status}`;
        this.saveCache();
        return;
      }
      const data = (await res.json()) as {
        tag_name?: string;
        html_url?: string;
        body?: string;
        published_at?: string;
        draft?: boolean;
        prerelease?: boolean;
      };
      if (!data.tag_name || data.draft) {
        this.cache.lastError = "no published release";
        this.saveCache();
        return;
      }
      const latest = stripV(data.tag_name);
      const info: UpdateInfo = {
        latest,
        tag: data.tag_name,
        url:
          data.html_url ??
          `https://github.com/liuneng1994/copilot-deck/releases/tag/${data.tag_name}`,
        notes: data.body ?? "",
        publishedAt: data.published_at ?? new Date().toISOString(),
      };
      const previousLatest = this.cache.latest?.latest;
      this.cache.latest = info;
      this.cache.checkedAt = Date.now();
      this.cache.lastError = undefined;
      this.saveCache();

      if (compareSemver(latest, this.opts.installedVersion) > 0 && previousLatest !== latest) {
        this.opts.onUpdate?.(info, this.opts.installedVersion);
      }
    } catch (e) {
      this.cache.lastError = e instanceof Error ? e.message : String(e);
      this.saveCache();
    }
  }
}

export function stripV(tag: string): string {
  return tag.replace(/^v/, "");
}

/**
 * Compare two semver strings. Returns -1, 0, or 1.
 * Handles MAJOR.MINOR.PATCH plus an optional prerelease tag separated by '-'.
 * Prerelease versions sort *lower* than their release counterpart (semver §11).
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa.parts[i] !== pb.parts[i]) return pa.parts[i] > pb.parts[i] ? 1 : -1;
  }
  if (pa.pre === undefined && pb.pre === undefined) return 0;
  if (pa.pre === undefined) return 1;
  if (pb.pre === undefined) return -1;
  if (pa.pre === pb.pre) return 0;
  return pa.pre > pb.pre ? 1 : -1;
}

function parseSemver(v: string): { parts: [number, number, number]; pre?: string } {
  const clean = stripV(v.trim());
  const [core, pre] = clean.split("-", 2);
  const parts = core.split(".").map((n) => {
    const x = Number.parseInt(n, 10);
    return Number.isFinite(x) ? x : 0;
  });
  while (parts.length < 3) parts.push(0);
  return { parts: [parts[0]!, parts[1]!, parts[2]!], pre };
}
