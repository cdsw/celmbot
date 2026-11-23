import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * CelmBot install root (the freecel/ package), not the workspace the user opens
 * for editing. Walk up from this module until package.json name matches.
 */
export function getInstallRoot(): string {
  let dir = here;
  for (let i = 0; i < 6; i++) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg)) {
      try {
        const name = (JSON.parse(fs.readFileSync(pkg, "utf8")) as { name?: string }).name;
        if (name === "celmbot") return dir;
      } catch {
        /* keep walking */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: src/ or dist/ → parent
  return path.resolve(here, "..");
}

/** Active editor workspace (jail root for agent FS). Separate from install data dir. */
let workspaceRoot = path.resolve(process.cwd());

export function getProjectRoot(): string {
  return workspaceRoot;
}

export function setProjectRoot(root: string): string {
  const resolved = path.resolve(root);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`project root is not a directory: ${root}`);
  }
  workspaceRoot = resolved;
  return workspaceRoot;
}

/**
 * Config, keys, sessions, runs, and caches for this CelmBot installation.
 * Lives under `<freecel>/.celmbot/` — shared across opened workspaces, never `~/.celmbot`.
 * Tests may override with CELMBOT_CONFIG_DIR.
 */
export function getDataDir(): string {
  if (process.env.CELMBOT_CONFIG_DIR) {
    return path.resolve(process.env.CELMBOT_CONFIG_DIR);
  }
  return path.join(getInstallRoot(), ".celmbot");
}

export function ensureDataDir(): string {
  const dir = getDataDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "runs"), { recursive: true });
  fs.mkdirSync(path.join(dir, "sessions"), { recursive: true });
  return dir;
}

export function sessionDir(): string {
  return path.join(getDataDir(), "sessions");
}

export function sessionPath(sessionId: string): string {
  return path.join(sessionDir(), `${sessionId}.json`);
}

export function configPath(): string {
  return path.join(getDataDir(), "config.json");
}

export function statsPath(): string {
  return path.join(getDataDir(), "stats.json");
}

export function runDir(runId: string): string {
  return path.join(getDataDir(), "runs", runId);
}

export function modelsCacheDir(): string {
  const dir = path.join(getDataDir(), "models-cache");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
