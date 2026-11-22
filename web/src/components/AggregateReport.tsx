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
}

export function buildAggregateFromRun(run: {
  status: string;
  verifyPassed: boolean;
  aggregateReport?: AggregateReportData;
  agents?: Array<{
    id: string;
    role: string;
    reportStatus?: string;
    filesTouched?: string[];
    issues?: string[];
  }>;
}, events?: Array<{ type: string; message?: string; data?: Record<string, unknown> }>): AggregateReportData | null {
  if (run.aggregateReport?.results?.length) return run.aggregateReport;
  const fromEvent = [...(events ?? [])].reverse().find((e) => e.type === "report");
  if (fromEvent?.data && Array.isArray(fromEvent.data.results)) {
    return {
      results: fromEvent.data.results as AggregateReportData["results"],
      gaps: (fromEvent.data.gaps as string[]) ?? [],
      overlaps: (fromEvent.data.overlaps as string[]) ?? [],
      verifyPassed: Boolean(fromEvent.data.verifyPassed ?? run.verifyPassed),
      summary: fromEvent.message ?? String(fromEvent.data.summary ?? "Report"),
    };
  }
  const terminal = ["done", "error", "rate_limited", "interrupted"].includes(run.status);
  if (!terminal) return null;
  const pool = (run.agents ?? []).filter((a) => a.role === "worker");
  if (!pool.length) {
    return {
      results: [],
      gaps: [],
      overlaps: [],
      verifyPassed: run.verifyPassed,
      summary: run.verifyPassed ? "Verify passed." : `Run ${run.status}.`,
    };
  }
  const results = pool.map((a) => ({
    agentId: a.id,
    status: a.reportStatus ?? (run.verifyPassed ? "PASS" : "GAP"),
    issues: a.issues ?? [],
    filesTouched: a.filesTouched ?? [],
  }));
  const gaps = results.filter((r) => r.status === "GAP").map((r) => r.agentId);
  const issueLines = results.flatMap((r) => r.issues.map((i) => `${r.agentId}: ${i}`));
  return {
    results,
    gaps,
    overlaps: [],
    verifyPassed: run.verifyPassed,
    summary:
      issueLines.slice(0, 3).join(" · ") ||
      `${results.map((r) => `${r.agentId}=${r.status}`).join(", ")}; verify ${
        run.verifyPassed ? "passed" : "failed/pending"
      }`,
  };
}

export function AggregateReport({ report }: { report: AggregateReportData }) {
  return (
    <div className={styles.panelBlock} data-testid="aggregate-report">
      <h2>Report</h2>
      <p className={styles.muted}>{report.summary}</p>
      <p>
        Verify:{" "}
        <span className={`${styles.badge} ${report.verifyPassed ? styles.badgeOk : styles.badgeWarn}`}>
          {report.verifyPassed ? "passed" : "failed / pending"}
        </span>
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
