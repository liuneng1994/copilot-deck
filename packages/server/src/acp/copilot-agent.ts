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
    const args = ["--acp", "--stdio", ...(opts.extraArgs ?? [])];

    this.process = spawn(executable, args, {
      stdio: ["pipe", "pipe", "pipe"],
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
          terminal: false,
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
