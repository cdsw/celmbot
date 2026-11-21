import styles from "../App.module.scss";

export interface ApprovalItem {
  id: string;
  summary: string;
  diff?: string;
  agentId?: string;
}

export function ApprovalCard({
  approvals,
  onDecide,
}: {
  approvals: ApprovalItem[];
  onDecide: (id: string, decision: "allow" | "deny" | "allowlist") => void;
}) {
  if (!approvals.length) return null;
  return (
    <div>
      {approvals.map((pending) => (
        <div key={pending.id} className={styles.approval} data-testid="approval-card">
          <strong>Approval needed</strong>
          {pending.agentId ? <p className={styles.muted}>Agent: {pending.agentId}</p> : null}
          <p className={styles.muted}>{pending.summary}</p>
          {pending.diff && <pre className={styles.diff}>{pending.diff}</pre>}
          <div className={styles.row}>
            <button type="button" onClick={() => onDecide(pending.id, "allow")}>
              Allow once
            </button>
            <button type="button" className={styles.secondary} onClick={() => onDecide(pending.id, "allowlist")}>
              Allowlist
            </button>
            <button type="button" className={styles.danger} onClick={() => onDecide(pending.id, "deny")}>
              Deny
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
