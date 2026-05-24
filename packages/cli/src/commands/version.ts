import { getPackageInfo } from "../lib/package-info.js";

export async function runVersion(): Promise<void> {
  const pkg = getPackageInfo();
  process.stdout.write(`copilot-deck v${pkg.version} (node ${process.versions.node})\n`);
}
