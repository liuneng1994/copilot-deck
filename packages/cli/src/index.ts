// copilot-deck CLI entry. Dispatches to subcommands using Node 22's built-in
// parseArgs — no heavyweight CLI framework required.

import { parseArgs } from "node:util";
import { runDataDir } from "./commands/data-dir.js";
import { runDoctor } from "./commands/doctor.js";
import { runStart } from "./commands/start.js";
import { runUpgrade } from "./commands/upgrade.js";
import { runVersion } from "./commands/version.js";

const HELP = `\
copilot-deck — browser UI for the GitHub Copilot CLI

Usage:
  copilot-deck [start]              start the server and open the browser
  copilot-deck doctor               check Node / Copilot CLI / data dir
  copilot-deck upgrade [--run]      print or execute the upgrade command
  copilot-deck version              print installed + latest known version
  copilot-deck data-dir             print resolved data directory
  copilot-deck --help               show this help

start options:
  --port <n>            preferred port (default 4173, auto-bumps if busy)
  --host <h>            bind host (default 127.0.0.1)
  --no-open             don't launch the browser
  --no-update-check     skip the GitHub Releases poll

Environment:
  COPILOT_DECK_HOME                   override data directory (default ~/.copilot-deck)
  COPILOT_DECK_DISABLE_UPDATE_CHECK=1 alternative to --no-update-check
  COPILOT_CLI_PATH                    path to copilot binary if not on PATH
`;

export async function main(argv: string[]): Promise<void> {
  const sub = argv[0] && !argv[0].startsWith("-") ? argv[0] : "start";
  const rest = argv[0] === sub ? argv.slice(1) : argv;
  if (sub === "--help" || sub === "-h" || sub === "help") {
    process.stdout.write(HELP);
    return;
  }
  switch (sub) {
    case "start":
      return runStart(parseStartArgs(rest));
    case "doctor":
      return runDoctor();
    case "upgrade":
      return runUpgrade(parseUpgradeArgs(rest));
    case "version":
      return runVersion();
    case "data-dir":
      return runDataDir();
    default:
      process.stderr.write(`unknown subcommand: ${sub}\n\n${HELP}`);
      process.exit(2);
  }
}

function parseStartArgs(rest: string[]): {
  port: number;
  host: string;
  open: boolean;
  updateCheck: boolean;
} {
  const { values } = parseArgs({
    args: rest,
    options: {
      port: { type: "string", default: "4173" },
      host: { type: "string", default: "127.0.0.1" },
      open: { type: "boolean", default: true },
      "no-open": { type: "boolean", default: false },
      "update-check": { type: "boolean", default: true },
      "no-update-check": { type: "boolean", default: false },
    },
    allowPositionals: false,
    strict: true,
  });
  const port = Number.parseInt(String(values.port), 10);
  const open = !values["no-open"] && values.open !== false;
  const updateCheck = !values["no-update-check"] && values["update-check"] !== false;
  return {
    port: Number.isFinite(port) && port >= 0 ? port : 4173,
    host: String(values.host),
    open,
    updateCheck,
  };
}

function parseUpgradeArgs(rest: string[]): { run: boolean } {
  const { values } = parseArgs({
    args: rest,
    options: { run: { type: "boolean", default: false } },
    allowPositionals: false,
    strict: true,
  });
  return { run: values.run === true };
}
