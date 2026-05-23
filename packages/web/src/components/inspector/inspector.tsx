import {
  ChevronLeft,
  FileCode2,
  FolderTree,
  ListChecks,
  Settings2,
  TerminalSquare,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { useUIStore } from "../../stores/ui-store";
import { ToolCallCard } from "../conversation/tool-call-card";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { FilesTab } from "./files-tab";
import { PlanTab } from "./plan-tab";
import { TerminalTab } from "./terminal-tab";

function Empty({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
      {label}
    </div>
  );
}

/** Per (session, tab) scroll memory; resets on page reload. */
const inspectorScrollMemory = new Map<string, number>();

export function Inspector() {
  const toggle = useUIStore((s) => s.toggleInspector);
  const session = useUIStore((s) => (s.activeSessionId ? s.sessions[s.activeSessionId] : null));
  const toolCalls = useUIStore((s) => s.toolCalls);
  const tab = useUIStore((s) => s.inspectorTab);
  const setTab = useUIStore((s) => s.setInspectorTab);
  const width = useUIStore((s) => s.inspectorWidth);

  const sessionCalls = session
    ? session.toolCallIds.map((id) => toolCalls[id]).filter(Boolean)
    : [];

  // Restore + persist per (sessionId, tab) scroll position. We keep the cache
  // in a module-local ref so it survives across re-renders but not page
  // reloads (intentional: stale scroll restores can be confusing).
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollKey = `${session?.id ?? "none"}::${tab}`;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const saved = inspectorScrollMemory.get(scrollKey);
    el.scrollTop = saved ?? 0;
    const onScroll = () => inspectorScrollMemory.set(scrollKey, el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      inspectorScrollMemory.set(scrollKey, el.scrollTop);
      el.removeEventListener("scroll", onScroll);
    };
  }, [scrollKey]);

  return (
    <aside
      className="flex h-full shrink-0 flex-col border-l border-border bg-panel"
      style={{ width }}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">Inspector</span>
        <Button variant="ghost" size="icon" onClick={toggle} title="Collapse (⌘B)">
          <ChevronLeft className="h-4 w-4 rotate-180" />
        </Button>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as typeof tab)}
        className="flex flex-1 flex-col min-h-0"
      >
        <TabsList className="mx-2 mt-2">
          <TabsTrigger value="plan" className="gap-1">
            <ListChecks className="h-3 w-3" />
            Plan
            {session?.plan && session.plan.length > 0 && (
              <span className="ml-0.5 rounded bg-muted px-1 text-[9px]">
                {session.plan.filter((p) => p.status === "completed").length}/{session.plan.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="tools" className="gap-1">
            <FolderTree className="h-3 w-3" />
            Tools
            {sessionCalls.length > 0 && (
              <span className="ml-0.5 rounded bg-muted px-1 text-[9px]">{sessionCalls.length}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="files" className="gap-1">
            <FileCode2 className="h-3 w-3" />
            Files
          </TabsTrigger>
          <TabsTrigger value="terminal" className="gap-1">
            <TerminalSquare className="h-3 w-3" />
            Term
          </TabsTrigger>
        </TabsList>
        <TabsList className="mx-2 mt-1">
          <TabsTrigger value="config" className="gap-1">
            <Settings2 className="h-3 w-3" />
            Config
          </TabsTrigger>
        </TabsList>

        <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto px-1 pb-3">
          <TabsContent value="plan">
            {session ? <PlanTab session={session} /> : <Empty label="Select a session." />}
          </TabsContent>
          <TabsContent value="tools" className="space-y-1">
            {!session ? (
              <Empty label="Select a session." />
            ) : sessionCalls.length === 0 ? (
              <Empty label="No tool calls yet." />
            ) : (
              sessionCalls.map((c) => (
                <div key={c.id} className="-mx-9">
                  <ToolCallCard call={c} />
                </div>
              ))
            )}
          </TabsContent>
          <TabsContent value="files">
            {session ? (
              <FilesTab session={session} toolCalls={toolCalls} />
            ) : (
              <Empty label="Select a session." />
            )}
          </TabsContent>
          <TabsContent value="terminal">
            {session ? (
              <TerminalTab session={session} toolCalls={toolCalls} />
            ) : (
              <Empty label="Select a session." />
            )}
          </TabsContent>
          <TabsContent value="config" className="px-2">
            {session ? (
              <dl className="space-y-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">Session ID</dt>
                  <dd className="font-mono text-[11px] break-all">{session.id}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">cwd</dt>
                  <dd className="font-mono text-[11px] break-all">{session.cwd}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Mode</dt>
                  <dd>
                    {session.modeName ?? "—"}
                    {session.modeId && session.modeId !== session.modeName && (
                      <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                        ({session.modeId})
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Available commands</dt>
                  <dd>
                    {session.availableCommands?.length ? session.availableCommands.length : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Tool calls</dt>
                  <dd>{sessionCalls.length}</dd>
                </div>
              </dl>
            ) : (
              <Empty label="Select a session." />
            )}
          </TabsContent>
        </div>
      </Tabs>
    </aside>
  );
}

export function InspectorRail({ onExpand }: { onExpand: () => void }) {
  return (
    <aside className="flex h-full w-12 shrink-0 flex-col items-center border-l border-border bg-panel py-2">
      <Button variant="ghost" size="icon" onClick={onExpand} title="Expand inspector (⌘B)">
        <ChevronLeft className="h-4 w-4" />
      </Button>
    </aside>
  );
}
