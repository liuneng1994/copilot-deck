import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUIStore } from "../../stores/ui-store";

interface SearchHit {
  messageId: string;
  sessionId: string;
  role: "user" | "agent";
  ts: number;
  cwd: string;
  title: string | null;
  /** Snippet with `<mark>…</mark>` from FTS5. */
  snippet: string;
  score: number;
}

function shortCwd(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  if (parts.length <= 2) return cwd;
  return `…/${parts.slice(-2).join("/")}`;
}

function relativeTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString();
}

/**
 * Cross-session full-text search overlay. Opens with ⌘⇧F; type to search,
 * arrow keys / ↵ to navigate, click or Enter on a hit to jump to that
 * session (and scroll to the message if visible in the loaded history).
 */
export function SearchOverlay() {
  const open = useUIStore((s) => s.searchOpen);
  const setOpen = useUIStore((s) => s.setSearchOpen);
  const setActiveSession = useUIStore((s) => s.setActiveSession);
  const sessions = useUIStore((s) => s.sessions);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus + reset on open.
  useEffect(() => {
    if (open) {
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQ("");
      setHits([]);
    }
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}&limit=50`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = (await r.json()) as { hits: SearchHit[] };
        if (!cancelled) {
          setHits(data.hits);
          setSel(0);
        }
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open]);

  const sessionTitles = useMemo(() => {
    const m: Record<string, string | undefined> = {};
    for (const s of Object.values(sessions)) m[s.id] = s.title ?? undefined;
    return m;
  }, [sessions]);

  // Keyboard navigation.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((i) => Math.min(hits.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        const hit = hits[sel];
        if (hit) {
          e.preventDefault();
          jumpTo(hit);
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, hits, sel, setOpen]);

  function jumpTo(hit: SearchHit) {
    setActiveSession(hit.sessionId);
    setOpen(false);
    // Scroll attempt; message may not be in the rendered window. data-msg-id
    // is rendered on each bubble in conversation.tsx.
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-msg-id="${hit.messageId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("search-flash");
        setTimeout(() => el.classList.remove("search-flash"), 1400);
      }
    }, 60);
  }

  if (!open) return null;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard close handled via window Escape listener
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-overlay/40 p-4 pt-[10vh]"
      onClick={() => setOpen(false)}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop-click stop only */}
      <div
        className="flex max-h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-panel-elevated shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-border border-b p-3">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search across all sessions…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {loading && (
            <span className="text-muted-foreground text-xs" aria-hidden>
              …
            </span>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Close (Esc)"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {q.trim().length === 0 && (
            <div className="p-6 text-center text-muted-foreground text-xs">
              Type to search messages across every session.
              <div className="mt-2 text-[10px]">↑↓ navigate · ↵ open · Esc close</div>
            </div>
          )}
          {q.trim().length >= 2 && !loading && hits.length === 0 && (
            <div className="p-6 text-center text-muted-foreground text-xs">
              No matches for <code className="text-foreground">{q.trim()}</code>.
            </div>
          )}
          {hits.length > 0 && (
            <ul className="divide-y divide-border">
              {hits.map((hit, i) => (
                <li key={hit.messageId}>
                  <button
                    type="button"
                    onClick={() => jumpTo(hit)}
                    onMouseEnter={() => setSel(i)}
                    className={`flex w-full flex-col gap-1 px-3 py-2 text-left text-xs transition-colors ${
                      i === sel ? "bg-accent/20" : "hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span
                        className={`rounded px-1.5 py-px font-medium ${
                          hit.role === "user"
                            ? "bg-sky-500/10 text-sky-400"
                            : "bg-emerald-500/10 text-emerald-400"
                        }`}
                      >
                        {hit.role}
                      </span>
                      <span className="truncate font-medium text-foreground/80">
                        {sessionTitles[hit.sessionId] || hit.title || "(untitled)"}
                      </span>
                      <span className="font-mono text-[10px]">{shortCwd(hit.cwd)}</span>
                      <span className="ml-auto whitespace-nowrap">{relativeTime(hit.ts)}</span>
                    </div>
                    <div
                      className="line-clamp-2 text-foreground/90 [&_mark]:bg-amber-300/30 [&_mark]:text-foreground [&_mark]:rounded-sm [&_mark]:px-0.5"
                      // FTS5 snippets contain `<mark>` highlights around
                      // matched terms. sanitizeSnippet() escapes everything
                      // else; only those exact tags survive.
                      // biome-ignore lint/security/noDangerouslySetInnerHtml: snippet sanitised via sanitizeSnippet()
                      dangerouslySetInnerHTML={{ __html: sanitizeSnippet(hit.snippet) }}
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Defence-in-depth: FTS snippets come from our own message bodies (LLM
 * output / user prompts), which could legitimately contain `<` and `>`
 * characters. We escape everything, then re-introduce the `<mark>` /
 * `</mark>` tokens that the server injected for highlighting.
 */
function sanitizeSnippet(snippet: string): string {
  const PLACE_OPEN = "\u0001MARK_OPEN\u0001";
  const PLACE_CLOSE = "\u0001MARK_CLOSE\u0001";
  return snippet
    .replace(/<mark>/g, PLACE_OPEN)
    .replace(/<\/mark>/g, PLACE_CLOSE)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(new RegExp(PLACE_OPEN, "g"), "<mark>")
    .replace(new RegExp(PLACE_CLOSE, "g"), "</mark>");
}
