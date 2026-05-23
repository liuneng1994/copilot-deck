import type { MarketplaceInfo, MarketplacePlugin, PluginInfo } from "@agent-view/shared";
import { ChevronDown, ChevronRight, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
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
import { Input } from "../../ui/input";

const BROWSE_LIMIT = 30;

export function PluginsPanel() {
  const plugins = useUIStore((s) => s.plugins);
  const marketplaces = useUIStore((s) => s.marketplaces);
  const marketplaceBrowse = useUIStore((s) => s.marketplaceBrowse);
  const extOps = useUIStore((s) => s.extOps);
  const loadPlugins = useUIStore((s) => s.loadPlugins);
  const loadMarketplaces = useUIStore((s) => s.loadMarketplaces);
  const loadMarketplaceBrowse = useUIStore((s) => s.loadMarketplaceBrowse);
  const installPlugin = useUIStore((s) => s.installPlugin);
  const uninstallPlugin = useUIStore((s) => s.uninstallPlugin);
  const updatePlugin = useUIStore((s) => s.updatePlugin);
  const updateAllPlugins = useUIStore((s) => s.updateAllPlugins);
  const addMarketplace = useUIStore((s) => s.addMarketplace);
  const removeMarketplace = useUIStore((s) => s.removeMarketplace);
  const updateMarketplace = useUIStore((s) => s.updateMarketplace);
  const lastError = useUIStore((s) => s.lastError);

  const [installOpen, setInstallOpen] = useState(false);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [source, setSource] = useState("");
  const [marketplaceSource, setMarketplaceSource] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const [dismissedOps, setDismissedOps] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void Promise.allSettled([loadPlugins(), loadMarketplaces()]);
  }, [loadPlugins, loadMarketplaces]);

  const opEntries = useMemo(
    () => Object.entries(extOps).filter(([id]) => !dismissedOps[id]),
    [dismissedOps, extOps],
  );
  const successfulDoneIds = useMemo(
    () =>
      Object.entries(extOps)
        .filter(([, op]) => op.done && op.success)
        .map(([id]) => id),
    [extOps],
  );

  useEffect(() => {
    if (successfulDoneIds.length === 0) return;
    void Promise.allSettled([loadPlugins(), loadMarketplaces()]);
    const timer = window.setTimeout(() => {
      setDismissedOps((prev) => {
        const next = { ...prev };
        for (const id of successfulDoneIds) next[id] = true;
        return next;
      });
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [loadMarketplaces, loadPlugins, successfulDoneIds]);

  const loading = plugins === null || marketplaces === null;

  const submitInstall = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setBusy(`install:${trimmed}`);
    try {
      await installPlugin(trimmed);
      setInstallOpen(false);
      setSource("");
    } finally {
      setBusy(null);
    }
  };

  const submitMarketplace = async () => {
    const trimmed = marketplaceSource.trim();
    if (!trimmed) return;
    setBusy(`marketplace:add:${trimmed}`);
    try {
      await addMarketplace(trimmed);
      setMarketplaceOpen(false);
      setMarketplaceSource("");
    } finally {
      setBusy(null);
    }
  };

  const toggleMarketplace = (marketplace: MarketplaceInfo) => {
    const next = !expanded[marketplace.name];
    setExpanded((prev) => ({ ...prev, [marketplace.name]: next }));
    if (next && !(marketplace.name in marketplaceBrowse)) {
      void loadMarketplaceBrowse(marketplace.name);
    }
  };

  if (loading) {
    return <PluginsSkeleton />;
  }

  return (
    <div className="relative space-y-4 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-panel p-3">
        <div>
          <h3 className="text-sm font-semibold">Plugins</h3>
          <p className="text-xs text-muted-foreground">
            Install bundled Skills, agents, MCP servers, hooks, and LSP integrations.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={() => setInstallOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Install plugin
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={(plugins?.length ?? 0) === 0 || busy === "update-all"}
            onClick={async () => {
              setBusy("update-all");
              try {
                await updateAllPlugins();
              } finally {
                setBusy(null);
              }
            }}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", busy === "update-all" && "animate-spin")} />
            Update all
          </Button>
        </div>
      </div>

      {lastError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {lastError}
        </div>
      ) : null}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Installed plugins ({plugins?.length ?? 0})</h3>
        </div>
        {plugins && plugins.length > 0 ? (
          <div className="grid gap-2">
            {plugins.map((plugin) => (
              <PluginCard
                key={plugin.name}
                plugin={plugin}
                busy={busy}
                onUpdate={async () => {
                  setBusy(`plugin:update:${plugin.name}`);
                  try {
                    await updatePlugin(plugin.name);
                  } finally {
                    setBusy(null);
                  }
                }}
                onUninstall={async () => {
                  if (!window.confirm(`Uninstall plugin ${plugin.name}?`)) return;
                  setBusy(`plugin:uninstall:${plugin.name}`);
                  try {
                    await uninstallPlugin(plugin.name);
                  } finally {
                    setBusy(null);
                  }
                }}
              />
            ))}
          </div>
        ) : (
          <EmptyState>No plugins installed. Browse marketplaces below or click Install.</EmptyState>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Marketplaces</h3>
        <div className="grid gap-2">
          {(marketplaces ?? []).map((marketplace) => {
            const open = Boolean(expanded[marketplace.name]);
            const items = marketplaceBrowse[marketplace.name];
            return (
              <div
                key={marketplace.name}
                className="overflow-hidden rounded-lg border border-border bg-panel"
              >
                <div className="flex items-start justify-between gap-2 p-3">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-start gap-2 text-left"
                    onClick={() => toggleMarketplace(marketplace)}
                  >
                    {open ? (
                      <ChevronDown className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{marketplace.name}</span>
                        {marketplace.builtin ? <Badge>builtin</Badge> : null}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {marketplace.source}
                      </span>
                    </span>
                  </button>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Update ${marketplace.name}`}
                      disabled={busy === `marketplace:update:${marketplace.name}`}
                      onClick={async () => {
                        setBusy(`marketplace:update:${marketplace.name}`);
                        try {
                          await updateMarketplace(marketplace.name);
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                    {!marketplace.builtin ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${marketplace.name}`}
                        disabled={busy === `marketplace:remove:${marketplace.name}`}
                        onClick={async () => {
                          if (!window.confirm(`Remove marketplace ${marketplace.name}?`)) return;
                          setBusy(`marketplace:remove:${marketplace.name}`);
                          try {
                            await removeMarketplace(marketplace.name);
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>
                {open ? (
                  <MarketplaceBody
                    items={items}
                    showAll={Boolean(showAll[marketplace.name])}
                    onShowMore={() => setShowAll((prev) => ({ ...prev, [marketplace.name]: true }))}
                    onInstall={submitInstall}
                    busy={busy}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setMarketplaceOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Add marketplace
        </Button>
      </section>

      <InstallDialog
        open={installOpen}
        value={source}
        busy={Boolean(busy?.startsWith("install:"))}
        onOpenChange={setInstallOpen}
        onValueChange={setSource}
        onSubmit={() => submitInstall(source)}
      />

      <Dialog open={marketplaceOpen} onOpenChange={setMarketplaceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add marketplace</DialogTitle>
            <DialogDescription>
              Enter a marketplace source such as owner/repo or a URL.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="github/copilot-plugins"
            value={marketplaceSource}
            onChange={(event) => setMarketplaceSource(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submitMarketplace();
            }}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setMarketplaceOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={!marketplaceSource.trim() || busy !== null}
              onClick={submitMarketplace}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {opEntries.length > 0 ? <ProgressToast entries={opEntries} /> : null}
    </div>
  );
}

function PluginCard({
  plugin,
  busy,
  onUpdate,
  onUninstall,
}: {
  plugin: PluginInfo;
  busy: string | null;
  onUpdate: () => Promise<void>;
  onUninstall: () => Promise<void>;
}) {
  const capabilities = [
    ["skills", plugin.capabilities?.skills],
    ["agents", plugin.capabilities?.agents],
    ["mcp", plugin.capabilities?.mcpServers],
    ["hooks", plugin.capabilities?.hooks],
    ["lsp", plugin.capabilities?.lspServers],
  ] as const;

  return (
    <article className="rounded-lg border border-border bg-panel p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="truncate text-sm font-semibold">{plugin.name}</h4>
            {plugin.version ? (
              <Badge>
                {plugin.version.startsWith("v") ? plugin.version : `v${plugin.version}`}
              </Badge>
            ) : null}
          </div>
          {plugin.description ? (
            <p
              className="mt-1 line-clamp-2 text-xs text-muted-foreground"
              title={plugin.description}
            >
              {plugin.description}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {capabilities.map(([label, count]) =>
              count && count > 0 ? (
                <Badge key={label}>
                  {label}: {count}
                </Badge>
              ) : null,
            )}
          </div>
          <p className="mt-2 truncate text-[11px] text-muted-foreground">
            {plugin.marketplace ? `Marketplace: ${plugin.marketplace}` : "Source"}:{" "}
            {plugin.source ?? plugin.marketplace ?? "unknown"}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Update ${plugin.name}`}
            disabled={busy === `plugin:update:${plugin.name}`}
            onClick={() => void onUpdate()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Uninstall ${plugin.name}`}
            disabled={busy === `plugin:uninstall:${plugin.name}`}
            onClick={() => void onUninstall()}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </article>
  );
}

function MarketplaceBody({
  items,
  showAll,
  onShowMore,
  onInstall,
  busy,
}: {
  items: MarketplacePlugin[] | null | undefined;
  showAll: boolean;
  onShowMore: () => void;
  onInstall: (source: string) => Promise<void>;
  busy: string | null;
}) {
  if (items === null || items === undefined) {
    return (
      <div className="border-t border-border p-3 text-xs text-muted-foreground">
        <Loader2 className="mr-2 inline h-3.5 w-3.5 animate-spin" /> Loading marketplace…
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="border-t border-border p-3 text-xs text-muted-foreground">
        No plugins found.
      </div>
    );
  }
  const visible = showAll ? items : items.slice(0, BROWSE_LIMIT);
  return (
    <div className="border-t border-border">
      <div className="divide-y divide-border/70">
        {visible.map((item) => {
          const installSource = `${item.name}@${item.marketplace}`;
          return (
            <div
              key={`${item.marketplace}:${item.name}`}
              className="flex items-start justify-between gap-3 p-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium">{item.name}</div>
                {item.description ? (
                  <p
                    className="line-clamp-2 text-xs text-muted-foreground"
                    title={item.description}
                  >
                    {item.description}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy === `install:${installSource}`}
                onClick={() => void onInstall(installSource)}
              >
                install
              </Button>
            </div>
          );
        })}
      </div>
      {!showAll && items.length > BROWSE_LIMIT ? (
        <button
          type="button"
          className="w-full border-t border-border px-3 py-2 text-xs text-primary hover:bg-muted"
          onClick={onShowMore}
        >
          Show more ({items.length - BROWSE_LIMIT} hidden)
        </button>
      ) : null}
    </div>
  );
}

function InstallDialog({
  open,
  value,
  busy,
  onOpenChange,
  onValueChange,
  onSubmit,
}: {
  open: boolean;
  value: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Install plugin</DialogTitle>
          <DialogDescription>
            Supports plugin@marketplace, owner/repo, owner/repo:path, or a git/HTTPS URL.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          placeholder="spark@copilot-plugins or owner/repo:path"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSubmit();
          }}
        />
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!value.trim() || busy} onClick={onSubmit}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Install
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProgressToast({
  entries,
}: {
  entries: Array<
    [
      string,
      {
        kind: string;
        target: string;
        lines: string[];
        done: boolean;
        success?: boolean;
        error?: string;
      },
    ]
  >;
}) {
  return (
    <div className="sticky bottom-3 z-10 space-y-2 rounded-lg border border-border bg-panel-elevated/95 p-3 shadow-lg backdrop-blur">
      {entries.map(([id, op]) => (
        <div key={id} className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-xs font-medium">
            <span>
              {op.kind} {op.target}
            </span>
            {op.done ? (
              <Badge>{op.success ? "done" : "failed"}</Badge>
            ) : (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
          </div>
          <pre className="max-h-28 overflow-hidden whitespace-pre-wrap rounded bg-background/80 p-2 text-[11px] text-muted-foreground">
            {(op.error ? [...op.lines, op.error] : op.lines).slice(-5).join("\n") || "Starting…"}
          </pre>
        </div>
      ))}
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      {children}
    </span>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-background/60 p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function PluginsSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-20 animate-pulse rounded-lg border border-border bg-panel" />
      <div className="h-28 animate-pulse rounded-lg border border-border bg-panel" />
      <div className="h-40 animate-pulse rounded-lg border border-border bg-panel" />
    </div>
  );
}
