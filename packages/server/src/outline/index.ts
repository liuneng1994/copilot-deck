import { readFile } from "node:fs/promises";
import path from "node:path";
import type { OutlineNode } from "@agent-view/shared";

const MAX_CACHE_ENTRIES = 100;
const outlineCache = new Map<string, OutlineNode[] | null>();

export function detectOutlineLanguage(absPath: string): string | null {
  const ext = path.extname(absPath).toLowerCase();
  switch (ext) {
    case ".ts":
    case ".mts":
    case ".cts":
      return "typescript";
    case ".tsx":
      return "tsx";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".jsx":
      return "javascript";
    case ".py":
      return "python";
    case ".go":
      return "go";
    case ".rs":
      return "rust";
    case ".java":
      return "java";
    case ".c":
    case ".cc":
    case ".cpp":
    case ".cxx":
    case ".h":
    case ".hh":
    case ".hpp":
    case ".hxx":
      return "cpp";
    case ".rb":
      return "ruby";
    default:
      return null;
  }
}

export async function getOutline(absPath: string, mtimeMs = 0): Promise<OutlineNode[] | null> {
  const key = `${absPath}|${mtimeMs}`;
  if (outlineCache.has(key)) {
    const cached = outlineCache.get(key) ?? null;
    outlineCache.delete(key);
    outlineCache.set(key, cached);
    return cached;
  }

  const language = detectOutlineLanguage(absPath);
  const source = await readFile(absPath, "utf8");
  const nodes = language == null ? null : parseHeuristicOutline(source, language);
  setCached(key, nodes);
  return nodes;
}

function setCached(key: string, nodes: OutlineNode[] | null): void {
  outlineCache.set(key, nodes);
  while (outlineCache.size > MAX_CACHE_ENTRIES) {
    const oldest = outlineCache.keys().next().value;
    if (oldest === undefined) return;
    outlineCache.delete(oldest);
  }
}

function parseHeuristicOutline(source: string, language: string): OutlineNode[] | null {
  switch (language) {
    case "typescript":
    case "tsx":
    case "javascript":
      return parseTypeScriptLike(source);
    case "python":
      return parsePython(source);
    case "go":
      return parseGo(source);
    case "rust":
      return parseRust(source);
    case "java":
      return parseJava(source);
    case "cpp":
      return parseCpp(source);
    default:
      return null;
  }
}

function parseTypeScriptLike(source: string): OutlineNode[] {
  const lines = source.split(/\r?\n/);
  const nodes: OutlineNode[] = [];
  const declaration =
    /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:(async)\s+)?(function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
  const variableFunction =
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/;
  const method =
    /^\s*(?:(?:public|private|protected|static|abstract|async|override|readonly|get|set)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]+>)?\([^)]*\)\s*(?::[^={]+)?\{/;
  const skipMethods = new Set(["if", "for", "while", "switch", "catch", "function"]);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const indent = leadingSpaces(line);
    const declarationMatch = declaration.exec(line);
    if (declarationMatch) {
      const kind =
        declarationMatch[2] === "function" && declarationMatch[1]
          ? "async function"
          : declarationMatch[2];
      nodes.push(makeNode(kind, declarationMatch[3], index, estimateBraceEnd(lines, index)));
      continue;
    }

    const variableMatch = variableFunction.exec(line);
    if (variableMatch) {
      nodes.push(makeNode("function", variableMatch[1], index, estimateBraceEnd(lines, index)));
      continue;
    }

    if (indent > 0 && indent <= 4) {
      const methodMatch = method.exec(line);
      if (methodMatch && !skipMethods.has(methodMatch[1])) {
        nodes.push(makeNode("method", methodMatch[1], index, estimateBraceEnd(lines, index)));
      }
    }
  }

  return nodes;
}

function parsePython(source: string): OutlineNode[] {
  const lines = source.split(/\r?\n/);
  const nodes: OutlineNode[] = [];
  const declaration = /^\s*(async\s+def|def|class)\s+([A-Za-z_][\w]*)/;

  for (let index = 0; index < lines.length; index += 1) {
    const match = declaration.exec(lines[index]);
    if (!match) continue;
    nodes.push(makeNode(match[1], match[2], index, estimateIndentEnd(lines, index)));
  }

  return nodes;
}

