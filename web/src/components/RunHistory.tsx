import styles from "../App.module.scss";

export interface RunSummary {
  id: string;
  updatedAt: number;
  status: string;
  task: string;
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
    <div className={styles.panelBlock} data-testid="run-history">
      <h2>Recent runs</h2>
      <ul className={styles.list}>
        {runs.slice(0, 8).map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => onSelect(r.id)}
              disabled={r.id === activeId}
            >
              {r.status} · {r.task.slice(0, 40)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
