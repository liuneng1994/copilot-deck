import { useEffect } from "react";
import { ArtifactPane } from "./components/artifact/artifact-pane";
import { Composer } from "./components/composer/composer";
import { Conversation, NoSessionPlaceholder } from "./components/conversation/conversation";
import { FindBar } from "./components/conversation/find-bar";
import { SessionHeader } from "./components/conversation/session-header";
import { HistoryPage } from "./components/history/history-page";
import { Inspector, InspectorRail } from "./components/inspector/inspector";
import { ResizeHandle } from "./components/layout/resize-handle";
import { CommandPalette } from "./components/overlays/command-palette";
import { ConfirmDialogHost } from "./components/overlays/confirm-dialog";
import { HelpOverlay } from "./components/overlays/help-overlay";
import { ModelPickerOverlay } from "./components/overlays/model-picker";
import { NoticeBanner } from "./components/overlays/notice-banner";
import { PermissionDialog } from "./components/overlays/permission-dialog";
import { SearchOverlay } from "./components/overlays/search-overlay";
import { SettingsDrawer } from "./components/overlays/settings-drawer";
import { TraceDrawer } from "./components/overlays/trace-drawer";
import { StatusBar } from "./components/shell/status-bar";
import { TopBar } from "./components/shell/top-bar";
import { UpdateBanner } from "./components/shell/update-banner";
import { Sidebar, SidebarRail } from "./components/sidebar/sidebar";
import { orderedSessions } from "./lib/session-order";
import { useWsBridge } from "./lib/ws-bridge";
import {
  ARTIFACT_PANE_DEFAULT,
  ARTIFACT_PANE_MAX,
  ARTIFACT_PANE_MIN,
  useArtifactStore,
} from "./stores/artifact-store";
import { useCheckpointStore } from "./stores/checkpoint-store";
import {
  INSPECTOR_MAX,
  INSPECTOR_MIN,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  useUIStore,
} from "./stores/ui-store";
import { useUserPrefs } from "./stores/user-prefs-store";

