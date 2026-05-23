import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { TooltipProvider } from "./components/ui/tooltip";
import { classify } from "./lib/content-renderer/classify";
import { useArtifactStore } from "./stores/artifact-store";
import { useUIStore } from "./stores/ui-store";
import "./styles.css";

if (import.meta.env.DEV) {
  const w = window as unknown as Record<string, unknown>;
  w.useUIStore = useUIStore;
  w.useArtifactStore = useArtifactStore;
  w.classify = classify;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TooltipProvider delayDuration={200}>
      <App />
    </TooltipProvider>
  </React.StrictMode>,
);
