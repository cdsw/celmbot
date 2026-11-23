import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRun, resolveApproval, startRun } from "../../src/agent/loop.js";
import { loadConfig, saveConfig, upsertKey } from "../../src/config.js";
import { startFakeLlm } from "../helpers/fakeLlm.js";

describe("solo agent fake llm", () => {
  let tmp: string;
  let project: string;
  let close: (() => Promise<void>) | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "celmbot-int-"));
    process.env.CELMBOT_CONFIG_DIR = tmp;
    project = path.join(tmp, "proj");
    fs.mkdirSync(path.join(project, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(project, "package.json"),
      JSON.stringify({ name: "p", type: "module", scripts: { test: "node -e \"process.exit(0)\"" } })
    );
  });

  afterEach(async () => {
    if (close) await close();
    fs.rmSync(tmp, { recursive: true, force: true });
    delete process.env.CELMBOT_CONFIG_DIR;
  });

  it("writes under allowlist after approval and verifies", async () => {
    let step = 0;
    const fake = await startFakeLlm({
      next: () => {
        step += 1;
        if (step === 1) {
          return {
            tool_calls: [
              {
                id: "call1",
                type: "function",
                function: {
                  name: "write_file",
                  arguments: JSON.stringify({ path: "src/hello.js", content: "export const hi = 1;\n" }),
                },
              },
            ],
          };
        }
        if (step === 2) {
          return {
            tool_calls: [
              {
                id: "call2",
                type: "function",
                function: { name: "run_recipe", arguments: JSON.stringify({ name: "npm_test" }) },
              },
            ],
          };
        }
        return { content: "Verified with npm_test." };
      },
    });
    close = fake.close;

    let cfg = loadConfig();
    cfg.runMode = "ask";
    cfg = {
      ...cfg,
      credentials: {
        ...cfg.credentials,
        local: [
          {
            id: "cred-fake",
            pool: "local",
            providerId: "fake",
            label: "fake",
            baseUrl: fake.url,
            rpm: 1000,
            rpd: 10000,
            enabled: true,
          },
        ],
      },
    };
    cfg = upsertKey(cfg, {
      id: "fake-1",
      pool: "local",
      providerId: "fake",
      credentialId: "cred-fake",
      label: "fake",
      baseUrl: fake.url,
      model: "fake",
      enabled: true,
      supportsTools: true,
    });
    cfg.roles = { worker: "fake-1" };
    saveConfig(cfg);

    let state = createRun({
      task: "add hello",
      scopes: { projectRoot: project, writeAllow: ["src/**"] },
      verifyRecipe: "npm_test",
      maxSteps: 8,
    });

    const sink = () => undefined;
    state = await startRun(state, sink);
    expect(state.status).toBe("waiting_approval");
    state = await resolveApproval(state, "allow", sink);
    // may wait for recipe approval
    if (state.status === "waiting_approval") {
      state = await resolveApproval(state, "allow", sink);
    }
    // keep ticking if still running
    let guard = 0;
    while (state.status === "running" && guard++ < 5) {
      const { resumeRun } = await import("../../src/agent/loop.js");
      state = await resumeRun(state, sink);
    }

    expect(fs.existsSync(path.join(project, "src", "hello.js"))).toBe(true);
    expect(state.verifyPassed || state.stats.lastVerifyExitCode === 0).toBe(true);
  }, 90_000);
});
