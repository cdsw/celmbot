import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {
  AggregateReport,
  ChatSession,
  OperatorChatMessage,
  RunState,
  SessionChrome,
} from "../shared/types.js";
import { ensureDataDir, sessionDir, sessionPath } from "../paths.js";

const TERMINAL = new Set(["done", "error", "rate_limited", "interrupted"]);

export function isTerminalRunStatus(status: string): boolean {
  return TERMINAL.has(status);
}

export function defaultChrome(): SessionChrome {
  return {
    mode: "solo",
    writeAllow: ["src/**", "tests/**", "*.md"],
    verifyRecipe: "npm test",
    skillIds: [],
    workerCount: 2,
  };
}

export function saveSession(session: ChatSession): void {
  ensureDataDir();
  session.updatedAt = Date.now();
  fs.writeFileSync(sessionPath(session.id), JSON.stringify(session, null, 2));
}

export function loadSession(id: string): ChatSession | null {
  const file = sessionPath(id);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as ChatSession;
}

export function listSessions(): ChatSession[] {
  ensureDataDir();
  const root = sessionDir();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((f) => f.endsWith(".json"))
    .map((f) => loadSession(f.replace(/\.json$/, "")))
    .filter((s): s is ChatSession => Boolean(s))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getOrCreateSession(projectRoot: string, chrome?: Partial<SessionChrome>): ChatSession {
  const resolved = path.resolve(projectRoot);
  const existing = listSessions().find((s) => path.resolve(s.projectRoot) === resolved);
  if (existing) {
    if (chrome) existing.chrome = { ...existing.chrome, ...chrome };
    saveSession(existing);
    return existing;
  }
  const session: ChatSession = {
    id: randomUUID(),
    projectRoot: resolved,
    messages: [],
    queued: [],
    chrome: { ...defaultChrome(), ...chrome },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  saveSession(session);
  return session;
}

export function findSessionByRunId(runId: string): ChatSession | null {
  return (
    listSessions().find(
      (s) => s.activeRunId === runId || s.messages.some((m) => m.runId === runId)
    ) ?? null
  );
}

export function appendMessage(
  session: ChatSession,
  partial: Omit<OperatorChatMessage, "id" | "ts"> & { id?: string; ts?: number }
): OperatorChatMessage {
  const msg: OperatorChatMessage = {
    id: partial.id ?? randomUUID(),
    role: partial.role,
    text: partial.text,
    runId: partial.runId,
    ts: partial.ts ?? Date.now(),
  };
  session.messages.push(msg);
  saveSession(session);
  return msg;
}

export function reportBlurb(run: RunState): string {
  const report = run.aggregateReport;
  if (report?.summary) return report.summary.slice(0, 400);
  const workers = (run.agents ?? []).filter((a) => a.role === "worker");
  if (workers.length) {
    return workers
      .map((w) => `${w.id}=${w.reportStatus ?? w.status}`)
      .join(", ")
      .slice(0, 400);
  }
  return `Run ${run.id} ended ${run.status}; verify ${run.verifyPassed ? "passed" : "failed"}`;
}

export function buildFollowUpTask(prior: RunState, followUp: string): string {
  return [
    `Continue after prior run.`,
    `Prior task: ${prior.task}`,
    `Prior report: ${reportBlurb(prior)}`,
    `Follow-up: ${followUp.trim()}`,
  ].join("\n");
}

/** Inject prove-it + free-tier thrift when those skills exist on disk. */
export function mergeProveItSkills(skillIds: string[] | undefined, availableIds: string[]): string[] {
  const DEFAULTS = ["principle-prove-it-works", "free-tier-thrift"];
  const base = skillIds ?? [];
  const inject = DEFAULTS.filter((id) => availableIds.includes(id));
  return Array.from(new Set([...inject, ...base]));
}

export function formatAggregateForChat(report: AggregateReport | undefined, run: RunState): string {
  if (report?.summary) {
    const lines = [
      report.summary,
      `Verify: ${report.verifyPassed ? "passed" : "failed"}`,
    ];
    if (!report.verifyPassed && report.verifyNote) lines.push(`Note: ${report.verifyNote}`);
    if (report.evidence) {
      lines.push(`Evidence: ${report.evidence.recipe} exit ${report.evidence.exitCode}`);
    }
    for (const r of report.results) {
      const ev = r.evidence ? ` [${r.evidence.recipe} exit ${r.evidence.exitCode}]` : "";
      lines.push(`- ${r.agentId}: ${r.status}${ev}${r.issues.length ? ` — ${r.issues.join("; ")}` : ""}`);
    }
    if (report.gaps.length) lines.push(`Gaps: ${report.gaps.join(", ")}`);
    return lines.join("\n");
  }
  return reportBlurb(run);
}
