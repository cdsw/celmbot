import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listEntries, readProjectFile, writeProjectFile } from "../../src/workspace/projectFs.js";
import { PathJailError } from "../../src/safety/pathGuard.js";

describe("projectFs editor helpers", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "celmbot-fs-"));
    fs.writeFileSync(path.join(root, "hello.js"), "export const n = 1;\n");
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "a.ts"), " const x = 1;\n");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("lists files and dirs", () => {
    const entries = listEntries(root, ".");
    expect(entries.some((e) => e.path === "hello.js" && e.type === "file")).toBe(true);
    expect(entries.some((e) => e.path === "src" && e.type === "dir")).toBe(true);
  });

  it("reads and writes files", () => {
    const file = readProjectFile(root, "hello.js");
    expect(file.content).toContain("export const n");
    writeProjectFile(root, "hello.js", "export const n = 2;\n");
    expect(readProjectFile(root, "hello.js").content).toBe("export const n = 2;\n");
  });

  it("blocks protected writes", () => {
    expect(() => writeProjectFile(root, ".env", "SECRET=1\n")).toThrow(PathJailError);
  });
});
