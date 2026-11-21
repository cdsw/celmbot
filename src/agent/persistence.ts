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
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as RunState;
  return normalizeRunState(raw);
}

function normalizeRunState(s: RunState): RunState {
  if (!Array.isArray(s.pendingApprovals)) s.pendingApprovals = s.pendingApproval ? [s.pendingApproval] : [];
  if (!s.activeAgentId) s.activeAgentId = s.agents?.[0]?.id ?? "solo-1";
  for (const p of s.pendingApprovals) {
    if (!p.agentId) p.agentId = s.activeAgentId;
  }
  if (s.pendingApproval && !s.pendingApproval.agentId) s.pendingApproval.agentId = s.activeAgentId;
  for (const a of s.agents ?? []) {
    if (!Array.isArray(a.messages)) a.messages = [];
    if (typeof a.step !== "number") a.step = 0;
    if (typeof a.maxSteps !== "number") a.maxSteps = s.maxSteps ?? 15;
    if (!Array.isArray(a.filesTouched)) a.filesTouched = [];
    if (typeof a.verifyPassed !== "boolean") a.verifyPassed = false;
  }
  if (!Array.isArray(s.messages)) s.messages = [];
  return s;
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

/** Mark in-flight runs as interrupted after a process restart (no auto-resume). */
export function markInterruptedRuns(): number {
  let n = 0;
  for (const row of listRuns()) {
    const s = loadRun(row.id);
    if (!s) continue;
    if (s.status === "running" || s.status === "aggregating" || s.status === "rate_limited") {
      s.status = "interrupted";
      for (const a of s.agents ?? []) {
        if (a.status === "running" || a.status === "aggregating") a.status = "interrupted";
      }
      saveRun(s);
      n += 1;
    }
  }
  return n;
}
