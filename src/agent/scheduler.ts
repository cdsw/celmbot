import { loadConfig, allKeys } from "../config.js";
import { resolveRoute } from "../keys/credentials.js";
import type { AggregateReport, RunState, VerifyEvidence, WorkerReportStatus } from "../shared/types.js";
import {
  createVerifierAgent,
  findWriteOverlaps,
  getActiveAgent,
  globsOverlap,
  mergeFilesTouched,
  setActiveAgent,
  workersShareIdenticalScopes,
} from "./agents.js";
import { emit, startRun, type EventSink } from "./loop.js";
import { saveRun } from "./persistence.js";
import { runRecipe } from "../safety/recipes.js";

/** Max post-verify fix workers spent per swarm (free-tier thrift). */
export const MAX_FIX_ATTEMPTS = 1;

export function availableCoolKeyCount(now = Date.now()): number {
  const cfg = loadConfig();
  return allKeys(cfg).filter((k) => {
    const resolved = resolveRoute(cfg, k);
    return (
      Boolean(resolved?.enabled) &&
      k.supportsTools !== false &&
      (!k.cooldownUntil || k.cooldownUntil <= now)
    );
  }).length;
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

/**
 * Reject before spend when the operator gave *different* scopes that still collide.
 * Identical scopes (default thrift swarm) stay allowed → sequential.
 */
export function preflightRejectCollidingScopes(state: RunState): string | null {
  const workers = state.agents.filter((a) => a.role === "worker");
  if (workers.length < 2) return null;
  if (workersShareIdenticalScopes(workers)) return null;
  const overlap = assertDisjointWrites(state);
  if (!overlap) return null;
  return `Preflight: ${overlap} Refusing to spend tokens on colliding scopes.`;
}

function workerResult(agent: {
  id: string;
  reportStatus?: WorkerReportStatus;
  issues?: string[];
  filesTouched: string[];
  status: string;
  evidence?: VerifyEvidence;
}): AggregateReport["results"][number] {
  const status: WorkerReportStatus =
    agent.reportStatus ??
    (agent.status === "error" || agent.status === "rate_limited" ? "BLOCKED" : "GAP");
  return {
    agentId: agent.id,
    status,
    issues: agent.issues ?? [],
    filesTouched: agent.filesTouched,
    evidence: agent.evidence,
  };
}

export function aggregateWorkerResults(state: RunState): AggregateReport {
  const workers = state.agents.filter((a) => a.role === "worker");
  const results = workers.map(workerResult);
  const gaps = results.filter((r) => r.status === "GAP").map((r) => r.agentId);
  const overlaps = findWriteOverlaps(workers);
  const evidence = state.verifyEvidence;
  return {
    results,
    gaps,
    overlaps,
    verifyPassed: false,
    evidence,
    summary: [
      `Workers: ${results.length}`,
      ...results.map((r) => `${r.agentId}: ${r.status}${r.issues.length ? ` (${r.issues.length} issues)` : ""}`),
      gaps.length ? `Gaps: ${gaps.join(", ")}` : "Gaps: none",
      overlaps.length ? `Write overlaps: ${overlaps.join(", ")}` : "Write overlaps: none",
      evidence
        ? `Evidence: ${evidence.recipe} exit ${evidence.exitCode}`
        : "Evidence: none yet",
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
    const evidence: VerifyEvidence = {
      recipe: state.verifyRecipe,
      command: result.command,
      args: result.args,
      exitCode: result.exitCode,
      stdoutTail: `${result.stdout}\n${result.stderr}`.trim().slice(-2000),
      at: Date.now(),
    };
    state.verifyEvidence = evidence;
    emit(state, sink, {
      type: "verify",
      message: state.verifyPassed ? "shared verify passed" : "shared verify failed",
      data: { exitCode: result.exitCode, recipe: state.verifyRecipe, evidence },
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

/**
 * After shared verify fails, re-queue one thrifty fix worker with recipe evidence (once).
 */
export async function requeueFixAfterVerifyFail(state: RunState, sink: EventSink): Promise<RunState> {
  if (state.verifyPassed) return state;
  if ((state.fixAttempts ?? 0) >= MAX_FIX_ATTEMPTS) return state;

  const workers = state.agents.filter((a) => a.role === "worker");
  const withTouch = workers.filter((w) => w.filesTouched.length > 0);
  const preferred = withTouch.filter((w) => w.reportStatus === "PASS" || w.reportStatus === "ISSUES" || w.reportStatus === "GAP");
  const target = (preferred[0] ?? withTouch[0] ?? workers[0]) as (typeof workers)[number] | undefined;
  if (!target) return state;

  state.fixAttempts = (state.fixAttempts ?? 0) + 1;
  const ev = state.verifyEvidence;
  const note = ev
    ? `Shared verify failed: ${ev.recipe} exit ${ev.exitCode}\n$ ${ev.command} ${ev.args.join(" ")}\n${(ev.stdoutTail ?? "").slice(0, 1500)}`
    : `Shared verify failed for recipe ${state.verifyRecipe} (exit ${state.stats.lastVerifyExitCode ?? "?"}).`;

  for (const w of workers) {
    if (w.id !== target.id && w.status !== "done" && w.status !== "error" && w.status !== "rate_limited") {
      w.status = "done";
      w.reportStatus = w.reportStatus ?? "GAP";
    }
  }

  target.status = "idle";
  target.reportStatus = undefined;
  target.verifyPassed = false;
  target.issues = undefined;
  target.step = 0;
  target.maxSteps = Math.min(6, target.maxSteps || 6);
  target.messages = [];
  target.brief = [
    target.brief ?? state.task,
    "",
    "## Fix pass (shared verify failed — free-tier thrift)",
    note,
    "Make the smallest change that makes the recipe pass. Run the verify recipe before claiming PASS.",
  ].join("\n");

  emit(state, sink, {
    type: "status",
    agentId: target.id,
    role: "worker",
    message: `re-queue fix worker ${target.id} after verify fail (attempt ${state.fixAttempts})`,
    data: { fixAttempts: state.fixAttempts },
  });
  saveRun(state);

  let current = await runAgentUntilDone(state, target.id, sink);
  if (current.status === "waiting_approval" || current.status === "paused") return current;
  current = await runSharedVerify(current, sink);
  return current;
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
  // Evidence-gate: clamp claimed PASS when shared recipe is red.
  if (!state.verifyPassed) {
    for (const r of report.results) {
      if (r.status === "PASS") r.status = "ISSUES";
    }
    report.gaps = report.results.filter((r) => r.status === "GAP").map((r) => r.agentId);
    report.verifyNote =
      state.verifyEvidence != null
        ? `${state.verifyEvidence.recipe} exit ${state.verifyEvidence.exitCode}`
        : "shared verify did not pass";
  }
  report.verifyPassed =
    state.verifyPassed && report.gaps.length === 0 && report.results.every((r) => r.status !== "BLOCKED");
  report.evidence = state.verifyEvidence;
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

async function afterWorkersVerifyAndFinalize(state: RunState, sink: EventSink): Promise<RunState> {
  let next = await runSharedVerify(state, sink);
  next = await requeueFixAfterVerifyFail(next, sink);
  if (next.status === "waiting_approval" || next.status === "paused") return next;
  next = await runVerifierAgent(next, sink);
  return finalizeAggregate(next, sink);
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
      return afterWorkersVerifyAndFinalize(s, sink);
    });
  }
  return afterWorkersVerifyAndFinalize(state, sink);
}
