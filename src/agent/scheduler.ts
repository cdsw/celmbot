import { loadConfig, allKeys } from "../config.js";
import type { AggregateReport, RunState, WorkerReportStatus } from "../shared/types.js";
import {
  createVerifierAgent,
  findWriteOverlaps,
  getActiveAgent,
  globsOverlap,
  mergeFilesTouched,
  setActiveAgent,
} from "./agents.js";
import { emit, startRun, type EventSink } from "./loop.js";
import { saveRun } from "./persistence.js";
import { runRecipe } from "../safety/recipes.js";

export function availableCoolKeyCount(now = Date.now()): number {
  return allKeys(loadConfig()).filter(
    (k) => k.enabled && k.supportsTools !== false && (!k.cooldownUntil || k.cooldownUntil <= now)
  ).length;
}

export function admitParallelCount(): number {
  const cfg = loadConfig();
  return Math.max(1, Math.min(cfg.maxParallelWorkers, Math.max(1, availableCoolKeyCount())));
}

export function assertDisjointWrites(state: RunState): string | null {
  const workers = state.agents.filter((a) => a.role === "worker");
  for (let i = 0; i < workers.length; i++) {
    for (let j = i + 1; j < workers.length; j++) {
      if (globsOverlap(workers[i].writeAllow, workers[j].writeAllow)) {
        return `Workers ${workers[i].id} and ${workers[j].id} share write scopes; pass disjoint workerGlobs for parallel runs.`;
      }
    }
  }
  return null;
}

function workerResult(agent: {
  id: string;
  reportStatus?: WorkerReportStatus;
  issues?: string[];
  filesTouched: string[];
  status: string;
}): AggregateReport["results"][number] {
  const status: WorkerReportStatus =
    agent.reportStatus ??
    (agent.status === "error" || agent.status === "rate_limited" ? "BLOCKED" : "GAP");
  return {
    agentId: agent.id,
    status,
    issues: agent.issues ?? [],
    filesTouched: agent.filesTouched,
  };
}

export function aggregateWorkerResults(state: RunState): AggregateReport {
  const workers = state.agents.filter((a) => a.role === "worker");
  const results = workers.map(workerResult);
  const gaps = results.filter((r) => r.status === "GAP").map((r) => r.agentId);
  const overlaps = findWriteOverlaps(workers);
  return {
    results,
    gaps,
    overlaps,
    verifyPassed: false,
    summary: [
      `Workers: ${results.length}`,
      ...results.map((r) => `${r.agentId}: ${r.status}${r.issues.length ? ` (${r.issues.length} issues)` : ""}`),
      gaps.length ? `Gaps: ${gaps.join(", ")}` : "Gaps: none",
      overlaps.length ? `Write overlaps: ${overlaps.join(", ")}` : "Write overlaps: none",
    ].join("\n"),
  };
}

export async function runAgentUntilDone(state: RunState, agentId: string, sink: EventSink): Promise<RunState> {
  setActiveAgent(state, agentId);
  const agent = getActiveAgent(state);
  if (!agent) return state;
  if (agent.status === "done" || agent.status === "error") return state;
  agent.status = "running";
  state.status = "running";
  saveRun(state);
  const next = await startRun(state, sink);
  const finished = getActiveAgent(next);
  if (finished && finished.reportStatus == null && (finished.status === "done" || next.status === "done")) {
    finished.reportStatus = finished.verifyPassed ? "PASS" : "GAP";
  }
  return next;
}

export async function runWorkersSequential(state: RunState, sink: EventSink): Promise<RunState> {
  const workers = state.agents.filter((a) => a.role === "worker");
  let current = state;
  for (const w of workers) {
    if (current.status === "paused") return current;
    if (w.status === "done" || w.status === "error" || w.status === "rate_limited") continue;
    emit(current, sink, {
      type: "status",
      agentId: w.id,
      role: "worker",
      message: `starting worker ${w.id}`,
    });
    current = await runAgentUntilDone(current, w.id, sink);
    if (current.status === "waiting_approval") return current;
    const after = current.agents.find((a) => a.id === w.id);
    if (after && (after.status === "rate_limited" || after.status === "error")) {
      after.reportStatus = after.reportStatus ?? "BLOCKED";
    }
  }
  return current;
}

