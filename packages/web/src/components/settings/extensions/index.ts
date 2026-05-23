import { createElement } from "react";

export { McpServersPanel } from "./mcp-panel";
export { PluginsPanel } from "./plugins-panel";
export { SkillsPanel } from "./skills-panel";

export function ExtensionPanelPlaceholder({ children }: { children: string }) {
  return createElement(
    "div",
    {
      className:
        "flex min-h-[220px] items-center justify-center rounded-lg border border-dashed border-border bg-background/60 p-6 text-center text-sm text-muted-foreground",
    },
    children,
  );
}
