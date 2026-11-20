import fs from "node:fs";
import path from "node:path";
import { minimatch } from "minimatch";

export class PathJailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathJailError";
  }
}

function normalizeRoot(projectRoot: string): string {
  return path.resolve(projectRoot);
}

function withSep(root: string): string {
  return root.endsWith(path.sep) ? root : root + path.sep;
}

export function isInsideRoot(projectRoot: string, candidate: string): boolean {
  const root = normalizeRoot(projectRoot);
  const resolved = path.resolve(candidate);
  if (process.platform === "win32") {
    const r = root.toLowerCase();
    const c = resolved.toLowerCase();
    return c === r || c.startsWith(withSep(r).toLowerCase());
  }
  return resolved === root || resolved.startsWith(withSep(root));
}

function realExisting(p: string): string | null {
  try {
    if (!fs.existsSync(p)) return null;
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/**
 * Resolve a user path under projectRoot. Rejects escapes and symlink escapes.
 */
export function resolveInJail(
  projectRoot: string,
  userPath: string,
  opts?: { mustExist?: boolean }
): string {
  const root = normalizeRoot(projectRoot);
  const rootReal = realExisting(root) ?? root;

  if (!userPath || typeof userPath !== "string") {
    throw new PathJailError("path is required");
  }
  if (userPath.startsWith("~")) {
    throw new PathJailError(`home path not allowed: ${userPath}`);
  }

  const joined = path.isAbsolute(userPath)
    ? path.resolve(userPath)
    : path.resolve(root, userPath);

  if (!isInsideRoot(root, joined) && !isInsideRoot(rootReal, joined)) {
    throw new PathJailError(`path escapes project root: ${userPath}`);
  }

  // Project root itself (e.g. ".") — no parent walk needed
  const joinedIsRoot =
    path.resolve(joined) === root ||
    path.resolve(joined) === rootReal ||
    (realExisting(joined) != null && realExisting(joined) === rootReal);
  if (joinedIsRoot) {
    if (opts?.mustExist) {
      const real = realExisting(joined);
      if (!real) throw new PathJailError(`path does not exist: ${userPath}`);
      return real;
    }
    return realExisting(joined) ?? joined;
  }

  // Check each existing ancestor's realpath
  let cur = joined;
  while (true) {
    const real = realExisting(cur);
    if (real && !isInsideRoot(root, real) && !isInsideRoot(rootReal, real)) {
      throw new PathJailError(`symlink escapes project root: ${userPath}`);
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    if (!isInsideRoot(root, parent) && !isInsideRoot(rootReal, parent)) {
      throw new PathJailError(`path escapes project root: ${userPath}`);
    }
    cur = parent;
    if (isInsideRoot(root, cur) && (realExisting(cur) === rootReal || path.resolve(cur) === root)) break;
  }

  if (opts?.mustExist) {
    const real = realExisting(joined);
    if (!real) throw new PathJailError(`path does not exist: ${userPath}`);
    if (!isInsideRoot(root, real) && !isInsideRoot(rootReal, real)) {
      throw new PathJailError(`realpath escapes project root: ${userPath}`);
    }
    return real;
  }

  const real = realExisting(joined);
  if (real) {
    if (!isInsideRoot(root, real) && !isInsideRoot(rootReal, real)) {
      throw new PathJailError(`realpath escapes project root: ${userPath}`);
    }
    return real;
  }
  return joined;
}

export function matchesGlobs(relOrAbs: string, projectRoot: string, globs: string[]): boolean {
  if (!globs.length) return false;
  const root = normalizeRoot(projectRoot);
  const abs = path.isAbsolute(relOrAbs) ? path.resolve(relOrAbs) : path.resolve(root, relOrAbs);
  const rel = path.relative(root, abs).split(path.sep).join("/");
  return globs.some((g) => minimatch(rel, g, { dot: true, nocase: process.platform === "win32" }));
}

export const PROTECTED_GLOBS = [
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  ".git/config",
  ".git/hooks/**",
  "**/*credential*",
  "**/*secret*",
  ".celmbot/**",
];

export function isProtectedPath(projectRoot: string, userOrAbs: string): boolean {
  try {
    const abs = path.isAbsolute(userOrAbs)
      ? path.resolve(userOrAbs)
      : path.resolve(projectRoot, userOrAbs);
    return matchesGlobs(abs, projectRoot, PROTECTED_GLOBS);
  } catch {
    return /(?:^|\/|\\)\.env(?:\.|$)|(?:^|\/|\\)\.git(?:\/|\\)/.test(userOrAbs);
  }
}

export function assertWriteAllowed(
  projectRoot: string,
  userPath: string,
  writeAllow: string[]
): string {
  if (!writeAllow.length) {
    throw new PathJailError("writeAllow is empty — writes are fail-closed");
  }
  const abs = resolveInJail(projectRoot, userPath);
  if (!matchesGlobs(abs, projectRoot, writeAllow)) {
    throw new PathJailError(`write denied by allowlist: ${userPath}`);
  }
  return abs;
}

export function assertReadAllowed(
  projectRoot: string,
  userPath: string,
  readAllow?: string[]
): string {
  const abs = resolveInJail(projectRoot, userPath, { mustExist: true });
  if (readAllow && readAllow.length > 0 && !matchesGlobs(abs, projectRoot, readAllow)) {
    throw new PathJailError(`read denied by allowlist: ${userPath}`);
  }
  return abs;
}

export function assertArgvPathsInJail(projectRoot: string, args: string[]): void {
  for (const arg of args) {
    if (!arg || arg.startsWith("-")) continue;
    const looksLikePath =
      arg.includes("/") ||
      arg.includes("\\") ||
      arg.includes("..") ||
      /^[a-zA-Z]:/.test(arg) ||
      arg.startsWith("~");
    if (!looksLikePath) continue;
    resolveInJail(projectRoot, arg);
  }
}
