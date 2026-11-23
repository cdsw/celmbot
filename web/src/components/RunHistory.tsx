import styles from "../App.module.scss";

export interface RunSummary {
  id: string;
  updatedAt: number;
  status: string;
  task: string;
}

function relativeTime(ts: number): string {
  const delta = Date.now() - ts;
  if (!Number.isFinite(delta) || delta < 0) return "";
  const sec = Math.round(delta / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  return new Date(ts).toLocaleDateString();
}

function statusClass(status: string): string {
  if (status === "done") return styles.runStatusOk;
  if (status === "error" || status === "interrupted") return styles.runStatusBad;
  if (status === "rate_limited") return styles.runStatusWarn;
  if (status === "running" || status === "waiting_approval") return styles.runStatusLive;
  return "";
}

function taskTitle(task: string): string {
  const line = task.trim().split(/\n/)[0] ?? task;
  return line.replace(/\s+/g, " ").trim();
}

export function RunHistory({
  runs,
  activeId,
  onSelect,
}: {
  runs: RunSummary[];
  activeId?: string;
  onSelect: (id: string) => void;
}) {
  if (!runs.length) return null;
  return (
    <section className={styles.runHistory} data-testid="run-history">
      <div className={styles.runHistoryHead}>
        <h2>Recent runs</h2>
        <span className={styles.muted}>{Math.min(runs.length, 8)} shown</span>
      </div>
      <ul className={styles.runHistoryList}>
        {runs.slice(0, 8).map((r) => {
          const title = taskTitle(r.task);
          const active = r.id === activeId;
          return (
            <li key={r.id}>
              <button
                type="button"
                className={`${styles.runHistoryItem} ${active ? styles.runHistoryItemActive : ""}`}
                onClick={() => onSelect(r.id)}
                disabled={active}
                title={r.task}
              >
                <span className={`${styles.runStatus} ${statusClass(r.status)}`}>{r.status}</span>
                <span className={styles.runHistoryBody}>
                  <span className={styles.runHistoryTitle}>{title}</span>
                  <span className={styles.runHistoryWhen}>{relativeTime(r.updatedAt)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
