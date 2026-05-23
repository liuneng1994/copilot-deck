import type { SkillInfo } from "@agent-view/shared";
import { Loader2, Search, Trash2 } from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../../../lib/cn";
import { connectWs, onWsMessage } from "../../../lib/ws-client";
import { useUIStore } from "../../../stores/ui-store";
import { Button } from "../../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { Input } from "../../ui/input";

interface SkillsListResponse {
  repo?: SkillInfo[];
  global?: SkillInfo[];
  error?: string;
}

interface SkillSearchResult {
  name: string;
  source?: string;
  installs?: number;
  description?: string;
}

interface SearchResponse {
  results?: SkillSearchResult[];
  error?: string;
}

interface InstallResponse {
  opId?: string;
  error?: string;
}

type Scope = "repo" | "global";

interface InflightOp {
  opId: string;
  target: string;
  scope: Scope;
  cwd?: string;
  lines: string[];
  done?: boolean;
  success?: boolean;
  error?: string;
}

const SELECT_CLASS =
  "h-8 rounded-md border border-input bg-panel px-2 text-xs text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";

export function SkillsPanel() {
  const sessions = useUIStore((s) => s.sessions);
  const activeSessionId = useUIStore((s) => s.activeSessionId);
  const activeCwd = activeSessionId ? sessions[activeSessionId]?.cwd : undefined;
  const cwdOptions = useMemo(
    () =>
      Array.from(
        new Set(
          Object.values(sessions)
            .map((s) => s.cwd)
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [sessions],
  );
  const [selectedCwd, setSelectedCwd] = useState(activeCwd ?? cwdOptions[0] ?? "");
  const [repoSkills, setRepoSkills] = useState<SkillInfo[]>([]);
  const [globalSkills, setGlobalSkills] = useState<SkillInfo[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SkillSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [installCandidate, setInstallCandidate] = useState<SkillSearchResult | null>(null);
  const [installScope, setInstallScope] = useState<Scope>("repo");
  const [installCwd, setInstallCwd] = useState(selectedCwd);
  const [inflight, setInflight] = useState<InflightOp | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const refreshLists = useCallback(
    async (cwd = selectedCwd) => {
      setLoadingLists(true);
      setListError(null);
      try {
        const suffix = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
        const res = await fetch(`/api/extensions/skills${suffix}`);
        const data = (await res.json()) as SkillsListResponse;
        if (!res.ok) throw new Error(data.error ?? "Failed to load skills");
        setRepoSkills(data.repo ?? []);
        setGlobalSkills(data.global ?? []);
      } catch (error) {
        setListError(error instanceof Error ? error.message : String(error));
      } finally {
        setLoadingLists(false);
      }
    },
    [selectedCwd],
  );

  // Track the last activeCwd we synced from so we only re-seed selectedCwd
  // when the *active session* actually changes — otherwise a user's manual
  // dropdown pick would be stomped on every render.
  const lastSyncedActiveCwd = useRef<string | undefined>(activeCwd);
  useEffect(() => {
    if (activeCwd && activeCwd !== lastSyncedActiveCwd.current) {
      lastSyncedActiveCwd.current = activeCwd;
      setSelectedCwd(activeCwd);
      setInstallCwd(activeCwd);
    } else if (!selectedCwd && cwdOptions[0]) {
      setSelectedCwd(cwdOptions[0]);
      setInstallCwd(cwdOptions[0]);
    }
  }, [activeCwd, cwdOptions, selectedCwd]);

  useEffect(() => {
    void refreshLists(selectedCwd);
  }, [refreshLists, selectedCwd]);

  useEffect(() => {
    connectWs();
    const unsubscribe = onWsMessage((msg) => {
      if (!inflight || !("opId" in msg) || msg.opId !== inflight.opId) return;
      if (msg.type === "extension_op_progress") {
        setInflight((current) =>
          current?.opId === msg.opId
            ? { ...current, lines: [...current.lines.slice(-5), msg.line] }
            : current,
        );
      }
      if (msg.type === "extension_op_done") {
        setInflight((current) =>
          current?.opId === msg.opId
            ? { ...current, done: true, success: msg.success, error: msg.error }
            : current,
        );
        setTimeout(() => void refreshLists(inflight.cwd ?? selectedCwd), 600);
      }
    });
    return () => {
      unsubscribe();
    };
  }, [inflight, refreshLists, selectedCwd]);

  useEffect(() => {
    if (!inflight || inflight.done) return;
    const timer = setInterval(() => void refreshLists(inflight.cwd ?? selectedCwd), 2000);
    return () => clearInterval(timer);
  }, [inflight, refreshLists, selectedCwd]);

  const runSearch = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q) {
      setSearchResults([]);
      setSearchError(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/extensions/skills/search?q=${encodeURIComponent(q)}`);
      const data = (await res.json()) as SearchResponse;
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setSearchResults(data.results ?? []);
    } catch (error) {
      setSearchResults([]);
      setSearchError(error instanceof Error ? error.message : String(error));
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void runSearch(query), 400);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  async function installSkill(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!installCandidate) return;
    const cwd = installScope === "repo" ? installCwd : undefined;
    const pkg = packageId(installCandidate);
    setInflight({ opId: "pending", target: pkg, scope: installScope, cwd, lines: [] });
    try {
      const res = await fetch("/api/extensions/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pkg, scope: installScope, cwd }),
      });
      const data = (await res.json()) as InstallResponse;
      if (!res.ok || !data.opId) throw new Error(data.error ?? "Install failed");
      setInflight({
        opId: data.opId,
        target: pkg,
        scope: installScope,
        cwd,
        lines: ["Installing…"],
      });
      setInstallCandidate(null);
      setTimeout(() => void refreshLists(cwd ?? selectedCwd), 2000);
    } catch (error) {
      setInflight({
        opId: "failed",
        target: pkg,
        scope: installScope,
        cwd,
        lines: [],
        done: true,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function removeSkill(skill: SkillInfo) {
    const key = `${skill.scope}:${skill.cwd ?? "global"}:${skill.name}`;
    setRemoving(key);
    setListError(null);
    try {
      const params = new URLSearchParams({ scope: skill.scope });
      if (skill.scope === "repo" && selectedCwd) params.set("cwd", selectedCwd);
      const res = await fetch(
        `/api/extensions/skills/${encodeURIComponent(skill.name)}?${params.toString()}`,
        { method: "DELETE" },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Remove failed");
      await refreshLists(selectedCwd);
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error));
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-semibold text-foreground">Skills</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Add reusable agent skills for this repository or globally.
          </p>
        </div>
        <a
          href="https://skills.sh/"
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-primary underline-offset-4 hover:underline"
        >
          Browse leaderboard ↗
        </a>
      </div>

      <div className="relative">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void runSearch(query);
              }
            }}
            placeholder="Search skills (e.g. react, testing)..."
            className="pl-9"
          />
        </div>
        {(query.trim() || searching || searchError) && (
          <div className="mt-2 rounded-lg border border-border bg-panel-elevated p-2 shadow-lg">
            {searching ? (
              <StatusLine
                icon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}
                text="Searching…"
              />
            ) : searchError ? (
              <p className="px-2 py-1 text-xs text-destructive">{searchError}</p>
            ) : searchResults.length === 0 ? (
              <p className="px-2 py-1 text-xs text-muted-foreground">No matching skills found.</p>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {searchResults.map((result) => (
                  <SearchResultCard
                    key={`${result.source ?? "local"}:${result.name}`}
                    result={result}
                    onInstall={() => {
                      setInstallCandidate(result);
                      setInstallScope("repo");
                      setInstallCwd(selectedCwd);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {inflight && (
        <div
          className={cn(
            "rounded-lg border p-3 text-xs",
            inflight.done && inflight.success === false
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-border bg-panel text-muted-foreground",
          )}
        >
          <div className="flex items-center gap-2 font-medium text-foreground">
            {!inflight.done && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>
              {inflight.done
                ? inflight.success
                  ? `Installed ${inflight.target}`
                  : `Install failed: ${inflight.target}`
                : `Installing ${inflight.target}…`}
            </span>
          </div>
          {inflight.error && <p className="mt-1">{inflight.error}</p>}
          {inflight.lines.length > 0 && (
            <pre className="mt-2 max-h-20 overflow-y-auto whitespace-pre-wrap rounded bg-background/60 p-2 font-mono text-[11px]">
              {inflight.lines.join("\n")}
            </pre>
          )}
        </div>
      )}

      {listError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {listError}
        </div>
      )}

      <section className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold">This repo</h3>
            <p className="text-xs text-muted-foreground">
              Skills in .agents/skills for the selected cwd.
            </p>
          </div>
          <select
            value={selectedCwd}
            onChange={(event) => {
              setSelectedCwd(event.target.value);
              setInstallCwd(event.target.value);
            }}
            className={SELECT_CLASS}
            disabled={cwdOptions.length === 0}
          >
            {cwdOptions.length === 0 ? (
              <option value="">No active session cwd</option>
            ) : (
              cwdOptions.map((cwd) => (
                <option key={cwd} value={cwd}>
                  {cwd}
                </option>
              ))
            )}
          </select>
        </div>
        <SkillList
          skills={repoSkills}
          loading={loadingLists}
          empty="No skills installed in this repo. Search above to add."
          removing={removing}
          onRemove={removeSkill}
        />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Global</h3>
        <SkillList
          skills={globalSkills}
          loading={loadingLists}
          empty="No global skills installed."
          removing={removing}
          onRemove={removeSkill}
        />
      </section>

      <Dialog open={!!installCandidate} onOpenChange={(open) => !open && setInstallCandidate(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Install skill</DialogTitle>
            <DialogDescription>
              Choose where to install{" "}
              {installCandidate ? packageId(installCandidate) : "this skill"}.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={installSkill} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium" htmlFor="skill-scope">
                Scope
              </label>
              <select
                id="skill-scope"
                value={installScope}
                onChange={(event) => setInstallScope(event.target.value as Scope)}
                className={cn(SELECT_CLASS, "w-full")}
              >
                <option value="repo">This repo</option>
                <option value="global">Global</option>
              </select>
            </div>
            {installScope === "repo" && (
              <div className="space-y-2">
                <label className="text-xs font-medium" htmlFor="skill-cwd">
                  Repository cwd
                </label>
                <select
                  id="skill-cwd"
                  value={installCwd}
                  onChange={(event) => setInstallCwd(event.target.value)}
                  className={cn(SELECT_CLASS, "w-full")}
                  disabled={cwdOptions.length === 0}
                >
                  {cwdOptions.map((cwd) => (
                    <option key={cwd} value={cwd}>
                      {cwd}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setInstallCandidate(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={installScope === "repo" && !installCwd}>
                Install
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SkillList({
  skills,
  loading,
  empty,
  removing,
  onRemove,
}: {
  skills: SkillInfo[];
  loading: boolean;
  empty: string;
  removing: string | null;
  onRemove: (skill: SkillInfo) => void;
}) {
  if (loading && skills.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-panel p-4">
        <StatusLine
          icon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}
          text="Loading skills…"
        />
      </div>
    );
  }
  if (skills.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-background/50 p-4 text-xs text-muted-foreground">
        {empty}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {skills.map((skill) => {
        const removeKey = `${skill.scope}:${skill.cwd ?? "global"}:${skill.name}`;
        return (
          <div
            key={`${skill.scope}:${skill.cwd ?? "global"}:${skill.name}:${skill.path}`}
            className="rounded-lg border border-border bg-panel p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-semibold text-foreground">{skill.name}</h4>
                  <SourceBadge source={skill.source} fallback={skill.scope} />
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {skill.description || "No description provided."}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onRemove(skill)}
                disabled={removing === removeKey}
                className="shrink-0"
              >
                {removing === removeKey ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                Remove
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SearchResultCard({
  result,
  onInstall,
}: { result: SkillSearchResult; onInstall: () => void }) {
  return (
    <div className="rounded-md border border-border bg-background/50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-medium text-foreground">{result.name}</h4>
            <SourceBadge source={result.source} fallback="skill" />
            {typeof result.installs === "number" && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {result.installs.toLocaleString()} installs
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {result.description || "No description provided."}
          </p>
        </div>
        <Button type="button" size="sm" onClick={onInstall}>
          Install
        </Button>
      </div>
    </div>
  );
}

function SourceBadge({ source, fallback }: { source?: string; fallback: string }) {
  return (
    <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
      {source || fallback}
    </span>
  );
}

function StatusLine({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
      {icon}
      <span>{text}</span>
    </div>
  );
}

function packageId(result: SkillSearchResult): string {
  return result.source ? `${result.source}@${result.name}` : result.name;
}
