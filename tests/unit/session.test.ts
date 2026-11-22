import { describe, expect, it } from "vitest";
import {
  buildFollowUpTask,
  isTerminalRunStatus,
  mergeProveItSkills,
  reportBlurb,
} from "../../src/agent/session.js";
import type { RunState } from "../../src/shared/types.js";

describe("session helpers", () => {
  it("detects terminal run statuses", () => {
    expect(isTerminalRunStatus("done")).toBe(true);
    expect(isTerminalRunStatus("waiting_approval")).toBe(false);
    expect(isTerminalRunStatus("running")).toBe(false);
  });

  it("merges prove-it-works when available", () => {
    expect(mergeProveItSkills(["swarm"], ["principle-prove-it-works", "swarm"])).toEqual([
      "principle-prove-it-works",
      "swarm",
    ]);
    expect(mergeProveItSkills(["swarm"], ["swarm"])).toEqual(["swarm"]);
  });

  it("builds follow-up task with prior report", () => {
    const prior = {
      id: "r1",
      task: "fix bug",
      status: "done",
      verifyPassed: true,
      agents: [{ id: "solo-1", role: "worker", reportStatus: "PASS", status: "done" }],
      aggregateReport: {
        results: [],
        gaps: [],
        overlaps: [],
        verifyPassed: true,
        summary: "all good",
      },
    } as unknown as RunState;
    const text = buildFollowUpTask(prior, "also rename helper");
    expect(text).toContain("Prior task: fix bug");
    expect(text).toContain("all good");
    expect(text).toContain("also rename helper");
    expect(reportBlurb(prior)).toBe("all good");
  });
});
