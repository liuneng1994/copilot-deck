#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { DEV_WEB_PORT, repoRoot, startDev } from "./dev.mjs";

const workRoot = path.join(repoRoot, ".dev-work", "agent-task");
const fixtureDir = path.join(workRoot, "repo");
const devHome = path.join(homedir(), ".copilot-deck-dev-agent-task");
const prepareOnly = process.argv.includes("--prepare-only");

await prepareFixture();

const promptLines = [
  "[agent-task] fixture ready",
  "[agent-task] copilot  real copilot CLI from PATH",
  `[agent-task] cwd      ${fixtureDir}`,
  `[agent-task] browser  http://localhost:${DEV_WEB_PORT}`,
  '[agent-task] prompt   "Start the long task in the background"',
  '[agent-task] prompt   "Run parallel review tasks"',
];

if (prepareOnly) {
  for (const line of promptLines) console.log(line);
  process.exit(0);
}

startDev({
  envOverrides: {
    COPILOT_DECK_DISABLE_UPDATE_CHECK: "1",
    COPILOT_DECK_HOME: devHome,
  },
  unsetEnv: ["COPILOT_CLI_PATH", "COPILOT_CLI_PREFIX_ARGS"],
  bannerLines: promptLines,
});

async function prepareFixture() {
  await rm(fixtureDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  await mkdir(path.join(fixtureDir, ".deck-tasks"), { recursive: true });
  await mkdir(path.join(fixtureDir, "src"), { recursive: true });
  await writeFile(path.join(fixtureDir, "src", "app.js"), "export const value = 1;\n");
  await writeTaskScripts();
  await writeAgentInstructions();
  run("git", ["init"], fixtureDir);
  run("git", ["config", "user.email", "agent-task-dev@example.test"], fixtureDir);
  run("git", ["config", "user.name", "Agent Task Dev Fixture"], fixtureDir);
  run("git", ["add", "."], fixtureDir);
  run("git", ["commit", "-m", "initial agent task dev fixture"], fixtureDir);
}

async function writeTaskScripts() {
  await writeFile(
    path.join(fixtureDir, ".deck-tasks", "long-task.mjs"),
    [
      'import { mkdir, writeFile } from "node:fs/promises";',
      'await mkdir(".deck-task-output", { recursive: true });',
      'console.log("long-task-start");',
      "for (let step = 1; step <= 8; step += 1) {",
      "  await new Promise((resolve) => setTimeout(resolve, 1000));",
      "  console.log(`long-task-progress ${step}/8`);",
      "}",
      'await writeFile(".deck-task-output/long-task.done", `${new Date().toISOString()}\\n`);',
      'console.log("long-task-done");',
      "",
    ].join("\n"),
  );
  await writeFile(path.join(fixtureDir, ".deck-tasks", "review-api.mjs"), reviewScript("api"));
  await writeFile(path.join(fixtureDir, ".deck-tasks", "review-ui.mjs"), reviewScript("ui"));
}

function reviewScript(name) {
  return [
    'import { mkdir, writeFile } from "node:fs/promises";',
    'await mkdir(".deck-task-output", { recursive: true });',
    `console.log("review-${name}-start");`,
    "await new Promise((resolve) => setTimeout(resolve, 4000));",
    `await writeFile(".deck-task-output/review-${name}.done", "${name}\\n");`,
    `console.log("review-${name}-done");`,
    "",
  ].join("\n");
}

async function writeAgentInstructions() {
  await writeFile(
    path.join(fixtureDir, "AGENTS.md"),
    [
      "# Agent task dev fixture",
      "",
      "This repository is a manual Copilot Deck development fixture.",
      "",
      'When the user asks exactly "Start the long task in the background", do not run the command yourself. Reply with this task request:',
      "",
      "```copilot-deck-task",
      JSON.stringify(
        {
          kind: "command",
          label: "dev long background task",
          command: "node .deck-tasks\\long-task.mjs",
          reason:
            "Manual dev fixture: verifies that an approved long task streams output without blocking the chat.",
        },
        null,
        2,
      ),
      "```",
      "",
      'When the user asks exactly "Run parallel review tasks", do not run the commands yourself. Reply with this task request:',
      "",
      "```copilot-deck-task",
      JSON.stringify(
        {
          tasks: [
            {
              kind: "review",
              label: "dev api review",
              command: "node .deck-tasks\\review-api.mjs",
              reason: "Manual dev fixture: review the API surface in parallel.",
            },
            {
              kind: "review",
              label: "dev ui review",
              command: "node .deck-tasks\\review-ui.mjs",
              reason: "Manual dev fixture: review the UI surface in parallel.",
            },
          ],
        },
        null,
        2,
      ),
      "```",
      "",
    ].join("\n"),
  );
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}
