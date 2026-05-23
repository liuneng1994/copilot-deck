import AnsiToHtml from "ansi-to-html";

const converter = new AnsiToHtml({
  fg: "#e6edf3",
  bg: "transparent",
  newline: false,
  escapeXML: true,
  colors: {
    0: "#0d1117",
    1: "#f38ba8",
    2: "#a6e3a1",
    3: "#f9e2af",
    4: "#8ab4f8",
    5: "#cba6f7",
    6: "#94e2d5",
    7: "#e6edf3",
    8: "#6e7681",
    9: "#ff9a9a",
    10: "#c8f0c4",
    11: "#fff1ad",
    12: "#a5c6ff",
    13: "#dec0ff",
    14: "#bcf0e7",
    15: "#ffffff",
  },
});

/**
 * Convert raw text with ANSI SGR escape codes to safe HTML.
 * Falls back to escaped plain text on parse error.
 */
export function ansiToHtml(input: string): string {
  if (!input) return "";
  try {
    return converter.toHtml(input);
  } catch {
    return input.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c);
  }
}

/** Strip ANSI escape codes for plain-text copy / search. */
export function stripAnsi(input: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control chars by design
  return input.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
}
