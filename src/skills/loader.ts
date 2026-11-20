import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import type { SkillMeta } from "../shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function defaultSkillsDir(): string {
  return path.resolve(__dirname, "../../skills/samples");
}

function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  if (!raw.startsWith("---")) return { meta: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: raw };
  const fm = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\r?\n/, "");
  const meta = (yaml.load(fm) as Record<string, unknown>) ?? {};
  return { meta, body };
}

export function loadSkillsFromDir(dir: string): SkillMeta[] {
  if (!fs.existsSync(dir)) return [];
  const out: SkillMeta[] = [];
  function walk(d: string): void {
    for (const name of fs.readdirSync(d)) {
      const abs = path.join(d, name);
      const st = fs.statSync(abs);
      if (st.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!name.endsWith(".md")) continue;
      const raw = fs.readFileSync(abs, "utf8");
      const { meta, body } = parseFrontmatter(raw);
      const skillName = String(meta.name ?? path.basename(name, ".md"));
      out.push({
        id: skillName,
        name: skillName,
        description: String(meta.description ?? ""),
        body,
        sourcePath: abs,
        attribution: body.toLowerCase().includes("prove it works")
          ? "Inspired by Lauren Tan / pstack (MIT)"
          : undefined,
      });
    }
  }
  walk(dir);
  return out;
}

export function loadAllSkills(extraDirs: string[] = []): SkillMeta[] {
  const dirs = [defaultSkillsDir(), ...extraDirs];
  const map = new Map<string, SkillMeta>();
  for (const d of dirs) {
    for (const s of loadSkillsFromDir(d)) map.set(s.id, s);
  }
  return [...map.values()];
}
