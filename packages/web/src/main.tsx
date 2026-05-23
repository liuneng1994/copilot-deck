import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { TooltipProvider } from "./components/ui/tooltip";
import { useUIStore } from "./stores/ui-store";
import "./styles.css";

if (import.meta.env.DEV) {
  (window as unknown as { useUIStore: typeof useUIStore }).useUIStore = useUIStore;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <TooltipProvider delayDuration={200}>
      <App />
    </TooltipProvider>
  </React.StrictMode>,
);
