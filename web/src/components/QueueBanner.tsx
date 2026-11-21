import styles from "../App.module.scss";

export function QueueBanner({
  message,
  cooldownUntil,
  waiting,
}: {
  message?: string;
  cooldownUntil?: number;
  waiting?: boolean;
}) {
  if (!message && !waiting && !cooldownUntil) return null;
  const cool =
    cooldownUntil && cooldownUntil > Date.now()
      ? `cooldown ${Math.ceil((cooldownUntil - Date.now()) / 1000)}s`
      : null;
  return (
    <div className={styles.approval} data-testid="queue-banner" role="status">
      <strong>Queue</strong>
      <p className={styles.muted}>
        {message ?? "Waiting on rate limits"}
        {cool ? ` · ${cool}` : ""}
        {waiting ? " · jobs waiting" : ""}
      </p>
    </div>
  );
}
