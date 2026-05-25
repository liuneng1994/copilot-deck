import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

export interface CopilotAgentOptions {
  executable?: string;
  /** Extra args passed to copilot besides `--acp --stdio`. */
  extraArgs?: string[];
  onStderr?: (chunk: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

function readPrefixArgs(): string[] {
  const raw = process.env.COPILOT_CLI_PREFIX_ARGS;
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item): item is string => typeof item === "string")) {
    throw new Error("COPILOT_CLI_PREFIX_ARGS must be a JSON string array");
  }
  return parsed;
}

/**
 * One CopilotAgent wraps one `copilot --acp --stdio` child process and the
 * matching ACP ClientSideConnection. It can host multiple ACP sessions.
 */
export class CopilotAgent {
  readonly connection: acp.ClientSideConnection;
  readonly process: ChildProcessWithoutNullStreams;
  private initialized = false;
  private initPromise: Promise<acp.InitializeResponse> | null = null;

  constructor(client: acp.Client, opts: CopilotAgentOptions = {}) {
    const executable = opts.executable ?? process.env.COPILOT_CLI_PATH ?? "copilot";
    const args = [...readPrefixArgs(), "--acp", "--stdio", ...(opts.extraArgs ?? [])];

    this.process = spawn(executable, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        // Encourage child tools (git, ls, grep, npm, pytest, ...) that
        // Copilot CLI spawns to emit ANSI color codes even though their
        // stdout is a pipe, not a TTY. Without this everything in the
        // terminal block renders monochrome.
        FORCE_COLOR: process.env.FORCE_COLOR ?? "1",
        CLICOLOR: process.env.CLICOLOR ?? "1",
        CLICOLOR_FORCE: process.env.CLICOLOR_FORCE ?? "1",
      },
    }) as ChildProcessWithoutNullStreams;

    this.process.stderr.setEncoding("utf8");
    this.process.stderr.on("data", (chunk: string) => opts.onStderr?.(chunk));
    this.process.on("exit", (code, signal) => opts.onExit?.(code, signal));

    const output = Writable.toWeb(this.process.stdin) as WritableStream<Uint8Array>;
    const input = Readable.toWeb(this.process.stdout) as ReadableStream<Uint8Array>;
    const stream = acp.ndJsonStream(output, input);

    this.connection = new acp.ClientSideConnection(() => client, stream);
  }

  initialize(): Promise<acp.InitializeResponse> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.connection
      .initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          // ACP terminal extension: deck owns shell child processes so that
          // long-running daemon commands (npm run dev, vite, …) don't hang
          // the prompt turn. The user can "Move to background" from the UI.
          terminal: true,
        },
      })
      .then((res) => {
        this.initialized = true;
        this.initResponse = res;
        return res;
      });
    return this.initPromise;
  }

  /** Resolved initialize response, available after `initialize()` settles. */
  initResponse: acp.InitializeResponse | null = null;

  /** True if the agent advertises ACP `loadSession` capability. */
  supportsLoadSession(): boolean {
    return this.initResponse?.agentCapabilities?.loadSession === true;
  }

  /** True if the agent advertises ContentBlock::Image support in prompts. */
  supportsImagePrompts(): boolean {
    return this.initResponse?.agentCapabilities?.promptCapabilities?.image === true;
  }

  isInitialized() {
    return this.initialized;
  }

  async shutdown() {
    try {
      this.process.stdin.end();
    } catch {
      // ignore
    }
    this.process.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => resolve(), 2000);
      this.process.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
}
