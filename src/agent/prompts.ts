import type { Budget, SkillMeta } from "../shared/types.js";

export function buildSystemPrompt(opts: {
  task: string;
  projectRoot: string;
  writeAllow: string[];
  verifyRecipe: string;
  skills: SkillMeta[];
  budget: Budget;
  role: string;
}): string {
  const skillBlock = opts.skills
    .map((s) => `### ${s.name}\n${s.description}\n${s.body.slice(0, opts.budget === "small" ? 800 : 2000)}`)
    .join("\n\n");

  return [
    `You are CelmBot, a verification-first coding agent (${opts.role}).`,
    `This is a local playground sandbox — prefer the smallest change that works.`,
    `Project root: ${opts.projectRoot}`,
    `You may ONLY write files matching: ${opts.writeAllow.join(", ") || "(none — read-only until allowlist set)"}`,
    `Never claim success without running verify recipe: ${opts.verifyRecipe || "npm_test"}`,
    `Use tools. Do not invent file contents you have not read.`,
    `When finished, run_recipe for verification, then summarize evidence.`,
    `Speak plainly (unslop).`,
    skillBlock ? `## Skills\n${skillBlock}` : "",
    `## Task\n${opts.task}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
