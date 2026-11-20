import fs from "node:fs";
import type { LifetimeStats, RunStatsSnapshot } from "../shared/types.js";
import { ensureDataDir, statsPath } from "../paths.js";

export function emptyRunStats(): RunStatsSnapshot {
  return {
    wallMs: 0,
    llmCalls: 0,
    toolCalls: {},
    verifyAttempts: 0,
    approvalsGranted: 0,
    approvalsDenied: 0,
    queueWaitMs: 0,
    errors: 0,
    rateLimitHits: 0,
  };
}

export function loadLifetimeStats(): LifetimeStats {
  ensureDataDir();
  const file = statsPath();
  if (!fs.existsSync(file)) {
    return { totalRuns: 0, totalLlmCalls: 0, verifyPass: 0, verifyFail: 0, perKey: {}, updatedAt: Date.now() };
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as LifetimeStats;
}

export function saveLifetimeStats(stats: LifetimeStats): void {
  ensureDataDir();
  stats.updatedAt = Date.now();
  fs.writeFileSync(statsPath(), JSON.stringify(stats, null, 2));
}

export function clearLifetimeStats(): LifetimeStats {
  const empty: LifetimeStats = {
    totalRuns: 0,
    totalLlmCalls: 0,
    verifyPass: 0,
    verifyFail: 0,
    perKey: {},
    updatedAt: Date.now(),
  };
  saveLifetimeStats(empty);
  return empty;
}

export function recordLlmCall(
  lifetime: LifetimeStats,
  keyId: string,
  opts: { latencyMs: number; ok: boolean; rateLimited?: boolean; tokensIn?: number; tokensOut?: number }
): LifetimeStats {
  const per = lifetime.perKey[keyId] ?? { calls: 0, failures: 0, rateLimits: 0, latencySamples: [] };
  per.calls += 1;
  if (!opts.ok) per.failures += 1;
  if (opts.rateLimited) per.rateLimits += 1;
  per.latencySamples = [...per.latencySamples, opts.latencyMs].slice(-100);
  lifetime.perKey[keyId] = per;
  lifetime.totalLlmCalls += 1;
  return lifetime;
}

export function p50(samples: number[]): number | undefined {
  if (!samples.length) return undefined;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function bumpTool(stats: RunStatsSnapshot, name: string): void {
  stats.toolCalls[name] = (stats.toolCalls[name] ?? 0) + 1;
}
