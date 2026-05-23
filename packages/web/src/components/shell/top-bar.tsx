import { Bot, Command, History, Moon, Settings } from "lucide-react";
import { cn } from "../../lib/cn";
import { useUIStore } from "../../stores/ui-store";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export function TopBar() {
  const topView = useUIStore((s) => s.topView);
  const setTopView = useUIStore((s) => s.setTopView);
  return (
    <header className="flex h-10 items-center justify-between border-b border-border bg-panel px-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 text-primary">
            <Bot className="h-3.5 w-3.5" />
          </div>
          <span className="text-sm font-semibold tracking-tight">Agent View</span>
          <span className="ml-1 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            preview
          </span>
        </div>
        <nav className="ml-2 flex items-center gap-0.5 rounded-md border border-border bg-panel-elevated p-0.5">
          <TabButton active={topView === "workspace"} onClick={() => setTopView("workspace")}>
            Workspace
          </TabButton>
          <TabButton active={topView === "history"} onClick={() => setTopView("history")}>
            <History className="h-3 w-3" />
            History
          </TabButton>
        </nav>
      </div>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
              <Command className="h-3.5 w-3.5" />
              <span className="ml-1">⌘K</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Command palette (todo)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Settings"
              onClick={() => useUIStore.getState().setSettingsOpen(true)}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon">
              <Moon className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Theme (dark only for now)</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
