import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertWriteAllowed,
  isInsideRoot,
  PathJailError,
  resolveInJail,
} from "../../src/safety/pathGuard.js";

describe("pathGuard", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "celmbot-jail-"));
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "a.ts"), "export {}");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("allows paths inside root", () => {
    const abs = resolveInJail(root, "src/a.ts");
    expect(isInsideRoot(root, abs)).toBe(true);
  });

  it("rejects .. escape", () => {
    expect(() => resolveInJail(root, "../outside.txt")).toThrow(PathJailError);
  });

  it("rejects absolute paths outside root", () => {
    const outside = path.join(os.tmpdir(), "celmbot-outside.txt");
    expect(() => resolveInJail(root, outside)).toThrow(PathJailError);
  });

  it("fail-closed writes with empty allowlist", () => {
    expect(() => assertWriteAllowed(root, "src/a.ts", [])).toThrow(/fail-closed/);
  });

  it("allows write when glob matches", () => {
    const abs = assertWriteAllowed(root, "src/a.ts", ["src/**"]);
    expect(abs).toContain("a.ts");
  });

  it("denies write outside allowlist", () => {
    expect(() => assertWriteAllowed(root, "src/a.ts", ["lib/**"])).toThrow(/allowlist/);
  });

  it("rejects symlink escape when supported", () => {
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "celmbot-out-"));
    const target = path.join(outsideDir, "secret.txt");
    fs.writeFileSync(target, "nope");
    const link = path.join(root, "src", "escape");
    try {
      fs.symlinkSync(target, link);
    } catch {
      // Windows may need admin / developer mode
      fs.rmSync(outsideDir, { recursive: true, force: true });
      return;
    }
    expect(() => resolveInJail(root, "src/escape")).toThrow(PathJailError);
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });
});
