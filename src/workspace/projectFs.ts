import fs from "node:fs";
import path from "node:path";
import {
  assertReadAllowed,
  isProtectedPath,
  PathJailError,
  resolveInJail,
} from "../safety/pathGuard.js";
import { isIgnored, loadIgnorePatterns } from "../safety/celmbotignore.js";

export interface FsEntry {
  name: string;
  path: string;
  type: "file" | "dir";
}

export function assertEditorWrite(projectRoot: string, userPath: string): string {
  const abs = resolveInJail(projectRoot, userPath);
  if (isProtectedPath(projectRoot, abs)) {
    throw new PathJailError(`protected path: ${userPath}`);
  }
  return abs;
}

export function listEntries(projectRoot: string, userPath = "."): FsEntry[] {
  const abs = assertReadAllowed(projectRoot, userPath === "" ? "." : userPath);
  const patterns = loadIgnorePatterns(projectRoot);
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  const out: FsEntry[] = [];
  for (const e of entries) {
    if (e.name === ".git") continue;
    const rel = path.relative(projectRoot, path.join(abs, e.name)).split(path.sep).join("/");
    if (isIgnored(rel, patterns)) continue;
    out.push({
      name: e.name,
      path: rel,
      type: e.isDirectory() ? "dir" : "file",
    });
  }
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

export function readProjectFile(
  projectRoot: string,
  userPath: string,
  maxChars = 2_000_000
): { path: string; content: string; truncated: boolean } {
  const abs = assertReadAllowed(projectRoot, userPath);
  const patterns = loadIgnorePatterns(projectRoot);
  const rel = path.relative(projectRoot, abs).split(path.sep).join("/");
  if (isIgnored(rel, patterns)) throw new PathJailError(`ignored by .celmbotignore: ${userPath}`);
  const st = fs.statSync(abs);
  if (!st.isFile()) throw new PathJailError(`not a file: ${userPath}`);
  if (st.size > maxChars * 2) {
    throw new PathJailError(`file too large to open in editor (${st.size} bytes)`);
  }
  let content = fs.readFileSync(abs, "utf8");
  if (content.includes("\0")) throw new PathJailError(`binary file: ${userPath}`);
  let truncated = false;
  if (content.length > maxChars) {
    content = content.slice(0, maxChars);
    truncated = true;
  }
  return { path: rel, content, truncated };
}

export function writeProjectFile(
  projectRoot: string,
  userPath: string,
  content: string
): { path: string; created: boolean } {
  const abs = assertEditorWrite(projectRoot, userPath);
  const rel = path.relative(projectRoot, abs).split(path.sep).join("/");
  const created = !fs.existsSync(abs);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return { path: rel, created };
}

export function languageFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".json": "json",
    ".md": "markdown",
    ".css": "css",
    ".scss": "scss",
    ".html": "html",
    ".htm": "html",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".sh": "shell",
    ".toml": "ini",
    ".ini": "ini",
    ".txt": "plaintext",
  };
  return map[ext] ?? "plaintext";
}
