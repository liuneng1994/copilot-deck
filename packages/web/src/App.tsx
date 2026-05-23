import { useEffect } from "react";
import { Composer } from "./components/composer/composer";
import { Conversation, NoSessionPlaceholder } from "./components/conversation/conversation";
import { SessionHeader } from "./components/conversation/session-header";
import { Inspector, InspectorRail } from "./components/inspector/inspector";
import { HelpOverlay } from "./components/overlays/help-overlay";
import { ModelPickerOverlay } from "./components/overlays/model-picker";
import { NoticeBanner } from "./components/overlays/notice-banner";
import { PermissionDialog } from "./components/overlays/permission-dialog";
import { TraceDrawer } from "./components/overlays/trace-drawer";
import { StatusBar } from "./components/shell/status-bar";
import { TopBar } from "./components/shell/top-bar";
import { Sidebar, SidebarRail } from "./components/sidebar/sidebar";
import { useWsBridge } from "./lib/ws-bridge";
import { useUIStore } from "./stores/ui-store";

export function App() {
  useWsBridge();

  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const inspectorCollapsed = useUIStore((s) => s.inspectorCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const toggleInspector = useUIStore((s) => s.toggleInspector);
  const wsConnected = useUIStore((s) => s.wsConnected);
  const activeId = useUIStore((s) => s.activeSessionId);
  const session = useUIStore((s) => (activeId ? s.sessions[activeId] : null));

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        toggleSidebar();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        toggleInspector();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar, toggleInspector]);

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        {sidebarCollapsed ? <SidebarRail onExpand={toggleSidebar} /> : <Sidebar />}

        <main className="flex min-w-0 flex-1 flex-col">
          {!wsConnected && <DisconnectedBanner />}
          <GlobalErrorBanner />
          <NoticeBanner />
          {session ? (
            <>
              <SessionHeader session={session} />
              <Conversation session={session} />
              <Composer session={session} />
            </>
          ) : (
            <NoSessionPlaceholder />
          )}
        </main>

        {inspectorCollapsed ? <InspectorRail onExpand={toggleInspector} /> : <Inspector />}
      </div>
      <StatusBar />
      <PermissionDialog />
      <TraceDrawer />
      <HelpOverlay />
      <ModelPickerOverlay />
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
