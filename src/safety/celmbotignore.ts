import fs from "node:fs";
import path from "node:path";
import { minimatch } from "minimatch";

export function loadIgnorePatterns(projectRoot: string): string[] {
  const file = path.join(projectRoot, ".celmbotignore");
  if (!fs.existsSync(file)) return ["node_modules/**", ".git/**", "dist/**", "coverage/**"];
  const text = fs.readFileSync(file, "utf8");
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  return [...new Set(["node_modules/**", ".git/**", ...lines])];
}

export function isIgnored(relPath: string, patterns: string[]): boolean {
  const norm = relPath.split(path.sep).join("/");
  return patterns.some((p) => minimatch(norm, p, { dot: true }));
}
