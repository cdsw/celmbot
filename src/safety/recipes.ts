import { spawn } from "node:child_process";
import path from "node:path";
import type { RecipeDef } from "../shared/types.js";
import { assertArgvPathsInJail, PathJailError } from "./pathGuard.js";

export const BUILTIN_RECIPES: RecipeDef[] = [
  {
    name: "npm_test",
    description: "Run npm test",
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: ["test"],
  },
  {
    name: "npm_run",
    description: "Run npm run <script> — pass script as first extra arg",
    command: process.platform === "win32" ? "npm.cmd" : "npm",
    args: ["run"],
  },
  {
    name: "npx",
    description: "Run npx <bin> — pass bin and args as extras",
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: [],
  },
  {
    name: "node",
    description: "Run node on a file inside the project",
    command: process.execPath,
    args: [],
  },
  {
    name: "tsc",
    description: "Typecheck with tsc --noEmit",
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["tsc", "--noEmit"],
  },
  {
    name: "pytest",
    description: "Run pytest",
    command: process.platform === "win32" ? "pytest.exe" : "pytest",
    args: [],
  },
];

/** Normalize agent typos like "npm test" → "npm_test". */
export function normalizeRecipeName(name: string): string {
  const raw = String(name ?? "").trim();
  if (!raw) return raw;
  const spaced = raw.toLowerCase().replace(/[\s-]+/g, "_");
  const aliases: Record<string, string> = {
    npm_test: "npm_test",
    npmtest: "npm_test",
    test: "npm_test",
    npm_run: "npm_run",
    npmrun: "npm_run",
  };
  if (aliases[spaced]) return aliases[spaced];
  if (BUILTIN_RECIPES.some((r) => r.name === raw)) return raw;
  if (BUILTIN_RECIPES.some((r) => r.name === spaced)) return spaced;
  return raw;
}

export function getRecipe(name: string, extras: string[] = []): RecipeDef {
  const normalized = normalizeRecipeName(name);
  const base = BUILTIN_RECIPES.find((r) => r.name === normalized);
  if (!base) {
    throw new PathJailError(`unknown recipe: ${name}`);
  }
  return {
    ...base,
    args: [...base.args, ...extras],
  };
}

export interface RecipeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string;
  args: string[];
  durationMs: number;
}

export function runRecipe(
  projectRoot: string,
  recipeName: string,
  extras: string[] = [],
  opts?: { env?: NodeJS.ProcessEnv; timeoutMs?: number }
): Promise<RecipeResult> {
  const recipe = getRecipe(recipeName, extras);
  assertArgvPathsInJail(projectRoot, recipe.args);

  const started = Date.now();
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    PATHEXT: process.env.PATHEXT,
    SYSTEMROOT: process.env.SYSTEMROOT,
    LANG: process.env.LANG ?? "en_US.UTF-8",
    NODE_ENV: process.env.NODE_ENV,
    ...opts?.env,
  };

  // Built-in recipe commands are fixed allowlist tokens (never user-supplied).
  // Args are path-checked; reject shell metacharacters before spawn.
  for (const a of recipe.args) {
    if (/[&|<>^%()]/.test(a)) {
      throw new PathJailError(`unsafe character in recipe arg: ${a}`);
    }
  }

  return new Promise((resolve, reject) => {
    // Windows .cmd shims: invoke via cmd.exe /c with a quoted argv join (shell:false).
    const child =
      process.platform === "win32"
        ? spawn(
            process.env.ComSpec || "cmd.exe",
            [
              "/d",
              "/s",
              "/c",
              [recipe.command, ...recipe.args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" "),
            ],
            { cwd: path.resolve(projectRoot), env, shell: false, windowsHide: true }
          )
        : spawn(recipe.command, recipe.args, {
            cwd: path.resolve(projectRoot),
            env,
            shell: false,
            windowsHide: true,
          });

    let stdout = "";
    let stderr = "";
    const timer =
      opts?.timeoutMs &&
      setTimeout(() => {
        child.kill("SIGTERM");
        reject(new PathJailError(`recipe timed out: ${recipeName}`));
      }, opts.timeoutMs);

    child.stdout?.on("data", (d) => {
      stdout += String(d);
      if (stdout.length > 200_000) stdout = stdout.slice(-200_000);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
      if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        command: recipe.command,
        args: recipe.args,
        durationMs: Date.now() - started,
      });
    });
  });
}
