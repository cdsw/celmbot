import { randomUUID } from "node:crypto";
import type { RunScopes, RunState } from "../shared/types.js";
import { createOrchestratorAgent, createWorkerAgent } from "./agents.js";
import { createRun, emit, type EventSink } from "./loop.js";
import { saveRun } from "./persistence.js";
import {
  admitParallelCount,
  assertDisjointWrites,
  finalizeAggregate,
  runSharedVerify,
  runVerifierAgent,
  runWorkersParallel,
  runWorkersSequential,
} from "./scheduler.js";
import { V01 } from "../features/flags.js";

/**
 * Create an orchestrated run: one coordinator row + N scoped workers.
 * Workers are scheduled by startOrchestrated (sequential by default; bounded
 * parallel when V01.swarm and disjoint write globs).
 */
export function createOrchestratedRun(opts: {
  task: string;
  scopes: RunScopes;
  workerGlobs: string[][];
  verifyRecipe?: string;
  skillIds?: string[];
}): RunState {
  const workerMaxSteps = 10;
  const parent = createRun({
    ...opts,
    mode: "orchestrated",
    maxSteps: workerMaxSteps * Math.max(1, opts.workerGlobs.length) + 8,
  });
  const orch = createOrchestratorAgent(opts.task);
  orch.status = "running";
  const workers = opts.workerGlobs.map((globs, i) =>
    createWorkerAgent({
      id: `worker-${i + 1}`,
      writeAllow: globs.length ? globs : opts.scopes.writeAllow,
      brief: `Worker ${i + 1} slice of: ${opts.task}\nWrite only under: ${(globs.length ? globs : opts.scopes.writeAllow).join(", ")}`,
      maxSteps: workerMaxSteps,
    })
  );
  parent.agents = [orch, ...workers];
  parent.activeAgentId = workers[0]?.id ?? orch.id;
  parent.messages = workers[0]?.messages ?? orch.messages;
  parent.maxSteps = workerMaxSteps * workers.length + 8;
  saveRun(parent);
  return parent;
}

export async function startOrchestrated(state: RunState, sink: EventSink): Promise<RunState> {
  const workers = state.agents.filter((a) => a.role === "worker");
  emit(state, sink, {
    type: "status",
    message: `orchestrated: ${workers.length} workers registered / swarm=${V01.swarm}`,
    data: {
      workerCount: workers.length,
      admit: admitParallelCount(),
      swarm: V01.swarm,
    },
  });

  const orch = state.agents.find((a) => a.role === "orchestrator");
  if (orch) orch.status = "done";

  let current = state;
  const canParallel = V01.swarm && workers.length > 1 && admitParallelCount() > 1 && !assertDisjointWrites(state);

  if (canParallel) {
    emit(current, sink, {
      type: "status",
      message: `bounded parallel admission=${admitParallelCount()} (disjoint scopes)`,
    });
    current = await runWorkersParallel(current, sink);
  } else {
    if (workers.length > 1 && assertDisjointWrites(state)) {
      emit(current, sink, {
        type: "status",
        message: "running workers sequentially (overlapping write scopes or single key)",
      });
    }
    current = await runWorkersSequential(current, sink);
  }

  if (current.status === "waiting_approval" || current.status === "paused") {
    return current;
  }

  current = await runSharedVerify(current, sink);
  current = await runVerifierAgent(current, sink);
  current = await finalizeAggregate(current, sink);
  return current;
}

export function splitDefaultWorkerGlobs(writeAllow: string[], n: number): string[][] {
  if (n <= 1) return [writeAllow];
  return Array.from({ length: n }, () => [...writeAllow]);
}

export function newWorkerId(): string {
  return `worker-${randomUUID().slice(0, 8)}`;
}
