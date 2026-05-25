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
  `project-workbench-fixture-${process.pid}-${Date.now()}`,
);
const fixtureDir = path.join(workRoot, "repo");
const fakeCopilotPath = path.join(workRoot, "fake-copilot.mjs");
const fakeCopilotCmdPath = path.join(workRoot, "fake-copilot.cmd");
const dbPath = path.join(workRoot, "project-workbench.sqlite");
const orderServiceRel = path.join(
  "src",
  "main",
  "java",
  "com",
  "acme",
  "order",
  "OrderService.java",
);
const orderServiceTestRel = path.join(
  "src",
  "test",
  "java",
  "com",
  "acme",
  "order",
  "OrderServiceTest.java",
);

let serverUrl = "";
let appUrl = "";
let server: ChildProcessWithoutNullStreams | undefined;
let web: ChildProcessWithoutNullStreams | undefined;

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

test.beforeAll(async () => {
  await rm(workRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(
    (error) => {
      console.warn(`Could not pre-clean workbench fixture: ${error?.message ?? error}`);
    },
  );
  await mkdir(path.dirname(path.join(fixtureDir, orderServiceRel)), { recursive: true });
  await mkdir(path.dirname(path.join(fixtureDir, orderServiceTestRel)), { recursive: true });
  await writeFile(path.join(fixtureDir, "build.gradle"), "plugins { id 'java' }\n");
  await writeFile(
    path.join(fixtureDir, orderServiceRel),
    [
      "package com.acme.order;",
      "",
      "public class OrderService {",
      "  public Order createOrder(CreateOrderRequest request) {",
      "    return new Order(request.id());",
      "  }",
      "}",
      "",
      "record CreateOrderRequest(String id) {}",
      "record Order(String id) {}",
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(fixtureDir, orderServiceTestRel),
    [
      "package com.acme.order;",
      "",
      "public class OrderServiceTest {",
      "  public void createOrder_success() {",
      '    new OrderService().createOrder(new CreateOrderRequest("o-1"));',
      "  }",
      "}",
      "",
    ].join("\n"),
  );
  run("git", ["init"], fixtureDir);
  run("git", ["config", "user.email", "workbench@example.test"], fixtureDir);
  run("git", ["config", "user.name", "Workbench Test"], fixtureDir);
  run("git", ["add", "."], fixtureDir);
  run("git", ["commit", "-m", "initial workbench fixture"], fixtureDir);
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
  await new Promise((resolve) => setTimeout(resolve, 500));
  await rm(workRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(
    (error) => {
      console.warn(`Could not clean workbench fixture: ${error?.message ?? error}`);
    },
  );
});

test("symbol context workset drives prompt and touched-file review", async ({ page }) => {
  await page.goto(appUrl);
  await createSession(page, fixtureDir);
  await page.reload();

  await page.getByRole("tab", { name: "Files" }).click();
  await page.getByRole("button", { name: "symbols" }).click();
  await page.getByLabel("Search file paths").fill("createOrder");
  await expect(page.getByText("createOrder").first()).toBeVisible();
  await page.getByTitle("Add symbol to context").first().click();

  await page.getByRole("button", { name: "tests", exact: true }).click();
  await expect(page.getByText(/OrderServiceTest\.java/)).toBeVisible();
  await page.getByTitle("Add test to context").first().click();
  await page.getByTitle("Add validation command to context").first().click();

  await expect(page.getByText("method createOrder").first()).toBeVisible();
  await expect(page.getByText(/OrderServiceTest\.java/).first()).toBeVisible();

  await page.getByLabel("Message composer").fill("Fix create order timeout handling");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText(/saw workset.*createOrder.*OrderServiceTest/i)).toBeVisible({
    timeout: 15_000,
  });
  await expect
    .poll(() => readFile(path.join(fixtureDir, orderServiceRel), "utf8"), { timeout: 10_000 })
    .toContain("timeout-safe path");

  await page.getByRole("button", { name: "files" }).click();
  await expect(page.locator("button").filter({ hasText: "OrderService.java" }).last()).toBeVisible({
    timeout: 10_000,
  });
});

async function createSession(page: Page, cwd: string): Promise<string> {
  return page.evaluate(
    ({ cwd }) =>
      new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(`ws://${location.host}/ws`);
        const timer = window.setTimeout(() => {
          ws.close();
          reject(new Error("Timed out creating workbench session"));
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
          reject(new Error("Workbench session websocket failed"));
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

async function writeFakeCopilot(): Promise<void> {
  const sdkUrl = pathToFileURL(requireFromServer.resolve("@agentclientprotocol/sdk")).href;
  const servicePath = orderServiceRel.replace(/\\/g, "/");
  const script = `#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from "${sdkUrl}";

let connection;
const output = Writable.toWeb(process.stdout);
const input = Readable.toWeb(process.stdin);
const stream = ndJsonStream(output, input);
const cwdBySession = new Map();
const modes = { currentModeId: "agent", availableModes: [{ id: "agent", name: "Agent" }] };

const agent = {
  async initialize() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true },
      agentInfo: { name: "project-workbench-fake-copilot", version: "0.0.0" },
      authMethods: [],
    };
  },
  async newSession(params) {
    const sessionId = "workbench-" + randomUUID();
    cwdBySession.set(sessionId, params.cwd);
    return { sessionId, modes };
  },
  async loadSession(params) {
    cwdBySession.set(params.sessionId, params.cwd);
    return { sessionId: params.sessionId, modes };
  },
  async prompt(params) {
    const promptText = (params.prompt ?? [])
      .map((block) => block?.type === "text" ? block.text ?? "" : "")
      .join("\\n");
    const cwd = cwdBySession.get(params.sessionId);
    const abs = path.join(cwd, ${JSON.stringify(servicePath)});
    const oldText = await readFile(abs, "utf8");
    const newText = oldText.replace("return new Order(request.id());", "// timeout-safe path\\n    return new Order(request.id());");
    await writeFile(abs, newText, "utf8");
    await connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: promptText.includes("OrderServiceTest")
            ? "saw workset: createOrder and OrderServiceTest; applied timeout-safe path"
            : "missing workset context",
        },
      },
    });
    await connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "edit-" + params.sessionId,
        kind: "edit",
        title: "Edit OrderService.java",
        status: "completed",
        rawInput: { path: ${JSON.stringify(servicePath)}, old_content: oldText, new_content: newText },
        content: [{ type: "diff", path: ${JSON.stringify(servicePath)}, oldText, newText }],
        locations: [{ path: ${JSON.stringify(servicePath)}, line: 5 }],
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
  await writeFile(
    fakeCopilotCmdPath,
    `@echo off\r\nnode "%~dp0${path.basename(fakeCopilotPath)}" %*\r\n`,
  );
}
