import fs from "node:fs";
import path from "node:path";
import {
  assertReadAllowed,
  assertWriteAllowed,
  resolveInJail,
  PathJailError,
} from "../safety/pathGuard.js";
import { isIgnored, loadIgnorePatterns } from "../safety/celmbotignore.js";

export function listDir(projectRoot: string, userPath: string, readAllow?: string[]): string[] {
  const abs = assertReadAllowed(projectRoot, userPath === "" ? "." : userPath, readAllow);
  const patterns = loadIgnorePatterns(projectRoot);
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  return entries
    .map((e) => {
      const rel = path.relative(projectRoot, path.join(abs, e.name)).split(path.sep).join("/");
      if (isIgnored(rel, patterns)) return null;
      return e.isDirectory() ? `${rel}/` : rel;
    })
    .filter(Boolean) as string[];
}

export function readFile(
  projectRoot: string,
  userPath: string,
  opts?: { maxChars?: number; readAllow?: string[] }
): string {
  const abs = assertReadAllowed(projectRoot, userPath, opts?.readAllow);
  const patterns = loadIgnorePatterns(projectRoot);
  const rel = path.relative(projectRoot, abs).split(path.sep).join("/");
  if (isIgnored(rel, patterns)) throw new PathJailError(`ignored by .celmbotignore: ${userPath}`);
  let text = fs.readFileSync(abs, "utf8");
  const max = opts?.maxChars ?? 40_000;
  if (text.length > max) text = text.slice(0, max) + "\n…[truncated]";
  return text;
}

export function writeFile(
  projectRoot: string,
  userPath: string,
  content: string,
  writeAllow: string[]
): { abs: string; rel: string; created: boolean; previous?: string } {
  const abs = assertWriteAllowed(projectRoot, userPath, writeAllow);
  const rel = path.relative(projectRoot, abs).split(path.sep).join("/");
  const created = !fs.existsSync(abs);
  let previous: string | undefined;
  if (!created) previous = fs.readFileSync(abs, "utf8");
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return { abs, rel, created, previous };
}

export function grepFiles(
  projectRoot: string,
  pattern: string,
  userPath = ".",
  readAllow?: string[]
): Array<{ file: string; line: number; text: string }> {
  const rootAbs = resolveInJail(projectRoot, userPath);
  const patterns = loadIgnorePatterns(projectRoot);
  let re: RegExp;
  try {
    re = new RegExp(pattern, "i");
  } catch {
    re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
  const hits: Array<{ file: string; line: number; text: string }> = [];

  function walk(dir: string): void {
    if (hits.length >= 50) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(projectRoot, abs).split(path.sep).join("/");
      if (isIgnored(rel, patterns)) continue;
      if (e.isDirectory()) {
        walk(abs);
        continue;
      }
      try {
        assertReadAllowed(projectRoot, rel, readAllow);
        const text = fs.readFileSync(abs, "utf8");
        if (text.includes("\0")) continue;
        const lines = text.split(/\r?\n/);
        lines.forEach((line, i) => {
          if (hits.length >= 50) return;
          if (re.test(line)) hits.push({ file: rel, line: i + 1, text: line.slice(0, 200) });
        });
      } catch {
        // skip unreadable / not allowed
      }
    }
  }

  const st = fs.statSync(rootAbs);
  if (st.isFile()) {
    const rel = path.relative(projectRoot, rootAbs).split(path.sep).join("/");
    assertReadAllowed(projectRoot, rel, readAllow);
    const text = fs.readFileSync(rootAbs, "utf8");
    text.split(/\r?\n/).forEach((line, i) => {
      if (re.test(line)) hits.push({ file: rel, line: i + 1, text: line.slice(0, 200) });
    });
  } else {
    walk(rootAbs);
  }
  return hits;
}

export function unifiedDiff(pathLabel: string, before: string | undefined, after: string): string {
  const a = (before ?? "").split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const lines = [`--- a/${pathLabel}`, `+++ b/${pathLabel}`];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const left = a[i];
    const right = b[i];
    if (left === right) continue;
    if (left !== undefined) lines.push(`-${left}`);
    if (right !== undefined) lines.push(`+${right}`);
  }
  if (lines.length === 2) lines.push("@@ no line changes (empty or identical) @@");
  return lines.join("\n");
}
