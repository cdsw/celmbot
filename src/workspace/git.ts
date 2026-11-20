import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PathJailError, resolveInJail } from "../safety/pathGuard.js";

export interface GitResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

export interface GitStatusEntry {
  path: string;
  index: string;
  worktree: string;
  status: string;
}

export interface GitStatus {
  isRepo: boolean;
  branch?: string;
  ahead?: number;
  behind?: number;
  entries: GitStatusEntry[];
  raw?: string;
}

function runGit(projectRoot: string, args: string[], input?: string): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd: projectRoot,
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, code: -1, stdout, stderr: stderr || "git timed out" });
    }, 20_000);
    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: -1, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: (code ?? 1) === 0, code: code ?? 1, stdout, stderr });
    });
    if (input != null) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

export function isGitRepo(projectRoot: string): boolean {
  return fs.existsSync(path.join(projectRoot, ".git"));
}

function assertRelPaths(projectRoot: string, paths: string[]): string[] {
  return paths.map((p) => {
    const abs = resolveInJail(projectRoot, p);
    return path.relative(projectRoot, abs).split(path.sep).join("/");
  });
}

function parseStatusPorcelain(raw: string): GitStatusEntry[] {
  const entries: GitStatusEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.length < 4) continue;
    const index = line[0] ?? " ";
    const worktree = line[1] ?? " ";
    let filePath = line.slice(3);
    if (filePath.startsWith('"') && filePath.endsWith('"')) {
      filePath = filePath.slice(1, -1).replace(/\\"/g, '"');
    }
    if (filePath.includes(" -> ")) {
      filePath = filePath.split(" -> ").pop() ?? filePath;
    }
    const status =
      index === "?" && worktree === "?"
        ? "untracked"
        : index !== " " && worktree !== " "
          ? "staged+modified"
          : index !== " "
            ? "staged"
            : "modified";
    entries.push({ path: filePath, index, worktree, status });
  }
  return entries;
}

export async function gitStatus(projectRoot: string): Promise<GitStatus> {
  if (!isGitRepo(projectRoot)) {
    return { isRepo: false, entries: [] };
  }
  const branchRes = await runGit(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const statusRes = await runGit(projectRoot, ["status", "--porcelain=v1", "-b"]);
  const lines = statusRes.stdout.split(/\r?\n/).filter(Boolean);
  let ahead = 0;
  let behind = 0;
  let branch = branchRes.stdout.trim() || undefined;
  if (lines[0]?.startsWith("## ")) {
    const header = lines[0].slice(3);
    const name = header.split("...")[0]?.split(" ")[0];
    if (name) branch = name;
    const aheadM = /ahead (\d+)/.exec(header);
    const behindM = /behind (\d+)/.exec(header);
    if (aheadM) ahead = Number(aheadM[1]);
    if (behindM) behind = Number(behindM[1]);
  }
  const body = lines.filter((l) => !l.startsWith("## ")).join("\n");
  return {
    isRepo: true,
    branch,
    ahead,
    behind,
    entries: parseStatusPorcelain(body),
    raw: statusRes.stdout,
  };
}

export async function gitDiff(
  projectRoot: string,
  opts?: { staged?: boolean; path?: string }
): Promise<GitResult> {
  if (!isGitRepo(projectRoot)) {
    return { ok: false, code: 1, stdout: "", stderr: "not a git repository" };
  }
  const args = ["diff", "--no-color"];
  if (opts?.staged) args.push("--cached");
  if (opts?.path) {
    const rel = assertRelPaths(projectRoot, [opts.path])[0];
    args.push("--", rel);
  }
  return runGit(projectRoot, args);
}

export async function gitLog(projectRoot: string, limit = 20): Promise<GitResult> {
  if (!isGitRepo(projectRoot)) {
    return { ok: false, code: 1, stdout: "", stderr: "not a git repository" };
  }
  return runGit(projectRoot, [
    "log",
    `-n${Math.min(Math.max(limit, 1), 50)}`,
    "--pretty=format:%h%x09%an%x09%ar%x09%s",
  ]);
}

export async function gitBranches(projectRoot: string): Promise<{ current?: string; branches: string[] }> {
  if (!isGitRepo(projectRoot)) return { branches: [] };
  const res = await runGit(projectRoot, ["branch", "--list", "--format=%(refname:short)%09%(HEAD)"]);
  const branches: string[] = [];
  let current: string | undefined;
  for (const line of res.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [name, head] = line.split("\t");
    if (!name) continue;
    branches.push(name);
    if (head === "*") current = name;
  }
  if (!current) {
    const cur = await runGit(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
    current = cur.stdout.trim() || undefined;
  }
  return { current, branches };
}

export async function gitAdd(projectRoot: string, paths: string[]): Promise<GitResult> {
  if (!isGitRepo(projectRoot)) {
    return { ok: false, code: 1, stdout: "", stderr: "not a git repository" };
  }
  if (!paths.length) throw new PathJailError("paths required");
  const rels = assertRelPaths(projectRoot, paths);
  return runGit(projectRoot, ["add", "--", ...rels]);
}

export async function gitRestore(
  projectRoot: string,
  paths: string[],
  opts?: { staged?: boolean }
): Promise<GitResult> {
  if (!isGitRepo(projectRoot)) {
    return { ok: false, code: 1, stdout: "", stderr: "not a git repository" };
  }
  if (!paths.length) throw new PathJailError("paths required");
  const rels = assertRelPaths(projectRoot, paths);
  const args = opts?.staged ? ["restore", "--staged", "--", ...rels] : ["restore", "--", ...rels];
  return runGit(projectRoot, args);
}

export async function gitCommit(projectRoot: string, message: string): Promise<GitResult> {
  if (!isGitRepo(projectRoot)) {
    return { ok: false, code: 1, stdout: "", stderr: "not a git repository" };
  }
  const msg = message.trim();
  if (!msg) throw new PathJailError("commit message required");
  if (msg.length > 2000) throw new PathJailError("commit message too long");
  return runGit(projectRoot, ["commit", "-m", msg]);
}

export async function gitCheckoutBranch(projectRoot: string, branch: string): Promise<GitResult> {
  if (!isGitRepo(projectRoot)) {
    return { ok: false, code: 1, stdout: "", stderr: "not a git repository" };
  }
  if (!/^[\w./@+-]+$/.test(branch)) {
    throw new PathJailError(`invalid branch name: ${branch}`);
  }
  return runGit(projectRoot, ["checkout", branch]);
}

export async function gitInit(projectRoot: string): Promise<GitResult> {
  if (isGitRepo(projectRoot)) {
    return { ok: true, code: 0, stdout: "already a git repository", stderr: "" };
  }
  return runGit(projectRoot, ["init"]);
}
