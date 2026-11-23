import { describe, expect, it } from "vitest";
import { parseReportStatus } from "../../src/agent/loop.js";

describe("parseReportStatus (evidence-gated)", () => {
  it("allows PASS only when verifyPassed", () => {
    expect(parseReportStatus("**PASS** — all good", true)).toBe("PASS");
    expect(parseReportStatus("**PASS** — all good", false)).toBe("ISSUES");
    expect(parseReportStatus("PASS\nno issues found", false)).toBe("ISSUES");
  });

  it("keeps explicit ISSUES and BLOCKED", () => {
    expect(parseReportStatus("ISSUES\n- broken test", false)).toBe("ISSUES");
    expect(parseReportStatus("BLOCKED\n- no network", false)).toBe("BLOCKED");
  });

  it("returns GAP when there is no status yet", () => {
    expect(parseReportStatus("still looking around", false)).toBe("GAP");
  });

  it("elevates to PASS when recipe already green", () => {
    expect(parseReportStatus("done for now", true)).toBe("PASS");
  });
});
