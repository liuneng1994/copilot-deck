// Top-of-screen banner shown when the server reports a newer Copilot Deck
// release. Non-blocking; offers a copy-to-clipboard upgrade command, a link
// to release notes, and a 7-day snooze.

import { Check, ExternalLink, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { useUIStore } from "../../stores/ui-store";
import { Button } from "../ui/button";

const UPGRADE_CMD = "npm install -g copilot-deck@latest";

export function UpdateBanner() {
  const update = useUIStore((s) => s.availableUpdate);
  const snooze = useUIStore((s) => s.snoozeUpdate);
  const dismiss = useUIStore((s) => s.setAvailableUpdate);
  const [copied, setCopied] = useState(false);

  if (!update) return null;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(UPGRADE_CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-100 px-3 py-1.5 text-xs dark:bg-amber-500/10">
      <div className="flex min-w-0 items-center gap-2 text-amber-900 dark:text-amber-200">
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          Copilot Deck <span className="font-semibold">v{update.latest}</span> is available
          <span className="ml-1 text-amber-800/80 dark:text-amber-200/70">
            (you have v{update.installed})
          </span>
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 text-[11px] text-amber-950 hover:bg-amber-200 dark:text-amber-100 dark:hover:bg-amber-500/20"
          onClick={onCopy}
        >
          {copied ? <Check className="h-3 w-3" /> : null}
          {copied ? "Copied" : `Copy: ${UPGRADE_CMD}`}
        </Button>
        <a
          href={update.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium text-amber-950 hover:bg-amber-200 dark:text-amber-100 dark:hover:bg-amber-500/20"
        >
          Release notes
          <ExternalLink className="h-3 w-3" />
        </a>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[11px] text-amber-900/80 hover:bg-amber-200 dark:text-amber-100/80 dark:hover:bg-amber-500/20"
          onClick={() => snooze(7)}
        >
          Snooze 7d
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-amber-900/80 hover:bg-amber-200 dark:text-amber-100/80 dark:hover:bg-amber-500/20"
          aria-label="Dismiss"
          onClick={() => dismiss(null)}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
