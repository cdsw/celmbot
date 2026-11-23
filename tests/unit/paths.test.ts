import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("paths install-local data dir", () => {
  let tmp: string;
  let prevConfigDir: string | undefined;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "celmbot-paths-"));
    prevConfigDir = process.env.CELMBOT_CONFIG_DIR;
    delete process.env.CELMBOT_CONFIG_DIR;
    vi.resetModules();
  });

  afterEach(() => {
    if (prevConfigDir === undefined) delete process.env.CELMBOT_CONFIG_DIR;
    else process.env.CELMBOT_CONFIG_DIR = prevConfigDir;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("stores data under the CelmBot install root, not home or workspace", async () => {
    const { getInstallRoot, getDataDir, ensureDataDir, setProjectRoot, configPath } =
      await import("../../src/paths.js");
    const install = getInstallRoot();
    const workspace = path.join(tmp, "some-workspace");
    fs.mkdirSync(workspace);
    setProjectRoot(workspace);

    const dir = ensureDataDir();
    expect(dir).toBe(path.join(install, ".celmbot"));
    expect(getDataDir()).toBe(path.join(install, ".celmbot"));
    expect(configPath()).toBe(path.join(install, ".celmbot", "config.json"));
    expect(path.resolve(dir)).not.toBe(path.join(os.homedir(), ".celmbot"));
    expect(path.resolve(dir)).not.toBe(path.join(workspace, ".celmbot"));
    expect(fs.existsSync(path.join(dir, "runs"))).toBe(true);
  });

  it("CELMBOT_CONFIG_DIR overrides install-local path", async () => {
    const override = path.join(tmp, "override-config");
    process.env.CELMBOT_CONFIG_DIR = override;
    const { getDataDir, ensureDataDir } = await import("../../src/paths.js");
    expect(getDataDir()).toBe(path.resolve(override));
    ensureDataDir();
    expect(fs.existsSync(override)).toBe(true);
  });
});
