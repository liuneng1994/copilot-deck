#!/usr/bin/env node
// Copies the prebuilt server + web outputs into packages/cli/dist-bundle so
// that `copilot-deck` published to npm can run without any pnpm/workspace
// machinery. Also embeds @agent-view/shared as a real node_module inside the
// server bundle so the ESM resolver finds it via standard lookup.
//
// Layout after this script:
//   packages/cli/dist-bundle/
//   ├── server/
//   │   ├── main.js, ...
//   │   └── node_modules/@agent-view/shared/{dist,package.json}
//   └── web/

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const cliRoot = path.join(repoRoot, "packages", "cli");
const bundleRoot = path.join(cliRoot, "dist-bundle");
const bundleServer = path.join(bundleRoot, "server");
const bundleWeb = path.join(bundleRoot, "web");
const bundleShared = path.join(bundleServer, "node_modules", "@agent-view", "shared");

const serverDist = path.join(repoRoot, "packages", "server", "dist");
const webDist = path.join(repoRoot, "packages", "web", "dist");
const sharedDist = path.join(repoRoot, "packages", "shared", "dist");
const sharedPkgJson = path.join(repoRoot, "packages", "shared", "package.json");

for (const [label, p] of [
  ["server", serverDist],
  ["web", webDist],
  ["shared", sharedDist],
]) {
  if (!existsSync(p)) {
    console.error(`[bundle] ${label} build missing: ${p}`);
    console.error("        run `pnpm build` first");
    process.exit(1);
  }
}

rmSync(bundleRoot, { recursive: true, force: true });
mkdirSync(bundleRoot, { recursive: true });
cpSync(serverDist, bundleServer, { recursive: true });
cpSync(webDist, bundleWeb, { recursive: true });

mkdirSync(bundleShared, { recursive: true });
cpSync(sharedDist, path.join(bundleShared, "dist"), { recursive: true });
const sharedPkg = JSON.parse(readFileSync(sharedPkgJson, "utf8"));
const embeddedPkg = {
  name: sharedPkg.name,
  version: sharedPkg.version,
  type: sharedPkg.type,
  main: "./dist/index.js",
  types: "./dist/index.d.ts",
  exports: {
    ".": {
      types: "./dist/index.d.ts",
      default: "./dist/index.js",
    },
  },
};
writeFileSync(
  path.join(bundleShared, "package.json"),
  JSON.stringify(embeddedPkg, null, 2),
  "utf8",
);

writeFileSync(path.join(bundleRoot, ".built-at"), `${new Date().toISOString()}\n`, "utf8");

console.log(`[bundle] wrote ${bundleServer}`);
console.log(`[bundle] wrote ${bundleWeb}`);
console.log("[bundle] embedded @agent-view/shared");
