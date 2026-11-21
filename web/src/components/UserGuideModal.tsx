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
          <h3>1. Open a project</h3>
          <p>
            Paste an absolute folder path in the top bar and click <strong>Open</strong>. The file tree and
            git panel only work after a project is loaded.
          </p>
        </section>

        <section>
          <h3>2. Add keys</h3>
          <p>
            Open the <strong>Keys</strong> tab. Add a Cloud (OpenRouter/Gemini/etc.) or Local endpoint, then
            Probe. Prefer keys that show a <strong>tools</strong> badge.
          </p>
        </section>

        <section>
          <h3>3. Start a run</h3>
          <p>
            On <strong>Agent</strong>, set write allow globs (e.g. <code>src/**</code>), pick a verify recipe,
            write a small task, then <strong>Start</strong>. Approvals and the roster stay on this tab.
          </p>
        </section>

        <section>
          <h3>4. Watch Activity</h3>
          <p>
            The event stream lives under the <strong>Activity</strong> tab so it does not push the form around.
            Use the filter to focus one agent or role. Recent runs are listed below the timeline.
          </p>
        </section>

        <section>
          <h3>Run modes</h3>
          <ul>
            <li>
              <strong>Ask</strong> — approve writes and recipes before they apply.
            </li>
            <li>
              <strong>Solo</strong> — one agent; <strong>Orchestrated</strong> — scoped workers + shared
              verify.
            </li>
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
