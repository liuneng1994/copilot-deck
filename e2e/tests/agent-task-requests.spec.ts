import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { type Page, expect, test } from "@playwright/test";

const repoRoot = process.cwd();
const requireFromServer = createRequire(path.join(repoRoot, "packages", "server", "package.json"));
const workRoot = path.join(
  repoRoot,
  ".e2e-work",
  `agent-task-fixture-${process.pid}-${Date.now()}`,
);
const fixtureDir = path.join(workRoot, "repo");
const fakeCopilotPath = path.join(workRoot, "fake-copilot.mjs");
const dbPath = path.join(workRoot, "agent-task.sqlite");

let serverUrl = "";
let appUrl = "";
let server: ChildProcessWithoutNullStreams | undefined;
let web: ChildProcessWithoutNullStreams | undefined;

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

test.beforeAll(async () => {
  await rm(workRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(
    () => undefined,
  );
  await mkdir(path.join(fixtureDir, ".deck-tasks"), { recursive: true });
  await mkdir(path.join(fixtureDir, "src"), { recursive: true });
  await writeFile(path.join(fixtureDir, "src", "app.js"), "export const value = 1;\n");
  await writeTaskScripts();
  run("git", ["init"], fixtureDir);
  run("git", ["config", "user.email", "agent-task@example.test"], fixtureDir);
  run("git", ["config", "user.name", "Agent Task Test"], fixtureDir);
  run("git", ["add", "."], fixtureDir);
  run("git", ["commit", "-m", "initial agent task fixture"], fixtureDir);
  await writeFakeCopilot();

  const serverPort = await getFreePort();
  const webPort = await getFreePort();
  serverUrl = `http://127.0.0.1:${serverPort}`;
  appUrl = `http://127.0.0.1:${webPort}`;
  server = start("pnpm", ["--dir", "packages/server", "exec", "tsx", "src/main.ts"], {
    AGENT_VIEW_DB: dbPath,
    COPILOT_CLI_PATH: process.execPath,
    COPILOT_CLI_PREFIX_ARGS: JSON.stringify([fakeCopilotPath]),
    COPILOT_DECK_DISABLE_UPDATE_CHECK: "1",
    PORT: String(serverPort),
  });
  await waitForHttp(`${serverUrl}/api/health`);

  web = start("pnpm", ["--dir", "packages/web", "exec", "vite", "--host", "127.0.0.1"], {
    AGENT_VIEW_SERVER_PORT: String(serverPort),
    AGENT_VIEW_WEB_PORT: String(webPort),
  });
  await waitForHttp(appUrl);
});

test.afterAll(async () => {
  await stop(web);
  await stop(server);
  if (process.platform === "win32") return;
  await rm(workRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(
    () => undefined,
  );
});

test("model-requested long task runs in background after approval", async ({ page }) => {
  await page.goto(appUrl);
  await createSession(page, fixtureDir);
  await page.reload();

  await page.getByLabel("Message composer").fill("Start the long task in the background");
  await page.getByRole("button", { name: "Send" }).click();

  const dialog = page.getByRole("dialog").filter({ hasText: "Background task requested" });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText("node .deck-tasks/long-task.mjs")).toBeVisible();
  await page.getByRole("button", { name: "Allow" }).click();

  await page.getByRole("tab", { name: "Tasks" }).click();
  const taskCard = page
    .locator('[data-bg-task-origin="agent-request"]')
    .filter({ hasText: "long fixture task" });
  await expect(taskCard).toBeVisible({ timeout: 10_000 });
  await expect(taskCard.getByText("agent task")).toBeVisible();
  await expect(taskCard.getByText("long-task-start")).toBeVisible({ timeout: 10_000 });

  await page.getByRole("tab", { name: "Files" }).click();
  await page.getByRole("button", { name: "code" }).click();
  await expect(page.getByText("app.js").first()).toBeVisible({ timeout: 10_000 });

  await expect
    .poll(() => readFile(path.join(fixtureDir, "long-task.done"), "utf8").catch(() => ""), {
      timeout: 15_000,
    })
    .toContain("done");
  await page.getByRole("tab", { name: "Tasks" }).click();
  await expect(taskCard.getByText("long-task-done")).toBeVisible({ timeout: 10_000 });
});

test("model can request parallel review tasks", async ({ page }) => {
  await page.goto(appUrl);
  await createSession(page, fixtureDir);
  await page.reload();

  await page.getByLabel("Message composer").fill("Run parallel review tasks");
  await page.getByRole("button", { name: "Send" }).click();

  const dialog = page.getByRole("dialog").filter({ hasText: "Background task requested" });
  await expect(dialog.getByText("review api surface")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(dialog.getByText("review ui surface")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Allow" }).click();

  await page.getByRole("tab", { name: "Tasks" }).click();
  const apiReviewTask = page
    .locator('[data-bg-task-origin="agent-request"]')
    .filter({ hasText: "review api" });
  const uiReviewTask = page
    .locator('[data-bg-task-origin="agent-request"]')
    .filter({ hasText: "review ui" });
  await expect(apiReviewTask).toBeVisible({ timeout: 10_000 });
  await expect(uiReviewTask).toBeVisible({ timeout: 10_000 });
  await expect(apiReviewTask.getByText("review-api-start")).toBeVisible({ timeout: 10_000 });
  await expect(uiReviewTask.getByText("review-ui-start")).toBeVisible({ timeout: 10_000 });

  await expect
    .poll(() => readFile(path.join(fixtureDir, "review-api.done"), "utf8").catch(() => ""), {
      timeout: 15_000,
    })
    .toContain("api");
  await expect
    .poll(() => readFile(path.join(fixtureDir, "review-ui.done"), "utf8").catch(() => ""), {
      timeout: 15_000,
    })
    .toContain("ui");
});

async function writeTaskScripts(): Promise<void> {
  const longTask = [
    'import { writeFile } from "node:fs/promises";',
    'console.log("long-task-start");',
    "await new Promise((resolve) => setTimeout(resolve, 1800));",
    'await writeFile("long-task.done", "done\\n", "utf8");',
    'console.log("long-task-done");',
    "",
  ].join("\n");
  const reviewApi = [
    'import { writeFile } from "node:fs/promises";',
    'console.log("review-api-start");',
    "await new Promise((resolve) => setTimeout(resolve, 1400));",
    'await writeFile("review-api.done", "api\\n", "utf8");',
    'console.log("review-api-done");',
    "",
  ].join("\n");
  const reviewUi = [
    'import { writeFile } from "node:fs/promises";',
    'console.log("review-ui-start");',
    "await new Promise((resolve) => setTimeout(resolve, 1400));",
    'await writeFile("review-ui.done", "ui\\n", "utf8");',
    'console.log("review-ui-done");',
    "",
  ].join("\n");
  await writeFile(path.join(fixtureDir, ".deck-tasks", "long-task.mjs"), longTask);
  await writeFile(path.join(fixtureDir, ".deck-tasks", "review-api.mjs"), reviewApi);
  await writeFile(path.join(fixtureDir, ".deck-tasks", "review-ui.mjs"), reviewUi);
}

async function writeFakeCopilot(): Promise<void> {
  const sdkUrl = pathToFileURL(requireFromServer.resolve("@agentclientprotocol/sdk")).href;
  const longResponse = [
    "I will ask Deck to run this as a background task after approval.",
    "```copilot-deck-task",
    JSON.stringify(
      {
        kind: "command",
        label: "long fixture task",
        command: "node .deck-tasks/long-task.mjs",
        reason: "Validates that a long-running model-requested task does not block review.",
      },
      null,
      2,
    ),
    "```",
  ].join("\n");
  const parallelResponse = [
    "I will ask Deck to fan out two independent reviews.",
    "```copilot-deck-task",
    JSON.stringify(
      {
        tasks: [
          {
            kind: "review",
            label: "review api",
            command: "node .deck-tasks/review-api.mjs",
            reason: "review api surface",
          },
          {
            kind: "review",
            label: "review ui",
            command: "node .deck-tasks/review-ui.mjs",
            reason: "review ui surface",
          },
        ],
      },
      null,
      2,
    ),
    "```",
  ].join("\n");
  const script = `#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from "${sdkUrl}";

let connection;
const output = Writable.toWeb(process.stdout);
const input = Readable.toWeb(process.stdin);
const stream = ndJsonStream(output, input);
const modes = { currentModeId: "agent", availableModes: [{ id: "agent", name: "Agent" }] };

const agent = {
  async initialize() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true },
      agentInfo: { name: "agent-task-fake-copilot", version: "0.0.0" },
      authMethods: [],
    };
  },
  async newSession(params) {
    return { sessionId: "agent-task-" + randomUUID(), modes };
  },
  async loadSession(params) {
    return { sessionId: params.sessionId, modes };
  },
  async prompt(params) {
    const promptText = (params.prompt ?? [])
      .map((block) => block?.type === "text" ? block.text ?? "" : "")
      .join("\\n");
    await connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: promptText.toLowerCase().includes("parallel")
            ? ${JSON.stringify(parallelResponse)}
            : ${JSON.stringify(longResponse)},
        },
      },
    });
    return { stopReason: "end_turn" };
  },
  async cancel() {},
  async setSessionMode() {},
  async authenticate() {},
};
connection = new AgentSideConnection(() => agent, stream);
await connection.closed;
`;
  await writeFile(fakeCopilotPath, script);
  await chmod(fakeCopilotPath, 0o755);
}

async function createSession(page: Page, cwd: string): Promise<string> {
  return page.evaluate(
    ({ cwd }) =>
      new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(`ws://${location.host}/ws`);
        const timer = window.setTimeout(() => {
          ws.close();
          reject(new Error("Timed out creating agent-task session"));
        }, 10_000);
        ws.addEventListener("open", () => {
          ws.send(JSON.stringify({ type: "create_session", cwd }));
        });
        ws.addEventListener("message", (event) => {
          const message = JSON.parse(String(event.data));
          if (message.type === "session_created") {
            window.clearTimeout(timer);
            ws.close();
            resolve(message.sessionId);
          } else if (message.type === "error") {
            window.clearTimeout(timer);
            ws.close();
            reject(new Error(message.message));
          }
        });
        ws.addEventListener("error", () => {
          window.clearTimeout(timer);
          reject(new Error("Agent-task session websocket failed"));
        });
      }),
    { cwd },
  );
}

function start(
  command: string,
  args: string[],
  env: Record<string, string>,
): ChildProcessWithoutNullStreams {
  const globalPnpm = process.env.APPDATA
    ? path.join(process.env.APPDATA, "npm", "node_modules", "pnpm", "bin", "pnpm.cjs")
    : "";
  const pnpmExecPath =
    process.env.npm_execpath ?? (globalPnpm && existsSync(globalPnpm) ? globalPnpm : undefined);
  const actualCommand = command === "pnpm" && pnpmExecPath ? process.execPath : command;
  const actualArgs = command === "pnpm" && pnpmExecPath ? [pnpmExecPath, ...args] : args;
  const child = spawn(actualCommand, actualArgs, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[${command}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${command}] ${chunk}`));
  return child;
}

async function stop(child: ChildProcessWithoutNullStreams | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    const script = `
      function Stop-Tree([int] $Pid) {
        Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $Pid } | ForEach-Object { Stop-Tree ([int] $_.ProcessId) }
        try { Stop-Process -Id $Pid -Force -ErrorAction SilentlyContinue } catch {}
      }
      Stop-Tree ${child.pid}
    `;
    spawnSync("pwsh", ["-NoProfile", "-Command", script], { encoding: "utf8" });
    return;
  }
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address) resolve(address.port);
        else reject(new Error("Unable to allocate a port"));
      });
    });
  });
}

async function waitForHttp(url: string): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          const response = await fetch(url);
          return response.ok;
        } catch {
          return false;
        }
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}
