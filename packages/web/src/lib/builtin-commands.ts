import { useUIStore } from "../stores/ui-store";
import { sendWs } from "./ws-client";

export type BuiltinCategory = "view" | "session" | "help" | "system";

export interface BuiltinCommand {
  name: string;
  description: string;
  category: BuiltinCategory;
  /**
   * Run the command. Receives the raw arg string (everything after `/name `).
   * Return true to consume (i.e. don't send the original text to the agent),
   * false to fall through.
   */
  run: (args: string, ctx: { sessionId: string | null }) => boolean | Promise<boolean>;
}

const ui = () => useUIStore.getState();

function notice(text: string, kind: "info" | "warn" = "info") {
  ui().setNotice({ id: Math.random().toString(36).slice(2, 8), kind, text, ts: Date.now() });
  // Auto-dismiss after 6 s.
  setTimeout(() => {
    const cur = useUIStore.getState().notice;
    if (cur && cur.text === text) ui().setNotice(null);
  }, 6000);
}

export const BUILTIN_COMMANDS: BuiltinCommand[] = [
  // ── view toggles ──
  {
    name: "help",
    description: "Show keyboard shortcuts and built-in commands",
    category: "help",
    run: () => {
      ui().setHelpOpen(true);
      return true;
    },
  },
  {
    name: "sidebar",
    description: "Toggle the left sidebar",
    category: "view",
    run: () => {
      ui().toggleSidebar();
      return true;
    },
  },
  {
    name: "inspector",
    description: "Toggle the right inspector",
    category: "view",
    run: () => {
      ui().toggleInspector();
      return true;
    },
  },
  {
    name: "trace",
    description: "Toggle the JSON-RPC trace drawer",
    category: "view",
    run: () => {
      ui().setTraceDrawerOpen(!ui().traceDrawerOpen);
      return true;
    },
  },
  {
    name: "plan",
    description: "Open the Plan tab in the inspector",
    category: "view",
    run: () => {
      ui().setInspectorTab("plan");
      return true;
    },
  },
  {
    name: "tools",
    description: "Open the Tools tab in the inspector",
    category: "view",
    run: () => {
      ui().setInspectorTab("tools");
      return true;
    },
  },
  {
    name: "files",
    description: "Open the Files tab in the inspector",
    category: "view",
    run: () => {
      ui().setInspectorTab("files");
      return true;
    },
  },
  {
    name: "terminal",
    description: "Open the Terminal tab in the inspector",
    category: "view",
    run: () => {
      ui().setInspectorTab("terminal");
      return true;
    },
  },
  {
    name: "logs",
    description: "Open the Logs tab in the inspector",
    category: "view",
    run: () => {
      ui().setInspectorTab("logs");
      return true;
    },
  },
  {
    name: "config",
    description: "Open the Config tab in the inspector",
    category: "view",
    run: () => {
      ui().setInspectorTab("config");
      return true;
    },
  },

  // ── session ops ──
  {
    name: "clear",
    description: "Clear visible messages in the current session (does not delete history)",
    category: "session",
    run: (_args, ctx) => {
      if (!ctx.sessionId) {
        notice("No active session.", "warn");
        return true;
      }
      ui().clearSessionMessages(ctx.sessionId);
      notice("Cleared local view. History is preserved in storage.");
      return true;
    },
  },
  {
    name: "cancel",
    description: "Cancel the in-flight prompt in the current session",
    category: "session",
    run: (_args, ctx) => {
      if (!ctx.sessionId) {
        notice("No active session.", "warn");
        return true;
      }
      sendWs({ type: "cancel", sessionId: ctx.sessionId });
      return true;
    },
  },
  {
    name: "reattach",
    description: "Reattach a detached session by reloading it in the CLI (ACP loadSession)",
    category: "session",
    run: (_args, ctx) => {
      if (!ctx.sessionId) {
        notice("No active session.", "warn");
        return true;
      }
      const sess = useUIStore.getState().sessions[ctx.sessionId];
      if (!sess?.detached) {
        notice("Session is already attached.", "info");
        return true;
      }
      sendWs({ type: "reattach_session", sessionId: ctx.sessionId });
      notice("Reattaching…");
      return true;
    },
  },
  {
    name: "delete",
    description: "Delete the current session (with confirmation)",
    category: "session",
    run: (_args, ctx) => {
      if (!ctx.sessionId) {
        notice("No active session.", "warn");
        return true;
      }
      if (!confirm("Delete this session and its history?")) return true;
      sendWs({ type: "delete_session", sessionId: ctx.sessionId });
      ui().removeSession(ctx.sessionId);
      return true;
    },
  },
  {
    name: "copy",
    description: "Copy the current session id to the clipboard",
    category: "session",
    run: (_args, ctx) => {
      if (!ctx.sessionId) {
        notice("No active session.", "warn");
        return true;
      }
      void navigator.clipboard.writeText(ctx.sessionId);
      notice(`Copied ${ctx.sessionId.slice(0, 8)}…`);
      return true;
    },
  },
  {
    name: "new",
    description: "Focus the cwd input to start a new session",
    category: "session",
    run: () => {
      ui().setActiveSession(null);
      requestAnimationFrame(() => {
        const el = document.querySelector<HTMLInputElement>('input[placeholder="cwd path…"]');
        el?.focus();
        el?.select();
      });
      return true;
    },
  },
  {
    name: "switch",
    description: "List sessions and pick one with arrow keys (opens sidebar)",
    category: "session",
    run: () => {
      if (ui().sidebarCollapsed) ui().toggleSidebar();
      notice("Pick a session in the sidebar.");
      return true;
    },
  },

  // ── system / CLI-built-in shims ──
  // These are commands that the underlying CLI handles interactively
  // (e.g. /models opens a TTY picker). They can't round-trip through ACP
  // as plain text, so we intercept them and show a helpful explainer
  // instead of letting the agent reply "I can't run that".
  {
    name: "models",
    description: "Switch the AI model for the current session's cwd",
    category: "session",
    run: () => {
      ui().setModelPickerOpen(true);
      return true;
    },
  },
  {
    name: "exit",
    description: "(CLI built-in) Exit the CLI — close this tab instead",
    category: "system",
    run: () => {
      notice("/exit is a CLI built-in. Close the browser tab to disconnect.", "warn");
      return true;
    },
  },
  {
    name: "login",
    description: "(CLI built-in) Re-auth GitHub — handled by the CLI",
    category: "system",
    run: () => {
      notice("/login is a CLI built-in. Run `copilot` in a terminal to re-authenticate.", "warn");
      return true;
    },
  },
  {
    name: "logout",
    description: "(CLI built-in) Sign out — handled by the CLI",
    category: "system",
    run: () => {
      notice("/logout is a CLI built-in. Run it in a terminal.", "warn");
      return true;
    },
  },
];

export const BUILTIN_BY_NAME = new Map(BUILTIN_COMMANDS.map((c) => [c.name, c] as const));

/**
 * Parse `/name args` from arbitrary input.
 * Returns null if the input is not a single leading slash command.
 */
export function parseSlash(input: string): { name: string; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const m = /^\/([\w-]+)\s*(.*)$/s.exec(trimmed);
  if (!m) return null;
  return { name: m[1], args: m[2] };
}
