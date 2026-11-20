import { useEffect, useState } from "react";
import { api, type GitStatus } from "../api";
import styles from "./GitPanel.module.scss";

export function GitPanel({
  projectRoot,
  refreshKey,
  onRefresh,
  onOpenFile,
}: {
  projectRoot: string;
  refreshKey: number;
  onRefresh: () => void;
  onOpenFile: (path: string) => void;
}) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [message, setMessage] = useState("");
  const [log, setLog] = useState("");
  const [diff, setDiff] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const load = async () => {
    setError(null);
    try {
      const [st, lg] = await Promise.all([api.gitStatus(projectRoot), api.gitLog(projectRoot, 12)]);
      setStatus(st);
      setLog(lg.ok ? lg.stdout : lg.stderr);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void load();
  }, [projectRoot, refreshKey]);

  const toggle = (p: string) => {
    setSelected((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return <div className={styles.wrap}>{error ?? "Loading git…"}</div>;
  }

  if (!status.isRepo) {
    return (
      <div className={styles.wrap} data-testid="git-panel">
        <p className={styles.muted}>This folder is not a git repository.</p>
        <button type="button" disabled={busy} onClick={() => void run(() => api.gitInit(projectRoot))}>
          git init
        </button>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    );
  }

  return (
    <div className={styles.wrap} data-testid="git-panel">
      <div className={styles.branch}>
        <strong>{status.branch ?? "HEAD"}</strong>
        {(status.ahead || status.behind) && (
          <span className={styles.muted}>
            {status.ahead ? ` ↑${status.ahead}` : ""}
            {status.behind ? ` ↓${status.behind}` : ""}
          </span>
        )}
        <button type="button" className={styles.ghost} disabled={busy} onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <ul className={styles.files}>
        {status.entries.map((e) => (
          <li key={e.path}>
            <label>
              <input type="checkbox" checked={selected.includes(e.path)} onChange={() => toggle(e.path)} />
              <button type="button" className={styles.link} onClick={() => onOpenFile(e.path)}>
                {e.path}
              </button>
              <span className={styles.badge}>{e.status}</span>
            </label>
          </li>
        ))}
        {!status.entries.length && <li className={styles.muted}>Clean working tree</li>}
      </ul>

      <div className={styles.actions}>
        <button
          type="button"
          disabled={busy || !selected.length}
          onClick={() => void run(() => api.gitAdd(projectRoot, selected))}
        >
          Stage
        </button>
        <button
          type="button"
          className={styles.secondary}
          disabled={busy || !selected.length}
          onClick={() => void run(() => api.gitRestore(projectRoot, selected))}
        >
          Discard
        </button>
        <button
          type="button"
          className={styles.secondary}
          disabled={busy || !selected.length}
          onClick={() =>
            void run(async () => {
              const d = await api.gitDiff(projectRoot, { path: selected[0] });
              setDiff(d.stdout || d.stderr);
            })
          }
        >
          Diff
        </button>
      </div>

      <label className={styles.commit}>
        Commit message
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
      </label>
      <button
        type="button"
        disabled={busy || !message.trim()}
        onClick={() =>
          void run(async () => {
            const res = await api.gitCommit(projectRoot, message);
            if (!res.ok) throw new Error(res.stderr || res.stdout || "commit failed");
            setMessage("");
            setSelected([]);
          })
        }
      >
        Commit
      </button>

      {diff && (
        <pre className={styles.diff} data-testid="git-diff">
          {diff}
        </pre>
      )}

      <h3>Recent</h3>
      <pre className={styles.log}>{log || "No commits yet"}</pre>
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
