import type { ReactNode } from "react";
import { openPath, segmentPaths } from "../../lib/file-paths";
import { useUIStore } from "../../stores/ui-store";

/** Inline clickable path. Cmd/Ctrl-click opens in editor; plain click opens preview. */
export function FileLink({
  path,
  line,
  col,
  display,
}: {
  path: string;
  line?: number;
  col?: number;
  display?: string;
}) {
  const cwd = useUIStore((s) => {
    const id = s.activeSessionId;
    return id ? (s.sessions[id]?.cwd ?? "") : "";
  });
  const label = display ?? (line ? `${path}:${line}${col ? `:${col}` : ""}` : path);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openPath(path, cwd, { editor: e.metaKey || e.ctrlKey });
      }}
      title={`Open ${path}${line ? `:${line}` : ""} (⌘-click: editor)`}
      className="cursor-pointer rounded-sm border-b border-dashed border-primary/40 px-0.5 font-mono text-primary hover:bg-primary/10 hover:border-primary"
    >
      {label}
    </button>
  );
}

/** Wraps plain text, turning detected paths into <FileLink>s. */
export function LinkifyPaths({ children }: { children: string }): ReactNode {
  const segs = segmentPaths(children);
  if (segs.length === 1 && segs[0]?.type === "text") return children;
  return segs.map((s, i) => {
    const key = `${s.type}-${i}-${s.text}`;
    return s.type === "path" && s.path ? (
      <FileLink key={key} path={s.path} line={s.line} col={s.col} display={s.text} />
    ) : (
      <span key={key}>{s.text}</span>
    );
  });
}
