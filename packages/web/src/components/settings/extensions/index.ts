import { createElement } from "react";

export { McpServersPanel } from "./mcp-panel";

export function PluginsPanel() {
  return createElement(ExtensionPanelPlaceholder, null, "Coming soon — wired in ext-tab-plugins");
}

export function SkillsPanel() {
  return createElement(ExtensionPanelPlaceholder, null, "Coming soon — wired in ext-tab-skills");
}

function ExtensionPanelPlaceholder({ children }: { children: string }) {
  return createElement(
    "div",
    {
      className:
        "flex min-h-[220px] items-center justify-center rounded-lg border border-dashed border-border bg-background/60 p-6 text-center text-sm text-muted-foreground",
    },
    children,
  );
}
