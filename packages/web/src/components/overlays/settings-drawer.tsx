import { X } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";
import { useUIStore } from "../../stores/ui-store";
import { McpServersPanel } from "../settings/extensions/mcp-panel";
import { PluginsPanel } from "../settings/extensions/plugins-panel";
import { SkillsPanel } from "../settings/extensions/skills-panel";
import { StoragePanel } from "../settings/storage-panel";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

const SETTINGS_TABS = ["General", "Extensions", "Storage", "Appearance", "About"] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

export function SettingsDrawer() {
  const open = useUIStore((s) => s.settingsOpen);
  const setOpen = useUIStore((s) => s.setSettingsOpen);
  const [tab, setTab] = useState<SettingsTab>("Extensions");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        hideClose
        className="right-0 left-auto top-0 h-dvh w-full max-w-[720px] translate-x-0 translate-y-0 gap-0 rounded-none border-y-0 border-r-0 bg-panel-elevated p-0 shadow-2xl data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:w-[min(720px,calc(100vw-2rem))]"
      >
        <DialogHeader className="flex-row items-center justify-between space-y-0 border-b border-border px-4 py-3">
          <DialogTitle className="text-sm">Settings</DialogTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Close settings"
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <nav className="border-b border-border bg-panel/60 p-2 sm:w-44 sm:border-r sm:border-b-0">
            <div className="flex gap-1 overflow-x-auto sm:flex-col sm:overflow-visible">
              {SETTINGS_TABS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setTab(item)}
                  className={cn(
                    "rounded-md px-3 py-2 text-left text-xs font-medium transition-colors",
                    tab === item
                      ? "bg-primary/15 text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {item}
                </button>
              ))}
            </div>
          </nav>

          <section className="min-h-0 flex-1 overflow-y-auto p-4">
            {tab === "Extensions" ? (
              <ExtensionsTabs />
            ) : tab === "Storage" ? (
              <StoragePanel />
            ) : (
              <ComingSoonPanel title={tab} />
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ComingSoonPanel({ title }: { title: SettingsTab }) {
  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="rounded-lg border border-border bg-panel p-6 text-sm text-muted-foreground">
        Coming soon.
      </div>
    </div>
  );
}

function ExtensionsTabs() {
  return (
    <div className="flex h-full min-h-0 flex-col space-y-4">
      <div>
        <h2 className="text-base font-semibold">Extensions</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Manage Plugins, MCP servers, and Skills. Each panel below is ready for the ext-tab-*
          todos.
        </p>
      </div>

      <Tabs defaultValue="plugins" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="w-fit">
          <TabsTrigger value="plugins">Plugins</TabsTrigger>
          <TabsTrigger value="mcp">MCP servers</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
        </TabsList>
        <TabsContent value="plugins">
          <PluginsPanel />
        </TabsContent>
        <TabsContent value="mcp">
          <McpServersPanel />
        </TabsContent>
        <TabsContent value="skills">
          <SkillsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
