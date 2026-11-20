import { describe, expect, it } from "vitest";
import { gateToolCall } from "../../src/safety/runMode.js";

describe("runMode", () => {
  it("auto-allows reads in ask mode", () => {
    const d = gateToolCall({
      mode: "ask",
      tool: { id: "1", name: "read_file", arguments: { path: "src/a.ts" } },
      projectRoot: "/tmp/proj",
      terminalAllowlist: [],
    });
    expect(d.needsApproval).toBe(false);
  });

  it("requires approval for writes in ask mode", () => {
    const d = gateToolCall({
      mode: "ask",
      tool: { id: "1", name: "write_file", arguments: { path: "src/a.ts", content: "x" } },
      projectRoot: "/tmp/proj",
      terminalAllowlist: [],
    });
    expect(d.needsApproval).toBe(true);
  });

  it("allowlists recipes", () => {
    const d = gateToolCall({
      mode: "allowlist",
      tool: { id: "1", name: "run_recipe", arguments: { name: "npm_test" } },
      projectRoot: "/tmp/proj",
      terminalAllowlist: ["recipe:npm_test"],
    });
    expect(d.needsApproval).toBe(false);
  });
});
