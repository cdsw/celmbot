import { describe, expect, it } from "vitest";
import { emptyRunStats, p50, recordLlmCall } from "../../src/stats/collector.js";

describe("stats", () => {
  it("computes p50", () => {
    expect(p50([10, 30, 20])).toBe(20);
  });

  it("records per-key calls", () => {
    const life = recordLlmCall(
      { totalRuns: 0, totalLlmCalls: 0, verifyPass: 0, verifyFail: 0, perKey: {}, updatedAt: 0 },
      "k1",
      { latencyMs: 12, ok: true }
    );
    expect(life.totalLlmCalls).toBe(1);
    expect(life.perKey.k1?.calls).toBe(1);
  });

  it("starts empty run stats", () => {
    expect(emptyRunStats().llmCalls).toBe(0);
  });
});
