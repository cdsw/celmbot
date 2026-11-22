import styles from "./DisclaimerModal.module.scss";

export function DisclaimerModal({ onAccept }: { onAccept: () => void }) {
  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="disclaimer-title">
      <div className={styles.card}>
        <h2 id="disclaimer-title">Welcome to CelmBot</h2>
        <p>
          CelmBot is a <strong>local agent host</strong> for verification-first workflows on free models.
          Treat it as a sandbox — don’t leave it alone on a real repo.
        </p>
        <p>
          Inspired by Lauren Tan’s <strong>pstack</strong> (MIT): prove it works, skills, careful parallelism —
          on a localhost host with operator chat. This app is not the pstack plugin and does not clone Cursor
          Plan / Agent / Ask modes.
        </p>
        <ul>
          <li>
            Loop: setup → Solo/Swarm chrome → Send in chat → approve → read the report → send again (queued
            while busy).
          </li>
          <li>Localhost only. No telemetry.</li>
          <li>Your keys, your endpoints — we don’t ship any.</li>
          <li>It can edit files and run recipes inside the scopes you set. Watch the approvals.</li>
          <li>Free models will feel slow and capped. That’s normal.</li>
        </ul>
        <button type="button" onClick={onAccept}>
          I understand — continue
        </button>
      </div>
    </div>
  );
}
