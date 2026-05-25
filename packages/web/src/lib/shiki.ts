import { type Highlighter, createHighlighter } from "shiki";

const BUNDLED_LANGS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "json",
  "bash",
  "shell",
  "sh",
  "md",
  "markdown",
  "py",
  "python",
  "go",
  "rust",
  "java",
  "c",
  "cpp",
  "html",
  "css",
  "yaml",
  "yml",
  "dockerfile",
  "diff",
  "sql",
  "toml",
  "ini",
  "xml",
] as const;

export type SupportedLang = (typeof BUNDLED_LANGS)[number] | "text" | (string & {});

let highlighterPromise: Promise<Highlighter> | null = null;
const loadedLangs = new Set<string>(["text"]);

function normalizeLang(raw: string): string {
  const l = raw.toLowerCase();
  if (l === "shell" || l === "bash") return "bash";
  if (l === "yml") return "yaml";
  if (l === "python") return "py";
  if (l === "markdown") return "md";
  if (l === "jsx") return "jsx";
  if (l === "tsx") return "tsx";
  if (l === "rs") return "rust";
  if (l === "cc" || l === "cxx" || l === "hpp" || l === "hh" || l === "hxx") return "cpp";
  if (l === "h") return "cpp";
  return l;
}

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["dark-plus", "light-plus"],
      langs: ["ts", "tsx", "js", "jsx", "json", "bash", "md", "py", "diff"],
    });
    for (const l of ["ts", "tsx", "js", "jsx", "json", "bash", "md", "py", "diff"]) {
      loadedLangs.add(l);
    }
  }
  return highlighterPromise;
}

async function ensureLang(hi: Highlighter, lang: string): Promise<string> {
  const norm = normalizeLang(lang);
  if (loadedLangs.has(norm)) return norm;
  if (!BUNDLED_LANGS.includes(norm as (typeof BUNDLED_LANGS)[number])) {
    return "text";
  }
  try {
    await hi.loadLanguage(norm as never);
    loadedLangs.add(norm);
    return norm;
  } catch {
    return "text";
  }
}

export async function highlightToHtml(
  code: string,
  lang: SupportedLang,
  theme: "light" | "dark" = "dark",
): Promise<string> {
  const hi = await getHighlighter();
  const useLang = await ensureLang(hi, String(lang));
  return hi.codeToHtml(code, {
    lang: useLang,
    theme: theme === "light" ? "light-plus" : "dark-plus",
  });
}
