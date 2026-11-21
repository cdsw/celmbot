import styles from "../App.module.scss";
import type { TimelineEvent } from "./EventTimeline";

export function ActivityTeaser({
  events,
  runStatus,
  onOpen,
}: {
  events: TimelineEvent[];
  runStatus?: string;
  onOpen: () => void;
}) {
  if (!events.length && !runStatus) return null;
  const latest = events[events.length - 1];
  const summary = latest
    ? `${latest.type}${latest.message ? ` — ${latest.message.slice(0, 72)}` : ""}`
    : "Waiting for events…";

  return (
    <div className={styles.activityTeaser} data-testid="activity-teaser">
      <div>
        <strong>{runStatus ? `Run · ${runStatus}` : "Activity"}</strong>
        <p className={styles.muted}>
          {events.length} event{events.length === 1 ? "" : "s"} · {summary}
        </p>
      </div>
      <button type="button" className={styles.secondary} onClick={onOpen}>
        Open Activity
      </button>
    </div>
  );
}
