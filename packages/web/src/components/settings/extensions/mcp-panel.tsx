import type { ExtensionScope, McpServer, McpTransport } from "@agent-view/shared";
import { Lock, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { cn } from "../../../lib/cn";
import { useUIStore } from "../../../stores/ui-store";
import { Button } from "../../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";

const SCOPES = ["user", "workspace", "all"] as const;
type PanelScope = (typeof SCOPES)[number];
type WritableScope = Extract<ExtensionScope, "user" | "workspace">;

type ApiListResponse = { servers?: McpServer[]; error?: string };
type ApiServerResponse = { server?: McpServer; error?: string };

type KeyValueRow = { id: string; key: string; value: string };

interface FormState {
  name: string;
  transport: McpTransport;
  command: string;
  argsText: string;
  url: string;
  env: KeyValueRow[];
  headers: KeyValueRow[];
  tools: string;
  timeoutMs: string;
}

interface EditingState {
  server: McpServer;
}

const emptyRow = (): KeyValueRow => ({ id: crypto.randomUUID(), key: "", value: "" });

const initialForm = (server?: McpServer): FormState => ({
  name: server?.name ?? "",
  transport: server?.transport ?? "stdio",
  command: server?.command ?? "",
  argsText: (server?.args ?? []).join("\n"),
  url: server?.url ?? "",
  env: rowsFromRecord(server?.env),
  headers: rowsFromRecord(server?.headers),
  tools: server?.tools ?? "*",
  timeoutMs: server?.timeoutMs === undefined ? "" : String(server.timeoutMs),
});

function rowsFromRecord(record: Record<string, string> | undefined): KeyValueRow[] {
  const rows = Object.entries(record ?? {}).map(([key, value]) => ({
    id: crypto.randomUUID(),
    key,
    value,
  }));
  return rows.length > 0 ? rows : [emptyRow()];
}

function recordFromRows(rows: KeyValueRow[]): Record<string, string> | undefined {
  const entries = rows
    .map((row) => [row.key.trim(), row.value] as const)
    .filter(([key]) => key.length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function mcpUrl(scope: PanelScope | WritableScope, cwd?: string): string {
  const params = new URLSearchParams({ scope });
  if (cwd) params.set("cwd", cwd);
  return `/api/extensions/mcp?${params.toString()}`;
}

function mcpServerUrl(name: string, scope: PanelScope | WritableScope, cwd?: string): string {
  const params = new URLSearchParams({ scope });
  if (cwd) params.set("cwd", cwd);
  return `/api/extensions/mcp/${encodeURIComponent(name)}?${params.toString()}`;
}

export function McpServersPanel() {
  const sessions = useUIStore((s) => s.sessions);
  const cwdOptions = useMemo(() => {
    const sessionList = Object.values(sessions);
    const liveCwds = sessionList.filter((session) => !session.detached).map((session) => session.cwd);
    const cwds = liveCwds.length > 0 ? liveCwds : sessionList.map((session) => session.cwd);
    return Array.from(new Set(cwds)).sort();
  }, [sessions]);
  const [scope, setScope] = useState<PanelScope>("user");
  const [workspaceCwd, setWorkspaceCwd] = useState("");
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EditingState | null>(null);

  useEffect(() => {
    if (!workspaceCwd && cwdOptions.length > 0) setWorkspaceCwd(cwdOptions[0]);
    if (workspaceCwd && !cwdOptions.includes(workspaceCwd)) setWorkspaceCwd(cwdOptions[0] ?? "");
    if (scope === "workspace" && cwdOptions.length === 0) setScope("user");
  }, [cwdOptions, scope, workspaceCwd]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      if (scope === "workspace" && !workspaceCwd) {
        setServers([]);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          mcpUrl(scope, scope === "workspace" ? workspaceCwd : undefined),
          {
            signal: controller.signal,
          },
        );
        const data = (await response.json()) as ApiListResponse;
        if (!response.ok) throw new Error(data.error ?? "Failed to load MCP servers");
        setServers(data.servers ?? []);
      } catch (err) {
        if (!controller.signal.aborted) setError(describeError(err));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [scope, workspaceCwd]);

  const refresh = async () => {
    if (scope === "workspace" && !workspaceCwd) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(mcpUrl(scope, scope === "workspace" ? workspaceCwd : undefined));
      const data = (await response.json()) as ApiListResponse;
      if (!response.ok) throw new Error(data.error ?? "Failed to load MCP servers");
      setServers(data.servers ?? []);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  };

  const writableScope: WritableScope = scope === "workspace" ? "workspace" : "user";
  const canAdd = scope !== "all" && (scope !== "workspace" || !!workspaceCwd);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedScope
              scope={scope}
              setScope={setScope}
              workspaceDisabled={cwdOptions.length === 0}
            />
            {scope === "workspace" && cwdOptions.length > 0 && (
              <select
                value={workspaceCwd}
                onChange={(event) => setWorkspaceCwd(event.target.value)}
                className="max-w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                aria-label="Workspace cwd"
              >
                {cwdOptions.map((cwd) => (
                  <option key={cwd} value={cwd}>
                    {cwd}
                  </option>
                ))}
              </select>
            )}
          </div>
          {cwdOptions.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Open a session to manage workspace MCP servers.
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCcw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!canAdd}
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Add MCP server
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {loading && servers.length === 0 ? (
          <div className="rounded-lg border border-border bg-background/60 p-6 text-center text-sm text-muted-foreground">
            Loading MCP servers…
          </div>
        ) : servers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-background/60 p-6 text-center text-sm text-muted-foreground">
            No MCP servers configured in this scope.
          </div>
        ) : (
          servers.map((server) => (
            <McpServerCard
              key={`${server.scope}:${server.cwd ?? ""}:${server.name}`}
              server={server}
              onEdit={() => {
                setEditing({ server });
                setModalOpen(true);
              }}
              onDelete={async () => {
                if (server.scope !== "user" && server.scope !== "workspace") return;
                if (!confirm(`Delete MCP server '${server.name}'?`)) return;
                try {
                  const response = await fetch(
                    mcpServerUrl(
                      server.name,
                      server.scope,
                      server.scope === "workspace" ? server.cwd : undefined,
                    ),
                    { method: "DELETE" },
                  );
                  const data = (await response.json()) as { error?: string };
                  if (!response.ok) throw new Error(data.error ?? "Failed to delete MCP server");
                  await refresh();
                } catch (err) {
                  setError(describeError(err));
                }
              }}
            />
          ))
        )}
      </div>

      <McpFormModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        mode={editing ? "edit" : "add"}
        initialServer={editing?.server}
        scope={editing?.server.scope === "workspace" ? "workspace" : writableScope}
        cwd={editing?.server.cwd ?? (writableScope === "workspace" ? workspaceCwd : undefined)}
        onSaved={async () => {
          setModalOpen(false);
          setEditing(null);
          await refresh();
        }}
      />
    </div>
  );
}

function SegmentedScope({
  scope,
  setScope,
  workspaceDisabled,
}: {
  scope: PanelScope;
  setScope: (scope: PanelScope) => void;
  workspaceDisabled: boolean;
}) {
  return (
    <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-xs">
      {SCOPES.map((item) => (
        <button
          key={item}
          type="button"
          disabled={item === "workspace" && workspaceDisabled}
          onClick={() => setScope(item)}
          className={cn(
            "rounded px-2.5 py-1 capitalize transition-colors",
            scope === item
              ? "bg-primary/20 text-foreground"
              : "text-muted-foreground hover:text-foreground",
            item === "workspace" && workspaceDisabled && "cursor-not-allowed opacity-40",
          )}
        >
          {item === "all" ? "All" : item}
        </button>
      ))}
    </div>
  );
}

function McpServerCard({
  server,
  onEdit,
  onDelete,
}: {
  server: McpServer;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const readOnly = server.readOnly || server.scope === "plugin";
  const envCount = Object.keys(server.env ?? {}).length;
  const headerCount = Object.keys(server.headers ?? {}).length;
  const tools = server.tools ?? "*";
  return (
    <article className="rounded-lg border border-border bg-panel p-3 shadow-sm">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-sm text-foreground">{server.name}</h3>
        <Badge>{server.transport}</Badge>
        <Badge
          tone={
            server.scope === "plugin" ? "amber" : server.scope === "workspace" ? "sky" : "neutral"
          }
        >
          {server.scope}
        </Badge>
        {readOnly && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-300">
            <Lock className="h-3 w-3" /> read-only
          </span>
        )}
        {server.pluginName && (
          <span className="text-[10px] text-muted-foreground">from {server.pluginName}</span>
        )}
      </header>
      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
        {server.transport === "stdio" ? (
          <div className="break-all font-mono text-foreground/90">
            {server.command || "—"}
            {server.args?.length ? ` ${server.args.join(" ")}` : ""}
          </div>
        ) : (
          <div className="break-all font-mono text-foreground/90">{server.url || "—"}</div>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>env {envCount}</span>
          <span>headers {headerCount}</span>
          <span>tools {tools === "" ? '""' : tools}</span>
          <span>
            timeout {server.timeoutMs === undefined ? "default" : `${server.timeoutMs}ms`}
          </span>
        </div>
        {server.cwd && <div className="truncate">cwd {server.cwd}</div>}
      </div>
      <footer className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" disabled={readOnly} onClick={onEdit}>
          Edit
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={readOnly}
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </Button>
      </footer>
    </article>
  );
}

function Badge({
  children,
  tone = "neutral",
}: { children: string; tone?: "neutral" | "sky" | "amber" }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider",
        tone === "sky"
          ? "border-sky-500/30 bg-sky-500/10 text-sky-300"
          : tone === "amber"
            ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
            : "border-border bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function McpFormModal({
  open,
  onOpenChange,
  mode,
  initialServer,
  scope,
  cwd,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "add" | "edit";
  initialServer?: McpServer;
  scope: WritableScope;
  cwd?: string;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(() => initialForm(initialServer));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initialForm(initialServer));
      setError(null);
      setSubmitting(false);
    }
  }, [open, initialServer]);

  const patchForm = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));

  const validate = (): string | undefined => {
    if (!/^[a-z0-9-]+$/.test(form.name.trim())) return "Name must match ^[a-z0-9-]+$.";
    if (form.transport === "stdio" && !form.command.trim()) return "Command is required for stdio.";
    if (form.transport !== "stdio") {
      if (!form.url.trim()) return "URL is required for http/sse.";
      try {
        new URL(form.url.trim());
      } catch {
        return "URL must be valid.";
      }
    }
    if (
      form.timeoutMs.trim() &&
      (!Number.isFinite(Number(form.timeoutMs)) || Number(form.timeoutMs) < 0)
    ) {
      return "Timeout must be a non-negative number.";
    }
    if (scope === "workspace" && !cwd) return "Workspace cwd is required.";
    return undefined;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError(null);
    const body: McpServer = {
      name: form.name.trim(),
      transport: form.transport,
      scope,
      tools: form.tools,
      ...(form.transport === "stdio"
        ? {
            command: form.command.trim(),
            args: form.argsText
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean),
          }
        : { url: form.url.trim() }),
      ...(recordFromRows(form.env) ? { env: recordFromRows(form.env) } : {}),
      ...(form.transport !== "stdio" && recordFromRows(form.headers)
        ? { headers: recordFromRows(form.headers) }
        : {}),
      ...(form.timeoutMs.trim() ? { timeoutMs: Number(form.timeoutMs) } : {}),
      ...(scope === "workspace" ? { cwd } : {}),
    };

    try {
      // Edit is implemented as delete-then-add for v1 because the server exposes
      // only add/remove routes; true patching needs a dedicated server-side update API.
      if (mode === "edit" && initialServer) {
        const initialScope: WritableScope =
          initialServer.scope === "workspace" ? "workspace" : "user";
        const deleteResponse = await fetch(
          mcpServerUrl(
            initialServer.name,
            initialScope,
            initialScope === "workspace" ? initialServer.cwd : undefined,
          ),
          { method: "DELETE" },
        );
        const deleteData = (await deleteResponse.json()) as { error?: string };
        if (!deleteResponse.ok) throw new Error(deleteData.error ?? "Failed to replace MCP server");
      }
      const response = await fetch("/api/extensions/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as ApiServerResponse;
      if (!response.ok) throw new Error(data.error ?? "Failed to save MCP server");
      await onSaved();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? "Edit MCP server" : "Add MCP server"}</DialogTitle>
          <DialogDescription>
            Scope: {scope}
            {scope === "workspace" && cwd ? ` · ${cwd}` : ""}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <Field label="Name" hint="Required. Lowercase letters, numbers, and dashes only.">
            <input
              value={form.name}
              onChange={(event) => patchForm({ name: event.target.value })}
              required
              pattern="^[a-z0-9-]+$"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
            />
          </Field>

          <Field label="Transport">
            <div className="inline-flex rounded-md border border-border bg-background p-0.5 text-xs">
              {(["stdio", "http", "sse"] as McpTransport[]).map((transport) => (
                <button
                  key={transport}
                  type="button"
                  onClick={() => patchForm({ transport })}
                  className={cn(
                    "rounded px-3 py-1 uppercase",
                    form.transport === transport
                      ? "bg-primary/20 text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {transport}
                </button>
              ))}
            </div>
          </Field>

          {form.transport === "stdio" ? (
            <>
              <Field label="Command">
                <input
                  value={form.command}
                  onChange={(event) => patchForm({ command: event.target.value })}
                  required
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm outline-none focus:border-primary"
                />
              </Field>
              <Field label="Args" hint="One argument per line.">
                <textarea
                  value={form.argsText}
                  onChange={(event) => patchForm({ argsText: event.target.value })}
                  rows={4}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm outline-none focus:border-primary"
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="URL">
                <input
                  value={form.url}
                  onChange={(event) => patchForm({ url: event.target.value })}
                  required
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm outline-none focus:border-primary"
                />
              </Field>
              <KeyValueEditor
                label="Headers"
                rows={form.headers}
                setRows={(headers) => patchForm({ headers })}
              />
            </>
          )}

          <KeyValueEditor label="Env" rows={form.env} setRows={(env) => patchForm({ env })} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tools" hint={'Use "*" for all, "" for none, or a comma-separated list.'}>
              <input
                value={form.tools}
                onChange={(event) => patchForm({ tools: event.target.value })}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-sm outline-none focus:border-primary"
              />
            </Field>
            <Field label="Timeout (ms)" hint="Optional.">
              <input
                type="number"
                min={0}
                value={form.timeoutMs}
                onChange={(event) => patchForm({ timeoutMs: event.target.value })}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
              />
            </Field>
          </div>

          {scope === "workspace" && cwd && (
            <div className="rounded-md border border-border bg-background/70 px-3 py-2 text-xs text-muted-foreground">
              Workspace cwd: <span className="font-mono text-foreground">{cwd}</span>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : mode === "edit" ? "Save changes" : "Add MCP server"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="block space-y-1 text-xs">
      <div className="font-medium text-foreground">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function KeyValueEditor({
  label,
  rows,
  setRows,
}: {
  label: string;
  rows: KeyValueRow[];
  setRows: (rows: KeyValueRow[]) => void;
}) {
  const update = (id: string, patch: Partial<KeyValueRow>) =>
    setRows(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-foreground">{label}</div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRows([...rows, emptyRow()])}
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <input
              value={row.key}
              onChange={(event) => update(row.id, { key: event.target.value })}
              placeholder="KEY"
              className="min-w-0 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-primary"
            />
            <input
              value={row.value}
              onChange={(event) => update(row.id, { value: event.target.value })}
              placeholder="VALUE"
              className="min-w-0 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-primary"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ${label} row`}
              onClick={() =>
                setRows(
                  rows.length === 1 ? [emptyRow()] : rows.filter((item) => item.id !== row.id),
                )
              }
            >
              ×
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
