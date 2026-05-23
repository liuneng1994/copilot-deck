import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SkillInfo } from "@agent-view/shared";
import { parseSkillFrontmatter } from "./parse-skills.js";

interface LockSkill {
  source?: string;
  sourceType?: string;
  skillPath?: string;
  computedHash?: string;
}

interface SkillsLock {
  version?: number;
  skills?: Record<string, LockSkill>;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readLock(cwd: string): Promise<SkillsLock> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(path.join(cwd, "skills-lock.json"), "utf8"),
    ) as SkillsLock;
    return typeof parsed === "object" && parsed !== null ? parsed : { version: 1, skills: {} };
  } catch {
    return { version: 1, skills: {} };
  }
}

async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.new`);
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tmp, file);
}

async function listSkillsUnderRoot(
  root: string,
  scope: "repo" | "global",
  cwd?: string,
  lock?: SkillsLock,
): Promise<SkillInfo[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return [];
  }

  const skills: SkillInfo[] = [];
  for (const entry of entries.sort((a, b) => a.localeCompare(b))) {
    if (entry.startsWith(".")) continue;
    const skillPath = path.join(root, entry, "SKILL.md");
    try {
      const stat = await fs.stat(skillPath);
      if (!stat.isFile()) continue;
      const fm = parseSkillFrontmatter(await fs.readFile(skillPath, "utf8"));
      const name = fm.name ?? entry;
      const locked = lock?.skills?.[name] ?? lock?.skills?.[entry];
      skills.push({
        name,
        description: fm.description,
        path: skillPath,
        scope,
        cwd,
        source: locked?.source,
        sourceType: locked?.sourceType,
        skillPath: locked?.skillPath,
        hash: locked?.computedHash,
      });
    } catch {
      // Ignore broken skill entries; other installed skills should still render.
    }
  }
  return skills;
}

export async function listRepoSkills(cwd: string): Promise<SkillInfo[]> {
  const normalized = path.resolve(cwd);
  const lock = await readLock(normalized);
  return listSkillsUnderRoot(path.join(normalized, ".agents", "skills"), "repo", normalized, lock);
}

export async function listGlobalSkills(): Promise<SkillInfo[]> {
  const roots = [
    path.join(os.homedir(), ".agents", "skills"),
    path.join(os.homedir(), ".copilot", "agents"),
  ];
  const seen = new Set<string>();
  const out: SkillInfo[] = [];
  for (const root of roots) {
    if (!(await pathExists(root))) continue;
    for (const skill of await listSkillsUnderRoot(root, "global")) {
      if (seen.has(skill.name)) continue;
      seen.add(skill.name);
      out.push(skill);
    }
  }
  return out;
}

export async function removeRepoSkill(cwd: string, name: string): Promise<void> {
  const normalized = path.resolve(cwd);
  await fs.rm(path.join(normalized, ".agents", "skills", name), { recursive: true, force: true });

  const lockPath = path.join(normalized, "skills-lock.json");
  const lock = await readLock(normalized);
  if (lock.skills && Object.prototype.hasOwnProperty.call(lock.skills, name)) {
    delete lock.skills[name];
    await atomicWriteJson(lockPath, { version: lock.version ?? 1, skills: lock.skills });
  }
}

export async function removeGlobalSkill(name: string): Promise<void> {
  await fs.rm(path.join(os.homedir(), ".agents", "skills", name), { recursive: true, force: true });
}
