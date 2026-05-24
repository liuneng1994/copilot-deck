import { useEffect, useState } from "react";

/** Returns a number that increments roughly every `intervalMs` ms, but only
 * while `active` is true. Use as a re-render trigger for components that
 * display "live" derived values like elapsed duration. */
export function useTick(active: boolean, intervalMs = 1000): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setN((v) => v + 1), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return n;
}
