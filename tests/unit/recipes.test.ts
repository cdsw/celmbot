import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PathJailError } from "../../src/safety/pathGuard.js";
import { getRecipe, normalizeRecipeName, runRecipe } from "../../src/safety/recipes.js";

describe("recipes", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "celmbot-recipe-"));
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "t", type: "module", scripts: { test: "node -e \"process.exit(0)\"" } })
    );
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("aliases spaced recipe names", () => {
    expect(normalizeRecipeName("npm test")).toBe("npm_test");
    expect(normalizeRecipeName("npm-test")).toBe("npm_test");
    expect(getRecipe("npm test").name).toBe("npm_test");
  });

  it("rejects unknown recipe", () => {
    expect(() => getRecipe("rm_rf")).toThrow(PathJailError);
  });

  it("rejects outside path args", () => {
    expect(() => getRecipe("node", ["../outside.js"])).not.toThrow();
    expect(() => runRecipe(root, "node", [path.join(os.tmpdir(), "x.js")])).toThrow(PathJailError);
  });

  it("runs npm_test with shell false inside project", async () => {
    const result = await runRecipe(root, "npm_test", [], { timeoutMs: 60_000 });
    expect(result.exitCode).toBe(0);
    expect(result.args).toContain("test");
  }, 60_000);
});