export function App() {
  useWsBridge();

  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const inspectorCollapsed = useUIStore((s) => s.inspectorCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const toggleInspector = useUIStore((s) => s.toggleInspector);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const inspectorWidth = useUIStore((s) => s.inspectorWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const setInspectorWidth = useUIStore((s) => s.setInspectorWidth);
  const wsConnected = useUIStore((s) => s.wsConnected);
  const activeId = useUIStore((s) => s.activeSessionId);
  const session = useUIStore((s) => (activeId ? s.sessions[activeId] : null));
  const topView = useUIStore((s) => s.topView);
  const fontSize = useUserPrefs((s) => s.fontSize);
  const theme = useUserPrefs((s) => s.theme);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.classList.remove("light", "dark");
      document.documentElement.classList.add(resolved);
    };
    apply();
    if (theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
  }, [fontSize]);

  // Load checkpoints for the active session on switch.
  useEffect(() => {
    if (activeId) void useCheckpointStore.getState().load(activeId);
  }, [activeId]);

  const artifactOpen = useArtifactStore((s) =>
    activeId
      ? Boolean(s.openBySession[activeId] && (s.orderBySession[activeId]?.length ?? 0) > 0)
      : false,
  );
  const artifactWidth = useArtifactStore((s) =>
    activeId ? (s.widthBySession[activeId] ?? ARTIFACT_PANE_DEFAULT) : ARTIFACT_PANE_DEFAULT,
  );
  const setArtifactWidth = useArtifactStore((s) => s.setWidth);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "\\") {
        e.preventDefault();
        toggleSidebar();
      } else if (e.key === "k") {
        e.preventDefault();
        const st = useUIStore.getState();
        st.setCommandPaletteOpen(!st.commandPaletteOpen);
      } else if (e.key === "b") {
        e.preventDefault();
        toggleInspector();
      } else if (e.key === "f" || e.key === "F") {
        // Cmd/Ctrl+Shift+F → cross-session search.
        // Cmd/Ctrl+F → in-conversation find.
        e.preventDefault();
        const st = useUIStore.getState();
        if (e.shiftKey) {
          st.setSearchOpen(!st.searchOpen);
        } else {
          st.setFindOpen(!st.findOpen);
        }
      } else if (e.key === ",") {
        e.preventDefault();
        useUIStore.getState().setSettingsOpen(true);
      } else if (/^[1-9]$/.test(e.key)) {
        // Cmd/Ctrl + 1..9 → switch to nth session in sidebar order.
        const state = useUIStore.getState();
        const ordered = orderedSessions(state.sessions);
        const idx = Number(e.key) - 1;
        const target = ordered[idx];
        if (target) {
          e.preventDefault();
          state.setActiveSession(target.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar, toggleInspector]);

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      <TopBar />
      <UpdateBanner />
      {topView === "history" ? (
        <div className="flex min-h-0 flex-1">
          <HistoryPage />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {sidebarCollapsed ? (
            <SidebarRail onExpand={toggleSidebar} />
          ) : (
            <>
              <Sidebar />
              <ResizeHandle
                side="left"
                value={sidebarWidth}
                min={SIDEBAR_MIN}
                max={SIDEBAR_MAX}
                defaultValue={256}
                ariaLabel="Resize sidebar"
                onChange={setSidebarWidth}
              />
            </>
          )}

          <main className="flex min-w-0 flex-1 flex-col">
            {!wsConnected && <DisconnectedBanner />}
            <GlobalErrorBanner />
            <NoticeBanner />
            {session ? (
              <>
                <SessionHeader session={session} />
                <div className="flex min-h-0 flex-1">
                  <div className="relative flex min-w-0 flex-1 flex-col">
                    <FindBar />
                    <Conversation session={session} />
                  </div>
                  {artifactOpen && activeId ? (
                    <>
                      <ResizeHandle
                        side="right"
                        value={artifactWidth}
                        min={ARTIFACT_PANE_MIN}
                        max={ARTIFACT_PANE_MAX}
                        defaultValue={ARTIFACT_PANE_DEFAULT}
                        ariaLabel="Resize artifact pane"
                        onChange={(px) => setArtifactWidth(activeId, px)}
                      />
                      <ArtifactPane sessionId={activeId} width={artifactWidth} />
                    </>
                  ) : null}
                </div>
                <Composer session={session} />
              </>
            ) : (
              <NoSessionPlaceholder />
            )}
          </main>

          {inspectorCollapsed ? (
            <InspectorRail onExpand={toggleInspector} />
          ) : (
            <>
              <ResizeHandle
                side="right"
                value={inspectorWidth}
                min={INSPECTOR_MIN}
                max={INSPECTOR_MAX}
                defaultValue={320}
                ariaLabel="Resize inspector"
                onChange={setInspectorWidth}
              />
              <Inspector />
            </>
          )}
        </div>
      )}
      <StatusBar />
      <PermissionDialog />
      <TraceDrawer />
      <HelpOverlay />
      <SearchOverlay />
      <ModelPickerOverlay />
      <SettingsDrawer />
      <CommandPalette />
      <ConfirmDialogHost />
    </div>
  );
}

function DisconnectedBanner() {
  return (
    <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-1.5 text-center text-xs text-destructive">
      Disconnected from server — retrying…
    </div>
  );
}

function GlobalErrorBanner() {
  const err = useUIStore((s) => s.lastError);
  const clear = useUIStore((s) => s.setLastError);
  if (!err) return null;
  return (
    <div className="flex items-center justify-between border-b border-destructive/30 bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
      <span className="truncate">⚠ {err}</span>
      <button
        type="button"
        onClick={() => clear(null)}
        className="ml-3 rounded px-2 py-0.5 hover:bg-destructive/20"
      >
        dismiss
      </button>
    </div>
  );
}
