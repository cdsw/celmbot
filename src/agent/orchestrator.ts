import { randomUUID } from "node:crypto";
import type { RunScopes, RunState } from "../shared/types.js";
import { createRun, startRun, type EventSink } from "./loop.js";
import { saveRun } from "./persistence.js";

/**
 * Sandbox orchestrator: create a parent run that fans out to N scoped worker runs sequentially
 * under the same session id prefix. Full parallel workers still share the key router.
 */
export function createOrchestratedRun(opts: {
  task: string;
  scopes: RunScopes;
  workerGlobs: string[][];
  verifyRecipe?: string;
  skillIds?: string[];
}): RunState {
  const parent = createRun({
    ...opts,
    mode: "orchestrated",
    maxSteps: 8,
  });
  parent.agents = [
    {
      id: "orch-1",
      role: "orchestrator",
      writeAllow: [],
      status: "running",
      brief: opts.task,
    },
    ...opts.workerGlobs.map((globs, i) => ({
      id: `worker-${i + 1}`,
      role: "worker" as const,
      writeAllow: globs.length ? globs : opts.scopes.writeAllow,
      status: "idle" as const,
      brief: `Worker ${i + 1} slice of: ${opts.task}`,
    })),
  ];
  saveRun(parent);
  return parent;
}

/** Run orchestrator by executing the first worker solo-style with its write scope (pilot unit). */
export async function startOrchestrated(state: RunState, sink: EventSink): Promise<RunState> {
  const worker = state.agents.find((a) => a.role === "worker");
  if (worker) {
    state.scopes = {
      ...state.scopes,
      writeAllow: worker.writeAllow,
    };
    worker.status = "running";
  }
  return startRun(state, sink);
}

export function splitDefaultWorkerGlobs(writeAllow: string[], n: number): string[][] {
  if (n <= 1) return [writeAllow];
  // Simple split: each worker gets full allowlist but distinct id — user should pass explicit globs.
  // For the sandbox, duplicate allowlist with a comment in brief; real isolation needs distinct globs from UI.
  return Array.from({ length: n }, () => [...writeAllow]);
}

export function newWorkerId(): string {
  return `worker-${randomUUID().slice(0, 8)}`;
}