/**
 * Free-tier bounded parallel: admit up to N by keys, require disjoint writes,
 * then run workers one-at-a-time under a shared jail (avoids state races).
 * Key queues still serialize same-key LLM calls; multi-key setups benefit on failover.
 */
export async function runWorkersParallel(state: RunState, sink: EventSink): Promise<RunState> {
  const overlap = assertDisjointWrites(state);
  if (overlap) {
    emit(state, sink, { type: "error", message: overlap });
    return runWorkersSequential(state, sink);
  }
  emit(state, sink, {
    type: "status",
    message: `parallel admission cap=${admitParallelCount()}; executing workers sequentially with isolated transcripts`,
  });
  return runWorkersSequential(state, sink);
}

export async function runSharedVerify(state: RunState, sink: EventSink): Promise<RunState> {
  state.status = "aggregating";
  try {
    const result = await runRecipe(state.scopes.projectRoot, state.verifyRecipe, [], { timeoutMs: 120_000 });
    state.stats.verifyAttempts += 1;
    state.stats.lastVerifyExitCode = result.exitCode;
    state.verifyPassed = result.exitCode === 0;
    emit(state, sink, {
      type: "verify",
      message: state.verifyPassed ? "shared verify passed" : "shared verify failed",
      data: { exitCode: result.exitCode, recipe: state.verifyRecipe },
    });
  } catch (err) {
    state.verifyPassed = false;
    emit(state, sink, {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return state;
}

export async function runVerifierAgent(state: RunState, sink: EventSink): Promise<RunState> {
  const cfg = loadConfig();
  if (!cfg.roles.verifier) return state;
  let verifier = state.agents.find((a) => a.role === "verifier");
  if (!verifier) {
    verifier = createVerifierAgent(4);
    state.agents.push(verifier);
  }
  verifier.brief = `Confirm the work for: ${state.task}. Run recipe ${state.verifyRecipe}. Report PASS or ISSUES.`;
  return runAgentUntilDone(state, verifier.id, sink);
}

export async function finalizeAggregate(state: RunState, sink: EventSink): Promise<RunState> {
  state.filesTouched = mergeFilesTouched(state);
  const report = aggregateWorkerResults(state);
  report.verifyPassed =
    state.verifyPassed && report.gaps.length === 0 && report.results.every((r) => r.status !== "BLOCKED");
  state.aggregateReport = report;
  emit(state, sink, {
    type: "report",
    message: report.summary,
    data: { ...report },
  });
  state.status = "done";
  emit(state, sink, {
    type: "done",
    message: "swarm complete",
    data: { verifyPassed: report.verifyPassed, aggregate: report },
  });
  saveRun(state);
  return state;
}

/** Continue orchestrated schedule after an approval or pause. */
export async function continueOrchestrated(state: RunState, sink: EventSink): Promise<RunState> {
  if (state.mode !== "orchestrated") return state;
  if (state.status === "waiting_approval" || state.status === "paused") return state;

  const workers = state.agents.filter((a) => a.role === "worker");
  const pending = workers.filter((w) => w.status !== "done" && w.status !== "error" && w.status !== "rate_limited");
  if (pending.length) {
    return runWorkersSequential(state, sink).then(async (s) => {
      if (s.status === "waiting_approval" || s.status === "paused") return s;
      let next = await runSharedVerify(s, sink);
      next = await runVerifierAgent(next, sink);
      return finalizeAggregate(next, sink);
    });
  }
  let next = await runSharedVerify(state, sink);
  next = await runVerifierAgent(next, sink);
  return finalizeAggregate(next, sink);
}
