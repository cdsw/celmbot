import { useMemo, useState } from "react";
import styles from "../App.module.scss";

export interface TimelineEvent {
  id: string;
  type: string;
  message?: string;
  data?: Record<string, unknown>;
  ts: number;
  keyId?: string;
  agentId?: string;
  role?: string;
}

export function EventTimeline({ events }: { events: TimelineEvent[] }) {
  const [filter, setFilter] = useState<string>("all");
  const agents = useMemo(() => {
    const ids = new Set<string>();
    for (const e of events) if (e.agentId) ids.add(e.agentId);
    return [...ids];
  }, [events]);
  const shown = filter === "all" ? events : events.filter((e) => e.agentId === filter || e.role === filter);

  return (
    <div className={styles.panelBlock} data-testid="timeline-panel">
      <div className={styles.timelineHeader}>
        <div>
          <h2>Timeline</h2>
          <p className={styles.muted}>
            {events.length ? `${shown.length} of ${events.length} events` : "No events yet"}
          </p>
        </div>
        <label className={styles.timelineFilter}>
          Filter
          <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter timeline">
            <option value="all">All agents</option>
            {agents.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
            <option value="worker">role:worker</option>
            <option value="orchestrator">role:orchestrator</option>
            <option value="verifier">role:verifier</option>
          </select>
        </label>
      </div>
      <div className={styles.timeline} data-testid="timeline">
        {shown.map((ev) => (
          <div
            key={ev.id}
            className={`${styles.event} ${ev.type === "error" ? styles.eventError : ""} ${
              ev.type === "verify" || ev.type === "report" ? styles.eventVerify : ""
            }`}
          >
            <strong>{ev.type}</strong>
            {ev.agentId ? ` · ${ev.agentId}` : ""}
            {ev.keyId ? ` · ${ev.keyId}` : ""}
            {ev.message ? ` — ${ev.message}` : ""}
            {ev.data && (ev.type === "queue" || ev.type === "tool_result" || ev.type === "tool_request") ? (
              <pre className={styles.diff}>{JSON.stringify(ev.data, null, 0).slice(0, 280)}</pre>
            ) : null}
          </div>
        ))}
        {!shown.length && <p className={styles.muted}>Events stream here when a run starts.</p>}
      </div>
    </div>
  );
}
