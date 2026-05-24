import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface BundlePaths {
  serverEntry: string;
  webDir: string | null;
}

export function resolveBundle(): BundlePaths {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/lib/bundle.js → ../../
  const cliRoot = path.resolve(here, "..", "..");
  const bundledServer = path.join(cliRoot, "dist-bundle", "server", "main.js");
  const bundledWeb = path.join(cliRoot, "dist-bundle", "web");

  if (existsSync(bundledServer)) {
    return {
      serverEntry: bundledServer,
      webDir: existsSync(bundledWeb) ? bundledWeb : null,
    };
  }

  // Dev fallback: workspace layout.
  const repoRoot = path.resolve(cliRoot, "..", "..");
  const devServer = path.join(repoRoot, "packages", "server", "dist", "main.js");
  const devWeb = path.join(repoRoot, "packages", "web", "dist");
  if (existsSync(devServer)) {
    return { serverEntry: devServer, webDir: existsSync(devWeb) ? devWeb : null };
  }

  throw new Error(
    `could not locate server bundle. Looked for:\n  ${bundledServer}\n  ${devServer}`,
  );
}
