import fs from "node:fs";
import path from "node:path";
import type { RunState } from "../shared/types.js";
import { ensureDataDir, runDir } from "../paths.js";

export function saveRun(state: RunState): void {
  ensureDataDir();
  const dir = runDir(state.id);
  fs.mkdirSync(dir, { recursive: true });
  state.updatedAt = Date.now();
  fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify(state, null, 2));
}

export function loadRun(runId: string): RunState | null {
  const file = path.join(runDir(runId), "state.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as RunState;
}

export function listRuns(): Array<{ id: string; updatedAt: number; status: string; task: string }> {
  ensureDataDir();
  const root = path.join(ensureDataDir(), "runs");
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .map((id) => {
      const s = loadRun(id);
      if (!s) return null;
      return { id: s.id, updatedAt: s.updatedAt, status: s.status, task: s.task };
    })
    .filter(Boolean)
    .sort((a, b) => b!.updatedAt - a!.updatedAt) as Array<{
    id: string;
    updatedAt: number;
    status: string;
    task: string;
  }>;
}
