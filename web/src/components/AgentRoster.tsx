import styles from "../App.module.scss";

export interface RosterAgent {
  id: string;
  role: string;
  status?: string;
  writeAllow?: string[];
  brief?: string;
  keyId?: string;
  reportStatus?: string;
}

export function AgentRoster({
  agents,
  activeAgentId,
}: {
  agents: RosterAgent[];
  activeAgentId?: string;
}) {
  if (!agents?.length) return null;
  const workers = agents.filter((a) => a.role === "worker");
  const activeWorkers = workers.filter((a) => a.status === "running" || a.status === "waiting_approval").length;
  return (
    <div className={styles.panelBlock} data-testid="agent-roster">
      <h2>Agents</h2>
      <p className={styles.muted}>
        {workers.length} workers registered / {activeWorkers} active
        {activeAgentId ? ` · active ${activeAgentId}` : ""}
      </p>
      <ul className={styles.list}>
        {agents.map((a) => (
          <li key={a.id}>
            <div>
              <strong>{a.id}</strong> <span className={styles.badge}>{a.role}</span>{" "}
              <span className={styles.badge}>{a.status ?? "idle"}</span>
              {a.reportStatus ? <span className={`${styles.badge} ${styles.badgeOk}`}>{a.reportStatus}</span> : null}
            </div>
            <div className={styles.mono}>
              {(a.writeAllow ?? []).join(", ") || "(no write scope)"}
              {a.keyId ? ` · key ${a.keyId}` : ""}
            </div>
            {a.brief ? <p className={styles.muted}>{a.brief.slice(0, 160)}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
