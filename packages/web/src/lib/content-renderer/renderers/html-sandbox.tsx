import { useMemo } from "react";

/**
 * HTML preview rendered inside a fully-isolated sandboxed iframe.
 *
 * `sandbox=""` (empty allow-list) disables: scripts, same-origin, popups, forms,
 * top-level navigation, pointer lock, modals, downloads, presentations.
 * Combined with `srcDoc` (no remote network unless the doc itself loads it
 * cross-origin from inside the sandbox — which it cannot, since scripts are off)
 * this gives us pure HTML rendering with zero JS execution capability.
 */
export function HtmlSandbox({
  src,
  full,
}: {
  src: string;
  full?: boolean;
}) {
  // Drop any <script> blocks defensively (sandbox already blocks execution; this
  // is purely cosmetic — keeps preview clean and surfaces inert markup).
  const safe = useMemo(() => src.replace(/<script[\s\S]*?<\/script>/gi, ""), [src]);

  return (
    <iframe
      title="html-preview"
      sandbox=""
      srcDoc={safe}
      className={
        full
          ? "h-[70vh] w-full rounded-md border border-border bg-white"
          : "h-48 w-full rounded-md border border-border bg-white"
      }
    />
  );
}