function parseGo(source: string): OutlineNode[] {
  const lines = source.split(/\r?\n/);
  const nodes: OutlineNode[] = [];
  const funcDecl = /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\(/;
  const typeDecl = /^\s*type\s+([A-Za-z_][\w]*)\s+(struct|interface)\b/;

  for (let index = 0; index < lines.length; index += 1) {
    const funcMatch = funcDecl.exec(lines[index]);
    if (funcMatch) {
      nodes.push(makeNode("function", funcMatch[1], index, estimateBraceEnd(lines, index)));
      continue;
    }
    const typeMatch = typeDecl.exec(lines[index]);
    if (typeMatch) {
      nodes.push(makeNode(typeMatch[2], typeMatch[1], index, estimateBraceEnd(lines, index)));
    }
  }

  return nodes;
}

function parseRust(source: string): OutlineNode[] {
  const lines = source.split(/\r?\n/);
  const nodes: OutlineNode[] = [];
  const declaration =
    /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(fn|struct|enum|trait|impl)\s+([A-Za-z_][\w]*)?/;

  for (let index = 0; index < lines.length; index += 1) {
    const match = declaration.exec(lines[index]);
    if (!match) continue;
    const name = match[2] ?? "impl";
    nodes.push(makeNode(match[1], name, index, estimateBraceEnd(lines, index)));
  }

  return nodes;
}

function parseJava(source: string): OutlineNode[] {
  const lines = source.split(/\r?\n/);
  const nodes: OutlineNode[] = [];
  const typeDecl =
    /^\s*(?:public|protected|private|abstract|final|sealed|non-sealed|static|\s)*\s*(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/;
  const methodDecl =
    /^\s*(?:@\w+(?:\([^)]*\))?\s*)*(?:public|protected|private|static|final|abstract|synchronized|native|strictfp|\s)+[\w$<>\[\], ?&.]+\s+([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?:throws [^{]+)?\{/;
  const skip = new Set(["if", "for", "while", "switch", "catch", "try", "return", "new"]);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const typeMatch = typeDecl.exec(line);
    if (typeMatch) {
      nodes.push(makeNode(typeMatch[1], typeMatch[2], index, estimateBraceEnd(lines, index)));
      continue;
    }

    const methodMatch = methodDecl.exec(line);
    if (methodMatch && !skip.has(methodMatch[1])) {
      nodes.push(makeNode("method", methodMatch[1], index, estimateBraceEnd(lines, index)));
    }
  }

  return nodes;
}

function parseCpp(source: string): OutlineNode[] {
  const lines = source.split(/\r?\n/);
  const nodes: OutlineNode[] = [];
  const typeDecl = /^\s*(?:template\s*<[^>]+>\s*)?(class|struct|enum)\s+([A-Za-z_]\w*)/;
  const namespaceDecl = /^\s*namespace\s+([A-Za-z_]\w*)\s*\{/;
  const functionDecl =
    /^\s*(?:template\s*<[^>]+>\s*)?(?:[\w:<>,~*&\s]+\s+)?([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*|operator[^\s(]+)\s*\([^;{}]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:->\s*[\w:<>,~*&\s]+)?\{/;
  const skip = new Set(["if", "for", "while", "switch", "catch", "return"]);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const typeMatch = typeDecl.exec(line);
    if (typeMatch) {
      nodes.push(makeNode(typeMatch[1], typeMatch[2], index, estimateBraceEnd(lines, index)));
      continue;
    }
    const namespaceMatch = namespaceDecl.exec(line);
    if (namespaceMatch) {
      nodes.push(makeNode("namespace", namespaceMatch[1], index, estimateBraceEnd(lines, index)));
      continue;
    }
    const functionMatch = functionDecl.exec(line);
    const name = functionMatch?.[1]?.split("::").pop() ?? "";
    if (functionMatch && name && !skip.has(name)) {
      nodes.push(makeNode("function", functionMatch[1], index, estimateBraceEnd(lines, index)));
    }
  }

  return nodes;
}

function makeNode(kind: string, name: string, startIndex: number, endLine: number): OutlineNode {
  return {
    kind: "heuristic",
    name: `${kind} ${name}`,
    startLine: startIndex + 1,
    endLine,
  };
}

function estimateBraceEnd(lines: string[], startIndex: number): number {
  let depth = 0;
  let sawBrace = false;

  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    for (const char of line) {
      if (char === "{") {
        depth += 1;
        sawBrace = true;
      } else if (char === "}") {
        depth -= 1;
      }
    }
    if (sawBrace && depth <= 0) return index + 1;
  }

  return startIndex + 1;
}

function estimateIndentEnd(lines: string[], startIndex: number): number {
  const startIndent = leadingSpaces(lines[startIndex]);
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("@")) continue;
    if (leadingSpaces(lines[index]) <= startIndent) return index;
  }
  return lines.length;
}

function leadingSpaces(line: string): number {
  const match = /^\s*/.exec(line);
  return match?.[0].length ?? 0;
}
