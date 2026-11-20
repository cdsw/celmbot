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
  content: string,
  opts?: { createOnly?: boolean }
): { path: string; created: boolean } {
  const abs = assertEditorWrite(projectRoot, userPath);
  const rel = path.relative(projectRoot, abs).split(path.sep).join("/");
  const exists = fs.existsSync(abs);
  if (opts?.createOnly && exists) {
    throw new PathJailError(`already exists: ${userPath}`);
  }
  if (exists && fs.statSync(abs).isDirectory()) {
    throw new PathJailError(`is a directory: ${userPath}`);
  }
  const created = !exists;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
  return { path: rel, created };
}

export function mkdirProjectDir(
  projectRoot: string,
  userPath: string
): { path: string; created: boolean } {
  const abs = assertEditorWrite(projectRoot, userPath);
  const rel = path.relative(projectRoot, abs).split(path.sep).join("/");
  if (fs.existsSync(abs)) {
    const st = fs.statSync(abs);
    if (!st.isDirectory()) throw new PathJailError(`not a directory: ${userPath}`);
    throw new PathJailError(`already exists: ${userPath}`);
  }
  fs.mkdirSync(abs, { recursive: true });
  return { path: rel, created: true };
}

export function deleteProjectPath(
  projectRoot: string,
  userPath: string
): { path: string; type: "file" | "dir" } {
  const abs = assertEditorWrite(projectRoot, userPath);
  const rel = path.relative(projectRoot, abs).split(path.sep).join("/");
  if (!rel || rel === ".") {
    throw new PathJailError("cannot delete project root");
  }
  if (!fs.existsSync(abs)) throw new PathJailError(`path does not exist: ${userPath}`);
  const st = fs.statSync(abs);
  if (st.isDirectory()) {
    fs.rmSync(abs, { recursive: true, force: false });
    return { path: rel, type: "dir" };
  }
  fs.unlinkSync(abs);
  return { path: rel, type: "file" };
}

export function moveProjectPath(
  projectRoot: string,
  fromPath: string,
  toPath: string
): { from: string; to: string; type: "file" | "dir" } {
  const fromAbs = assertEditorWrite(projectRoot, fromPath);
  const toAbs = assertEditorWrite(projectRoot, toPath);
  const fromRel = path.relative(projectRoot, fromAbs).split(path.sep).join("/");
  const toRel = path.relative(projectRoot, toAbs).split(path.sep).join("/");
  if (!fromRel || fromRel === ".") throw new PathJailError("cannot move project root");
  if (!toRel || toRel === ".") throw new PathJailError("invalid destination");
  if (!fs.existsSync(fromAbs)) throw new PathJailError(`path does not exist: ${fromPath}`);
  if (fromAbs === toAbs) return { from: fromRel, to: toRel, type: fs.statSync(fromAbs).isDirectory() ? "dir" : "file" };

  const fromSt = fs.statSync(fromAbs);
  if (fromSt.isDirectory()) {
    const prefix = fromAbs.endsWith(path.sep) ? fromAbs : fromAbs + path.sep;
    if (toAbs === fromAbs || toAbs.startsWith(prefix)) {
      throw new PathJailError("cannot move a folder into itself");
    }
  }
  if (fs.existsSync(toAbs)) throw new PathJailError(`already exists: ${toPath}`);
  fs.mkdirSync(path.dirname(toAbs), { recursive: true });
  fs.renameSync(fromAbs, toAbs);
  return { from: fromRel, to: toRel, type: fromSt.isDirectory() ? "dir" : "file" };
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
