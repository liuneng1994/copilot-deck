const GENERATED_DIRS = /(?:^|\/)(?:node_modules|dist|build|\.next|target|coverage|\.turbo)(?:\/|$)/;
const LOCK_FILES = /(?:^|\/)(?:[^/]*\.lock|[^/]*-lock\.(?:json|ya?ml))$/i;
const MINIFIED_FILES = /\.min\.(?:js|css|mjs)$/i;
const PROTOBUF_FILES = /_pb\.(?:go|ts|js|py)$/i;
const GENERATED_FILES = /_generated\.(?:ts|js|go|py)$/i;
const DECLARATION_FILE = /\.d\.ts$/i;
const SOURCE_ROOT_DECLARATION = /^(?:src\/|packages\/[^/]+\/src\/|lib\/|app\/)/;

function normalizeRelPath(relPath: string): string {
  return relPath.replace(/\\+/g, "/").replace(/^\.\/+/, "");
}

export function isGeneratedFile(relPath: string): boolean {
  const normalized = normalizeRelPath(relPath);
  if (GENERATED_DIRS.test(normalized)) return true;
  if (LOCK_FILES.test(normalized)) return true;
  if (MINIFIED_FILES.test(normalized)) return true;
  if (PROTOBUF_FILES.test(normalized)) return true;
  if (GENERATED_FILES.test(normalized)) return true;
  if (DECLARATION_FILE.test(normalized)) return !SOURCE_ROOT_DECLARATION.test(normalized);
  return false;
}
