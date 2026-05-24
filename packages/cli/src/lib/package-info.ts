import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let cached: { version: string; name: string } | null = null;

export function getPackageInfo(): { version: string; name: string } {
  if (cached) return cached;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/lib/package-info.js → ../../package.json
  const candidates = [
    path.join(here, "..", "..", "package.json"),
    path.join(here, "..", "package.json"),
    path.join(process.cwd(), "package.json"),
  ];
  for (const p of candidates) {
    try {
      const json = JSON.parse(readFileSync(p, "utf8")) as { name?: string; version?: string };
      if (json.version && json.name) {
        cached = { name: json.name, version: json.version };
        return cached;
      }
    } catch {}
  }
  cached = { name: "copilot-deck", version: "0.0.0" };
  return cached;
}
