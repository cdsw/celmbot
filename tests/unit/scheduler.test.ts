import { describe, expect, it } from "vitest";
import {
  aggregateWorkerResults,
  assertDisjointWrites,
  preflightRejectCollidingScopes,
} from "../../src/agent/scheduler.js";
import {
  createWorkerAgent,
  createOrchestratorAgent,
  globPairOverlaps,
  globsOverlap,
} from "../../src/agent/agents.js";
import { emptyRunStats } from "../../src/stats/collector.js";
import type { RunState } from "../../src/shared/types.js";

function baseRun(workers: ReturnType<typeof createWorkerAgent>[]): RunState {
  const orch = createOrchestratorAgent("task");
  return {
    id: "r1",
    mode: "orchestrated",
    status: "running",
    task: "task",
    verifyRecipe: "npm_test",
    scopes: { projectRoot: "/tmp", writeAllow: ["src/**"] },
    skillIds: [],
    createdAt: 1,
    updatedAt: 1,
    step: 0,
    maxSteps: 20,
    messages: [],
    events: [],
    pendingApprovals: [],
    activeAgentId: workers[0]?.id ?? orch.id,
    agents: [orch, ...workers],
    filesTouched: [],
    verifyPassed: false,
    stats: emptyRunStats(),
  };
}

describe("scheduler helpers", () => {
  it("detects overlapping write globs including nested prefixes", () => {
    expect(globsOverlap(["src/a/**"], ["src/b/**"])).toBe(false);
    expect(globsOverlap(["src/**"], ["src/**"])).toBe(true);
    expect(globPairOverlaps("src/**", "src/a/**")).toBe(true);
    expect(globPairOverlaps("src/**", "test/**")).toBe(false);
    const run = baseRun([
      createWorkerAgent({ id: "w1", writeAllow: ["src/**"], brief: "a", maxSteps: 4 }),
      createWorkerAgent({ id: "w2", writeAllow: ["src/**"], brief: "b", maxSteps: 4 }),
    ]);
    expect(assertDisjointWrites(run)).toMatch(/share write scopes/);
  });

  it("preflight allows identical scopes but rejects different colliding scopes", () => {
    const same = baseRun([
      createWorkerAgent({ id: "w1", writeAllow: ["src/**"], brief: "a", maxSteps: 4 }),
      createWorkerAgent({ id: "w2", writeAllow: ["src/**"], brief: "b", maxSteps: 4 }),
    ]);
    expect(preflightRejectCollidingScopes(same)).toBeNull();

    const nested = baseRun([
      createWorkerAgent({ id: "w1", writeAllow: ["src/**"], brief: "a", maxSteps: 4 }),
      createWorkerAgent({ id: "w2", writeAllow: ["src/lib/**"], brief: "b", maxSteps: 4 }),
    ]);
    expect(preflightRejectCollidingScopes(nested)).toMatch(/Preflight/);

    const disjoint = baseRun([
      createWorkerAgent({ id: "w1", writeAllow: ["src/**"], brief: "a", maxSteps: 4 }),
      createWorkerAgent({ id: "w2", writeAllow: ["test/**"], brief: "b", maxSteps: 4 }),
    ]);
    expect(preflightRejectCollidingScopes(disjoint)).toBeNull();
  });

  it("aggregates PASS and GAP with evidence", () => {
    const w1 = createWorkerAgent({ id: "w1", writeAllow: ["a/**"], brief: "a", maxSteps: 4 });
    w1.status = "done";
    w1.reportStatus = "PASS";
    w1.evidence = {
      recipe: "npm_test",
      command: "npm",
      args: ["test"],
      exitCode: 0,
      at: 1,
    };
    const w2 = createWorkerAgent({ id: "w2", writeAllow: ["b/**"], brief: "b", maxSteps: 4 });
    w2.status = "done";
    const run = baseRun([w1, w2]);
    run.verifyEvidence = {
      recipe: "npm_test",
      command: "npm",
      args: ["test"],
      exitCode: 1,
      at: 2,
    };
    const report = aggregateWorkerResults(run);
    expect(report.results[0].status).toBe("PASS");
    expect(report.results[0].evidence?.exitCode).toBe(0);
    expect(report.gaps).toContain("w2");
    expect(report.evidence?.exitCode).toBe(1);
    expect(report.summary).toMatch(/Evidence: npm_test exit 1/);
  });
});
