import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getPackageInfo } from "../lib/package-info.js";

export interface UpgradeOptions {
  run: boolean;
}

const UPGRADE_CMD = "npm install -g copilot-deck@latest";

export async function runUpgrade(opts: UpgradeOptions): Promise<void> {
  const pkg = getPackageInfo();
  if (insideMonorepo()) {
    process.stdout.write(
      "\n  You appear to be inside the copilot-deck source checkout.\n" +
        "  Run `pnpm install && pnpm build` instead, or invoke this outside the repo.\n\n",
    );
    process.exit(2);
  }
  if (!opts.run) {
    process.stdout.write(`\n  Installed: v${pkg.version}\n`);
    process.stdout.write(`  To upgrade, run:\n\n    ${UPGRADE_CMD}\n\n`);
    process.stdout.write("  Or invoke `copilot-deck upgrade --run` to execute it for you.\n\n");
    return;
  }
  process.stdout.write(`\n  Running: ${UPGRADE_CMD}\n\n`);
  const child = spawn("npm", ["install", "-g", "copilot-deck@latest"], {
    stdio: "inherit",
  });
  await new Promise<void>((resolve) => {
    child.on("exit", (code) => {
      if (code === 0) {
        process.stdout.write(
          "\n  ✓ Upgrade complete. Restart `copilot-deck` to use the new version.\n\n",
        );
        resolve();
      } else {
        process.stderr.write(
          `\n  npm exited ${code}. If this was a permissions error, try one of:\n    sudo npm install -g copilot-deck@latest\n    npm config get prefix    # then chown the prefix, or pick a user-writable one\n\n`,
        );
        process.exit(code ?? 1);
      }
    });
  });
}

function insideMonorepo(): boolean {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, "package.json");
    if (existsSync(p)) {
      try {
        const j = JSON.parse(readFileSync(p, "utf8")) as { name?: string };
        if (j.name === "agent-view") return true;
      } catch {}
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}
