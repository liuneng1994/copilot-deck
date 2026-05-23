import { Check, ChevronDown, Sparkles } from "lucide-react";
import { cn } from "../../lib/cn";
import { sendWs } from "../../lib/ws-client";
import type { SessionState } from "../../stores/ui-store";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

export function ModeSelector({ session }: { session: SessionState }) {
  const options = session.modeOptions ?? [];
  if (options.length === 0) {
    return null;
  }
  const current =
    session.modeName ?? options.find((o) => o.value === session.modeId)?.name ?? "mode";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1 text-xs">
          <Sparkles className="h-3 w-3" />
          {current}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1" align="end">
        <div className="border-b border-border px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          Session mode
        </div>
        {options.map((o) => {
          const selected = o.value === session.modeId;
          return (
            <button
              type="button"
              key={o.value}
              onClick={() =>
                !selected && sendWs({ type: "set_mode", sessionId: session.id, modeId: o.value })
              }
              className={cn(
                "flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted",
                selected && "bg-primary/10",
              )}
            >
              <Check
                className={cn("mt-0.5 h-3 w-3 shrink-0", selected ? "text-primary" : "opacity-0")}
              />
              <span className="flex-1">
                <span className="font-medium text-foreground">{o.name}</span>
                {o.description && (
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                    {o.description}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
