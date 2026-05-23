import type { GitFlag, GitStatus } from "@agent-view/shared";

function toGitFlag(raw: string | undefined): GitFlag {
  if (!raw || raw === ".") return " ";
  return raw as GitFlag;
}

function splitFields(record: string, maxSplits: number): string[] {
  const fields: string[] = [];
  let rest = record;
  for (let i = 0; i < maxSplits; i++) {
    const idx = rest.indexOf(" ");
    if (idx === -1) break;
    fields.push(rest.slice(0, idx));
    rest = rest.slice(idx + 1);
  }
  fields.push(rest);
  return fields;
}

function parseAheadBehind(raw: string | undefined): { ahead: number; behind: number } {
  if (!raw) return { ahead: 0, behind: 0 };
  const match = raw.match(/^\+(\d+)\s+-(\d+)$/);
  if (!match) return { ahead: 0, behind: 0 };
  return { ahead: Number(match[1]), behind: Number(match[2]) };
}

export function parseGitStatus(output: string, cwd = ""): GitStatus {
  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;
  const files: GitStatus["files"] = [];
  const records = output.split("\0");

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;

    if (record.startsWith("# branch.head ")) {
      const head = record.slice("# branch.head ".length).trim();
      branch = head && head !== "(detached)" ? head : null;
      continue;
    }

    if (record.startsWith("# branch.ab ")) {
      ({ ahead, behind } = parseAheadBehind(record.slice("# branch.ab ".length).trim()));
      continue;
    }

    if (record.startsWith("? ")) {
      files.push({ path: record.slice(2), x: "?", y: "?" });
      continue;
    }

    if (record.startsWith("! ")) {
      files.push({ path: record.slice(2), x: "!", y: "!" });
      continue;
    }

    if (record.startsWith("1 ")) {
      const fields = splitFields(record, 8);
      const xy = fields[1] ?? "..";
      const filePath = fields[8];
      if (filePath) files.push({ path: filePath, x: toGitFlag(xy[0]), y: toGitFlag(xy[1]) });
      continue;
    }

    if (record.startsWith("2 ")) {
      const fields = splitFields(record, 9);
      const xy = fields[1] ?? "..";
      const filePath = fields[9];
      const orig = records[i + 1] || undefined;
      if (orig !== undefined) i += 1;
      if (filePath) {
        files.push({ path: filePath, orig, x: toGitFlag(xy[0]), y: toGitFlag(xy[1]) });
      }
    }
  }

  return { cwd, branch, ahead, behind, files, isRepo: true };
}
