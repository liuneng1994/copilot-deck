import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUIStore } from "../../stores/ui-store";

const HIGHLIGHT_CLASS = "agent-view-find-hit";
const ACTIVE_CLASS = "agent-view-find-active";

/**
 * Cmd/Ctrl+F find-in-conversation overlay. v1 strategy: walk the active
 * conversation's DOM text nodes, wrap matches in <mark>, support next/prev
 * navigation. Closes on Esc; cleans up highlights on close or query change.
 */
export function FindBar() {
  const open = useUIStore((s) => s.findOpen);
  const setOpen = useUIStore((s) => s.setFindOpen);
  const activeId = useUIStore((s) => s.activeSessionId);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<HTMLElement[]>([]);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  /** Strip any previously-injected highlight wrappers. */
  const clearHighlights = useCallback(() => {
    const wrappers = document.querySelectorAll(`.${HIGHLIGHT_CLASS}`);
    for (const el of wrappers) {
      const parent = el.parentNode;
      if (!parent) continue;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      parent.normalize();
    }
  }, []);

  /** Find matches in the conversation scroller and wrap them in <mark> nodes. */
  const runSearch = useCallback(
    (q: string) => {
      clearHighlights();
      if (!q || q.length < 1) {
        setHits([]);
        return;
      }
      const root = document.querySelector<HTMLElement>("[data-conversation-root]");
      if (!root) {
        setHits([]);
        return;
      }
      const lower = q.toLowerCase();
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.toLowerCase().includes(lower)) {
            return NodeFilter.FILTER_REJECT;
          }
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          // Skip code highlighter spans (re-runs on each render and noisy).
          if (parent.closest("script,style")) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      const found: HTMLElement[] = [];
      const toProcess: Text[] = [];
      let n: Node | null = walker.nextNode();
      while (n) {
        toProcess.push(n as Text);
        n = walker.nextNode();
      }
      for (const text of toProcess) {
        const value = text.nodeValue ?? "";
        const lowVal = value.toLowerCase();
        let cursor = 0;
        const frag = document.createDocumentFragment();
        let local = lowVal.indexOf(lower, cursor);
        while (local !== -1) {
          if (local > cursor) {
            frag.appendChild(document.createTextNode(value.slice(cursor, local)));
          }
          const mark = document.createElement("mark");
          mark.className = HIGHLIGHT_CLASS;
          mark.textContent = value.slice(local, local + q.length);
          frag.appendChild(mark);
          found.push(mark);
          cursor = local + q.length;
          local = lowVal.indexOf(lower, cursor);
        }
        if (cursor < value.length) {
          frag.appendChild(document.createTextNode(value.slice(cursor)));
        }
        text.parentNode?.replaceChild(frag, text);
      }
      setHits(found);
      setIdx(0);
    },
    [clearHighlights],
  );

  // Re-search when query / active session changes. activeId is intentional —
  // switching sessions remounts the conversation DOM so previously-found hits
  // are invalid and we need to rerun.
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeId triggers rerun on session switch
  useEffect(() => {
    if (!open) return;
    runSearch(query);
  }, [query, open, activeId, runSearch]);

  // Focus the active hit & scroll into view whenever idx or hits change.
  useEffect(() => {
    const prevActive = document.querySelectorAll(`.${ACTIVE_CLASS}`);
    for (const el of prevActive) el.classList.remove(ACTIVE_CLASS);
    const hit = hits[idx];
    if (hit) {
      hit.classList.add(ACTIVE_CLASS);
      hit.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [idx, hits]);

  // Auto-focus on open + cleanup on close.
  useEffect(() => {
    if (!open) {
      clearHighlights();
      setHits([]);
      return;
    }
    setTimeout(() => inputRef.current?.focus(), 10);
  }, [open, clearHighlights]);

  const next = useCallback(() => {
    if (hits.length === 0) return;
    setIdx((i) => (i + 1) % hits.length);
  }, [hits.length]);
  const prev = useCallback(() => {
    if (hits.length === 0) return;
    setIdx((i) => (i - 1 + hits.length) % hits.length);
  }, [hits.length]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) prev();
      else next();
    }
  };

  const counter = useMemo(() => {
    if (!query) return "";
    if (hits.length === 0) return "0/0";
    return `${idx + 1}/${hits.length}`;
  }, [query, hits.length, idx]);

  if (!open) return null;
  return (
    <div className="pointer-events-auto absolute right-4 top-2 z-30 flex items-center gap-1 rounded-md border border-border bg-panel-elevated px-2 py-1.5 shadow-lg">
      <Search className="h-3.5 w-3.5 text-muted-foreground" />
      <input
        ref={inputRef}
        type="text"
        placeholder="Find in conversation"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKey}
        className="w-56 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
      />
      <span className="min-w-[40px] text-right text-[10px] tabular-nums text-muted-foreground">
        {counter}
      </span>
      <button
        type="button"
        onClick={prev}
        title="Previous (Shift+Enter)"
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ChevronUp className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={next}
        title="Next (Enter)"
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <ChevronDown className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        title="Close (Esc)"
        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
