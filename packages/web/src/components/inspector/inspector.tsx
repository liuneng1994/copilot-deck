import {
  ChevronLeft,
  FileCode2,
  FolderTree,
  ListChecks,
  Settings2,
  ScrollText,
  TerminalSquare,
} from "lucide-react";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { useUIStore } from "../../stores/ui-store";
import { ToolCallCard } from "../conversation/tool-call-card";
import { FilesTab } from "./files-tab";
import { TerminalTab } from "./terminal-tab";

function Empty({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
      {label}
    </div>
  );
}

export function Inspector() {
  const toggle = useUIStore((s) => s.toggleInspector);
  const session = useUIStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null,
  );
  const toolCalls = useUIStore((s) => s.toolCalls);

  const sessionCalls = session
    ? session.toolCallIds.map((id) => toolCalls[id]).filter(Boolean)
    : [];

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">Inspector</span>
        <Button variant="ghost" size="icon" onClick={toggle} title="Collapse (⌘B)">
          <ChevronLeft className="h-4 w-4 rotate-180" />
        </Button>
      </div>

      <Tabs defaultValue="tools" className="flex flex-1 flex-col min-h-0">
        <TabsList className="mx-2 mt-2">
          <TabsTrigger value="plan" className="gap-1"><ListChecks className="h-3 w-3" />Plan</TabsTrigger>
          <TabsTrigger value="tools" className="gap-1">
            <FolderTree className="h-3 w-3" />
            Tools
            {sessionCalls.length > 0 && (
              <span className="ml-0.5 rounded bg-muted px-1 text-[9px]">
                {sessionCalls.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="files" className="gap-1"><FileCode2 className="h-3 w-3" />Files</TabsTrigger>
          <TabsTrigger value="terminal" className="gap-1"><TerminalSquare className="h-3 w-3" />Term</TabsTrigger>
        </TabsList>
        <TabsList className="mx-2 mt-1">
          <TabsTrigger value="logs" className="gap-1"><ScrollText className="h-3 w-3" />Logs</TabsTrigger>
          <TabsTrigger value="config" className="gap-1"><Settings2 className="h-3 w-3" />Config</TabsTrigger>
        </TabsList>

        <div className="flex-1 min-h-0 overflow-auto px-1 pb-3">
          <TabsContent value="plan">
            <Empty label={session ? "No plan emitted yet for this session." : "Select a session."} />
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
          <TabsContent value="logs">
            <Empty label="JSON-RPC trace (M-Persist)." />
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
                    {session.availableCommands?.length
                      ? session.availableCommands.length
                      : "—"}
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
