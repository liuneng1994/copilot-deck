import { Command } from "cmdk";
import { FileText, FolderOpen, Settings, Sparkles, Zap } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { BUILTIN_COMMANDS } from "../../lib/builtin-commands";
import { cn } from "../../lib/cn";
import { useFocusTrap } from "../../lib/focus-trap";
import { orderedSessions } from "../../lib/session-order";
import { useUIStore } from "../../stores/ui-store";

export function CommandPalette() {
  const open = useUIStore((s) => s.commandPaletteOpen);
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const sessions = useUIStore((s) => s.sessions);
  const activeSessionId = useUIStore((s) => s.activeSessionId);
  const activeSession = useUIStore((s) =>
    s.activeSessionId ? s.sessions[s.activeSessionId] : null,
  );
  const filesOverview = useUIStore((s) => s.filesOverview);
  const inspectorCollapsed = useUIStore((s) => s.inspectorCollapsed);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useFocusTrap(dialogRef, open, { initialFocus: inputRef });

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const ordered = useMemo(() => orderedSessions(sessions).slice(0, 12), [sessions]);
  const slashCommands = useMemo(() => {
    const seen = new Map<
      string,
      { name: string; description?: string; source: "builtin" | "agent" }
    >();
    for (const command of BUILTIN_COMMANDS) {
      if (!seen.has(command.name)) {
        seen.set(command.name, {
          name: command.name,
          description: command.description,
          source: "builtin",
        });
      }
    }
    for (const session of Object.values(sessions)) {
      for (const command of session.availableCommands ?? []) {
        if (!seen.has(command.name)) {
          seen.set(command.name, { ...command, source: "agent" });
        }
      }
    }
    return [...seen.values()].slice(0, 30);
  }, [sessions]);
  const recentFiles = useMemo(() => {
    if (!activeSession?.cwd) return [];
    return [...(filesOverview[activeSession.cwd]?.touched ?? [])]
      .sort((a, b) => (b.lastTouchAt ?? 0) - (a.lastTouchAt ?? 0))
      .slice(0, 12);
  }, [activeSession?.cwd, filesOverview]);

  if (!open) return null;

  const close = () => setOpen(false);
  const run = (action: () => void) => {
    action();
    close();
  };

  const selectSession = (id: string) =>
    run(() => {
      const state = useUIStore.getState();
      state.setTopView("workspace");
      state.setActiveSession(id);
    });

  const prefillSlash = (name: string) =>
    run(() => {
      const state = useUIStore.getState();
      const targetId = state.activeSessionId;
      if (!targetId) return;
      state.setTopView("workspace");
      state.setDraft(targetId, `/${name} `);
      state.bumpComposerLoad(targetId);
    });

  const openFile = (path: string) =>
    run(() => {
      const state = useUIStore.getState();
      state.setTopView("workspace");
      state.setInspectorTab("files");
      state.setFilesViewMode("files");
      state.setFilePreviewPath(path);
      if (state.inspectorCollapsed) state.toggleInspector();
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/55 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={close}
    >
      <dialog
        ref={dialogRef}
        open
        aria-modal="true"
        aria-label="Command palette"
        className="relative m-0 w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-panel-elevated p-0 text-foreground shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <Command shouldFilter label="Command palette">
          <Command.Input
            ref={inputRef}
            autoFocus
            placeholder="Search sessions, commands, files, actions…"
            className="h-12 w-full border-b border-border bg-transparent px-4 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Command.List className="max-h-[60vh] overflow-y-auto p-2">
            <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
              No results found.
            </Command.Empty>

            <Command.Group heading="Sessions" className={groupClassName}>
              {ordered.length > 0 ? (
                ordered.map((session) => (
                  <PaletteItem
                    key={session.id}
                    value={`session ${session.title} ${session.cwd}`}
                    onSelect={() => selectSession(session.id)}
                  >
                    <FolderOpen className="h-4 w-4 text-primary" />
                    <span className="min-w-0 flex-1 truncate">{session.title}</span>
                    <span className="truncate text-xs text-muted-foreground">{session.cwd}</span>
                  </PaletteItem>
                ))
              ) : (
                <DisabledItem value="no sessions yet">(no sessions yet)</DisabledItem>
              )}
            </Command.Group>

            <Command.Group heading="Slash commands" className={groupClassName}>
              {activeSessionId ? (
                slashCommands.map((command) => (
                  <PaletteItem
                    key={`${command.source}:${command.name}`}
                    value={`slash ${command.name} ${command.description ?? ""}`}
                    onSelect={() => prefillSlash(command.name)}
                  >
                    {command.source === "builtin" ? (
                      <Zap className="h-4 w-4 text-sky-400" />
                    ) : (
                      <Sparkles className="h-4 w-4 text-amber-400" />
                    )}
                    <span className="font-mono text-foreground">/{command.name}</span>
                    {command.description && (
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {command.description}
                      </span>
                    )}
                  </PaletteItem>
                ))
              ) : (
                <DisabledItem value="no active session">(no active session)</DisabledItem>
              )}
            </Command.Group>

            <Command.Group heading="Recent files" className={groupClassName}>
              {recentFiles.length > 0 ? (
                recentFiles.map((file) => (
                  <PaletteItem
                    key={file.path}
                    value={`file ${file.rel} ${file.path}`}
                    onSelect={() => openFile(file.path)}
                  >
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{file.rel}</span>
                    {typeof file.added === "number" || typeof file.removed === "number" ? (
                      <span className="text-xs text-muted-foreground">
                        +{file.added ?? 0} -{file.removed ?? 0}
                      </span>
                    ) : null}
                  </PaletteItem>
                ))
              ) : (
                <DisabledItem value="no recent files yet">(no recent files yet)</DisabledItem>
              )}
            </Command.Group>

            <Command.Group heading="Actions" className={groupClassName}>
              <PaletteItem
                value="action open settings"
                onSelect={() =>
                  run(() => {
                    useUIStore.getState().setSettingsOpen(true);
                  })
                }
              >
                <Settings className="h-4 w-4 text-muted-foreground" />
                <span>Open Settings</span>
              </PaletteItem>
              <PaletteItem
                value="action toggle inspector"
                onSelect={() =>
                  run(() => {
                    useUIStore.getState().toggleInspector();
                  })
                }
              >
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span>{inspectorCollapsed ? "Open Inspector" : "Close Inspector"}</span>
              </PaletteItem>
            </Command.Group>
          </Command.List>
        </Command>
      </dialog>
    </div>
  );
}

const groupClassName =
  "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground";

function PaletteItem({
  children,
  value,
  onSelect,
}: {
  children: React.ReactNode;
  value: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm outline-none",
        "data-[selected=true]:bg-primary/15 data-[selected=true]:text-foreground text-muted-foreground",
      )}
    >
      {children}
    </Command.Item>
  );
}

function DisabledItem({ children, value }: { children: React.ReactNode; value: string }) {
  return (
    <Command.Item
      value={value}
      disabled
      className="flex cursor-not-allowed items-center gap-2 rounded-md px-2 py-2 text-sm text-muted-foreground/60"
    >
      {children}
    </Command.Item>
  );
}
