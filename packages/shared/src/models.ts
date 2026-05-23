// Curated list of Copilot CLI models surfaced in the picker.
// Note: this is a hand-maintained subset of what `copilot --model …` accepts,
// not an exhaustive list — embeddings and legacy aliases are intentionally
// omitted so the picker stays scannable.

export type ModelGroup = "claude" | "gpt" | "other";

export interface ModelInfo {
  id: string;
  label: string;
  group: ModelGroup;
  /** Optional short tag e.g. "internal", "1M", "high reasoning". */
  tag?: string;
}

export const CURATED_MODELS: ModelInfo[] = [
  // Claude — Opus
  {
    id: "claude-opus-4.7-high",
    label: "Claude Opus 4.7",
    group: "claude",
    tag: "high reasoning · internal",
  },
  {
    id: "claude-opus-4.7-xhigh",
    label: "Claude Opus 4.7",
    group: "claude",
    tag: "xhigh reasoning · internal",
  },
  {
    id: "claude-opus-4.7-1m-internal",
    label: "Claude Opus 4.7",
    group: "claude",
    tag: "1M context · internal",
  },
  { id: "claude-opus-4.7", label: "Claude Opus 4.7", group: "claude" },
  {
    id: "claude-opus-4.6-1m",
    label: "Claude Opus 4.6",
    group: "claude",
    tag: "1M context · internal",
  },
  { id: "claude-opus-4.6", label: "Claude Opus 4.6", group: "claude" },
  { id: "claude-opus-4.5", label: "Claude Opus 4.5", group: "claude" },
  // Claude — Sonnet / Haiku
  { id: "claude-sonnet-4.6", label: "Claude Sonnet 4.6", group: "claude" },
  { id: "claude-sonnet-4.5", label: "Claude Sonnet 4.5", group: "claude" },
  { id: "claude-haiku-4.5", label: "Claude Haiku 4.5", group: "claude" },
  // GPT-5 family
  { id: "gpt-5.5", label: "GPT-5.5", group: "gpt" },
  { id: "gpt-5.4", label: "GPT-5.4", group: "gpt" },
  { id: "gpt-5.4-mini", label: "GPT-5.4 mini", group: "gpt" },
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", group: "gpt" },
  { id: "gpt-5.2-codex", label: "GPT-5.2 Codex", group: "gpt" },
  { id: "gpt-5.2", label: "GPT-5.2", group: "gpt" },
  { id: "gpt-5-mini", label: "GPT-5 mini", group: "gpt" },
  // GPT-4 family
  { id: "gpt-4.1", label: "GPT-4.1", group: "gpt" },
  // Other
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", group: "other" },
  { id: "lark-picker-secondary", label: "Lark", group: "other" },
];

export const MODEL_BY_ID = new Map(CURATED_MODELS.map((m) => [m.id, m] as const));
