import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * Visual wrapper for paragraphs identified as model "reasoning"
 * (plans, transitions, summaries). Renders a subtle tinted card with a
 * left accent bar so reasoning prose visually stands out from tool calls
 * and incidental output.
 */
export function ReasoningBlock({
  children,
  variant = "default",
}: {
  children: ReactNode;
  variant?: "default" | "summary";
}) {
  return (
    <div
      className={cn(
        "my-2 rounded-md border-l-[3px] px-3 py-1.5",
        variant === "summary"
          ? "border-success bg-success/5"
          : "border-primary/70 bg-primary/[0.04]",
      )}
    >
      {children}
    </div>
  );
}

const REASONING_LEAD_RE =
  /^(let me|i'?ll|i will|i'?m going to|i need to|now i|first[,:]|next[,:]|finally[,:]|to summarize|in summary|让我|我会|我将|我需要|接下来|首先|然后|最后|现在|总结|总的来说)\b/i;

/** Heuristic: does this paragraph look like model reasoning? */
export function looksLikeReasoning(paragraph: string): boolean {
  const t = paragraph.trim();
  if (!t) return false;
  if (/^#{2,3}\s/.test(t)) return true;
  if (/^(\d+\.\s|[-*]\s\[[ x]\]\s)/m.test(t)) {
    // Multi-step plan list — count items.
    const items = t.match(/(^|\n)\s*(?:\d+\.\s|[-*]\s\[[ x]\]\s)/g);
    if (items && items.length >= 2) return true;
  }
  if (REASONING_LEAD_RE.test(t)) return true;
  return false;
}
