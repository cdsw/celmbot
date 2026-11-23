import styles from "../App.module.scss";

export interface AggregateReportData {
  results: Array<{
    agentId: string;
    status: string;
    issues: string[];
    filesTouched: string[];
  }>;
  gaps: string[];
  overlaps?: string[];
  verifyPassed: boolean;
  summary: string;
  /** Optional detail when shared verify did not pass. */
  verifyNote?: string;
}

export function buildAggregateFromRun(run: {
  status: string;
  verifyPassed: boolean;
  aggregateReport?: AggregateReportData;
  stats?: { lastVerifyExitCode?: number; verifyAttempts?: number };
  agents?: Array<{
    id: string;
    role: string;
    reportStatus?: string;
    filesTouched?: string[];
    issues?: string[];
  }>;
}, events?: Array<{ type: string; message?: string; data?: Record<string, unknown> }>): AggregateReportData | null {
  const verifyEvent = [...(events ?? [])].reverse().find((e) => e.type === "verify");
  const verifyError = [...(events ?? [])]
    .reverse()
    .find((e) => e.type === "error" && /recipe|verify/i.test(e.message ?? ""));

  const annotate = (report: AggregateReportData): AggregateReportData => {
    if (report.verifyPassed) return { ...report, verifyNote: undefined };
    if (report.verifyNote) return report;
    if (verifyEvent?.message) return { ...report, verifyNote: verifyEvent.message };
    if (verifyError?.message) return { ...report, verifyNote: verifyError.message };
    if (run.stats?.verifyAttempts && run.stats.lastVerifyExitCode != null) {
      return {
        ...report,
        verifyNote: `recipe exit ${run.stats.lastVerifyExitCode}`,
      };
    }
    if (["done", "error", "rate_limited", "interrupted"].includes(run.status)) {
      return { ...report, verifyNote: "shared verify did not pass" };
    }
    return { ...report, verifyNote: "verify still running" };
  };

  if (run.aggregateReport?.results?.length) return annotate(run.aggregateReport);
  const fromEvent = [...(events ?? [])].reverse().find((e) => e.type === "report");
  if (fromEvent?.data && Array.isArray(fromEvent.data.results)) {
    return annotate({
      results: fromEvent.data.results as AggregateReportData["results"],
      gaps: (fromEvent.data.gaps as string[]) ?? [],
      overlaps: (fromEvent.data.overlaps as string[]) ?? [],
      verifyPassed: Boolean(fromEvent.data.verifyPassed ?? run.verifyPassed),
      summary: fromEvent.message ?? String(fromEvent.data.summary ?? "Report"),
    });
  }
  const terminal = ["done", "error", "rate_limited", "interrupted"].includes(run.status);
  if (!terminal) return null;
  const pool = (run.agents ?? []).filter((a) => a.role === "worker");
  if (!pool.length) {
    return annotate({
      results: [],
      gaps: [],
      overlaps: [],
      verifyPassed: run.verifyPassed,
      summary: run.verifyPassed ? "Verify passed." : `Run ${run.status}.`,
    });
  }
  const results = pool.map((a) => ({
    agentId: a.id,
    status: a.reportStatus ?? (run.verifyPassed ? "PASS" : "GAP"),
    issues: a.issues ?? [],
    filesTouched: a.filesTouched ?? [],
  }));
  const gaps = results.filter((r) => r.status === "GAP").map((r) => r.agentId);
  const issueLines = results.flatMap((r) => r.issues.map((i) => `${r.agentId}: ${i}`));
  return annotate({
    results,
    gaps,
    overlaps: [],
    verifyPassed: run.verifyPassed,
    summary:
      issueLines.slice(0, 3).join(" · ") ||
      `${results.map((r) => `${r.agentId}=${r.status}`).join(", ")}; verify ${
        run.verifyPassed ? "passed" : "failed"
      }`,
  });
}

function verifyLabel(report: AggregateReportData): { text: string; ok: boolean } {
  if (report.verifyPassed) return { text: "passed", ok: true };
  if (report.verifyNote && /still running|pending/i.test(report.verifyNote)) {
    return { text: "pending", ok: false };
  }
  return { text: "failed", ok: false };
}

export function AggregateReport({ report }: { report: AggregateReportData }) {
  const verify = verifyLabel(report);
  return (
    <div className={styles.panelBlock} data-testid="aggregate-report">
      <h2>Report</h2>
      <p className={styles.muted}>{report.summary}</p>
      <p>
        Verify:{" "}
        <span className={`${styles.badge} ${verify.ok ? styles.badgeOk : styles.badgeWarn}`}>
          {verify.text}
        </span>
        {!verify.ok && report.verifyNote ? (
          <span className={styles.muted}> — {report.verifyNote}</span>
        ) : null}
      </p>
      {report.results.length > 0 && (
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Status</th>
              <th>Issues</th>
            </tr>
          </thead>
          <tbody>
            {report.results.map((r) => (
              <tr key={r.agentId}>
                <td className={styles.mono}>{r.agentId}</td>
                <td>
                  <span className={styles.badge}>{r.status}</span>
                </td>
                <td>{r.issues.length ? r.issues.join("; ") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {report.gaps.length > 0 && (
        <p className={styles.muted}>Gaps (not a pass): {report.gaps.join(", ")}</p>
      )}
    </div>
  );
}
