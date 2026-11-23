import { useState } from "react";
import styles from "../App.module.scss";

export function StatsStrip({
  branch,
  dirtyCount,
  runStatus,
  stats,
  verifyPassed,
  lifetime,
  activeKeyId,
  cooldownUntil,
  onClearStats,
}: {
  branch: string | null;
  dirtyCount: number;
  runStatus?: string;
  stats: Record<string, unknown> | null;
  verifyPassed?: boolean;
  lifetime: Record<string, unknown> | null;
  activeKeyId?: string;
  cooldownUntil?: number;
  onClearStats: () => void;
}) {
  const [open, setOpen] = useState(false);
  const s = stats ?? {};
  const cool =
    cooldownUntil && cooldownUntil > Date.now()
      ? `${Math.ceil((cooldownUntil - Date.now()) / 1000)}s`
      : "—";
  const items: Array<[string, string]> = [
    ["status", runStatus ?? "idle"],
    ["llm", String(s.llmCalls ?? 0)],
    ["latency", s.latencyLastMs != null ? `${s.latencyLastMs}ms` : "—"],
    ["p50", s.latencyP50Ms != null ? `${s.latencyP50Ms}ms` : "—"],
    ["max", s.latencyMaxMs != null ? `${s.latencyMaxMs}ms` : "—"],
    ["queue", s.queueWaitMs != null ? `${s.queueWaitMs}ms` : "—"],
    ["tok", `${s.tokensIn ?? 0}/${s.tokensOut ?? 0}`],
    ["429s", String(s.rateLimitHits ?? 0)],
    ["verify", verifyPassed ? "pass" : "—"],
    ["key", activeKeyId ?? "—"],
    ["cool", cool],
  ];

  return (
    <>
      {open ? (
        <footer className={styles.statusBar} data-testid="stats-strip">
          <span>
            branch: <strong>{branch ?? "—"}</strong>
          </span>
          <span>
            dirty tabs: <strong>{dirtyCount}</strong>
          </span>
          {items.map(([k, v]) => (
            <span key={k}>
              {k}: <strong>{v}</strong>
            </span>
          ))}
          {lifetime && (
            <span>
              lifetime llm: {String(lifetime.totalLlmCalls ?? 0)} · runs:{" "}
              {String(lifetime.totalRuns ?? 0)}
            </span>
          )}
          <button type="button" className={styles.secondary} onClick={onClearStats}>
            Clear stats
          </button>
        </footer>
      ) : null}
      <button
        type="button"
        className={styles.statsFab}
        data-testid="stats-toggle"
        aria-expanded={open}
        aria-label={open ? "Hide stats" : "Show stats"}
        title={open ? "Hide stats" : "Show stats"}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide stats" : "Stats"}
      </button>
    </>
  );
}
