import { describe, expect, it } from "vitest";
import { aggregateWorkerResults, assertDisjointWrites } from "../../src/agent/scheduler.js";
import { createWorkerAgent, createOrchestratorAgent, globsOverlap } from "../../src/agent/agents.js";
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
  it("detects overlapping write globs", () => {
    expect(globsOverlap(["src/a/**"], ["src/b/**"])).toBe(false);
    expect(globsOverlap(["src/**"], ["src/**"])).toBe(true);
    const run = baseRun([
      createWorkerAgent({ id: "w1", writeAllow: ["src/**"], brief: "a", maxSteps: 4 }),
      createWorkerAgent({ id: "w2", writeAllow: ["src/**"], brief: "b", maxSteps: 4 }),
    ]);
    expect(assertDisjointWrites(run)).toMatch(/share write scopes/);
  });

  it("aggregates PASS and GAP", () => {
    const w1 = createWorkerAgent({ id: "w1", writeAllow: ["a/**"], brief: "a", maxSteps: 4 });
    w1.status = "done";
    w1.reportStatus = "PASS";
    const w2 = createWorkerAgent({ id: "w2", writeAllow: ["b/**"], brief: "b", maxSteps: 4 });
    w2.status = "done";
    const report = aggregateWorkerResults(baseRun([w1, w2]));
    expect(report.results[0].status).toBe("PASS");
    expect(report.gaps).toContain("w2");
  });
});
