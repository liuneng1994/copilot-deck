import { Bot, Command, Moon, Settings } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export function TopBar() {
  return (
    <header className="flex h-10 items-center justify-between border-b border-border bg-panel px-3">
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Bot className="h-3.5 w-3.5" />
        </div>
        <span className="text-sm font-semibold tracking-tight">Agent View</span>
        <span className="ml-2 rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          preview
        </span>
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
            <Button variant="ghost" size="icon">
              <Settings className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Settings (todo)</TooltipContent>
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
