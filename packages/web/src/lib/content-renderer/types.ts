/**
 * Discriminated union produced by the markdown / tool-result classifier.
 * Renderers and the hoist-policy switch on `kind`.
 *
 * Each item also carries a deterministic `id` (hash of source offset + kind)
 * so the artifact store can dedupe across re-renders without flickering.
 */
export type ContentItem =
  | { kind: "text"; id: string; text: string }
  | { kind: "code"; id: string; lang?: string; text: string; lines: number }
  | { kind: "table"; id: string; header: string[]; rows: string[][] }
  | { kind: "mermaid"; id: string; src: string }
  | { kind: "math"; id: string; tex: string; display: boolean }
  | { kind: "json"; id: string; raw: string; value: unknown; lines: number }
  | { kind: "csv"; id: string; header: string[]; rows: string[][] }
  | { kind: "html"; id: string; src: string }
  | { kind: "svg"; id: string; src: string }
  | { kind: "shell"; id: string; commands: { cmd: string; cwd?: string }[] };

export type ContentKind = ContentItem["kind"];
