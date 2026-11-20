import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function getDataDir(): string {
  if (process.env.CELMBOT_CONFIG_DIR) {
    return path.resolve(process.env.CELMBOT_CONFIG_DIR);
  }
  return path.join(os.homedir(), ".celmbot");
}

export function ensureDataDir(): string {
  const dir = getDataDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "runs"), { recursive: true });
  return dir;
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
