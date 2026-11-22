import styles from "./DisclaimerModal.module.scss";

export function UserGuideModal({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="guide-title">
      <div className={`${styles.card} ${styles.guideCard}`}>
        <div className={styles.guideHead}>
          <h2 id="guide-title">CelmBot guide</h2>
          <button type="button" className={styles.ghost} onClick={onClose} aria-label="Close guide">
            Close
          </button>
        </div>

        <section>
          <h3>1. Setup once</h3>
          <p>
            Paste an absolute folder path and click <strong>Open</strong>. Add Cloud or Local keys under{" "}
            <strong>Keys</strong>, then Probe. Prefer keys with a <strong>tools</strong> badge.
          </p>
        </section>

        <section>
          <h3>2. Chrome + Send</h3>
          <p>
            On <strong>Agent</strong>, set playbook (<strong>Solo</strong> or <strong>Swarm</strong>), write
            policy, write allow globs, and verify recipe. Type a goal in the operator chat and press{" "}
            <strong>Send</strong>. Prove-it-works attaches automatically; extra skills live under Advanced.
          </p>
        </section>

        <section>
          <h3>3. Approve + watch</h3>
          <p>
            Stay on Agent for Allow / Deny and the roster. Workers do not have chatboxes. Open{" "}
            <strong>Activity</strong> for the full event log. Rate-limit waits show in the queue banner.
          </p>
        </section>

        <section>
          <h3>4. Report → send again</h3>
          <p>
            When a run finishes, the aggregate report (PASS / ISSUES / BLOCKED / GAP + verify) appears in the
            chat transcript and as a Report card. Send another message to continue. If a run is still active,
            the message is queued and starts after the current run ends.
          </p>
        </section>

        <section>
          <h3>Host limits</h3>
          <ul>
            <li>CelmBot does not host the pstack plugin, slash menu, or Cursor Plan / Agent / Ask modes.</li>
            <li>Arena, interrogate, and overnight cloud autopilot are out of scope for this gym.</li>
            <li>Agents stay inside the project jail + write allowlist. Recipes are not a raw shell.</li>
          </ul>
        </section>

        <p className={styles.guideFoot}>
          Localhost only · your keys · free models will feel slow and rate-limited. That is expected.
        </p>

        <button type="button" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
