import { createElement } from "react";

export { PluginsPanel } from "./plugins-panel";
export { SkillsPanel } from "./skills-panel";

export function McpServersPanel() {
  return createElement(ExtensionPanelPlaceholder, null, "Coming soon — wired in ext-tab-mcp");
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
