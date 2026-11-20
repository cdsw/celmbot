import { useEffect, useState } from "react";
import { api, type FsEntry } from "../api";
import styles from "./FileTree.module.scss";

function TreeNode({
  projectRoot,
  entry,
  depth,
  activePath,
  onOpen,
}: {
  projectRoot: string;
  entry: FsEntry;
  depth: number;
  activePath: string | null;
  onOpen: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (entry.type !== "dir" || !open) return;
    let cancelled = false;
    void api
      .listDir(projectRoot, entry.path)
      .then((r) => {
        if (!cancelled) setChildren(r.entries);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectRoot, entry.path, entry.type, open]);

  if (entry.type === "file") {
    return (
      <button
        type="button"
        className={`${styles.row} ${activePath === entry.path ? styles.active : ""}`}
        style={{ paddingLeft: `${0.45 + depth * 0.7}rem` }}
        onClick={() => onOpen(entry.path)}
        title={entry.path}
      >
        <span className={styles.icon}>·</span>
        {entry.name}
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        className={styles.row}
        style={{ paddingLeft: `${0.45 + depth * 0.7}rem` }}
        onClick={() => setOpen((v) => !v)}
        title={entry.path}
      >
        <span className={styles.icon}>{open ? "▾" : "▸"}</span>
        {entry.name}
      </button>
      {open && (
        <div>
          {error && <div className={styles.error}>{error}</div>}
          {children?.map((c) => (
            <TreeNode
              key={c.path}
              projectRoot={projectRoot}
              entry={c}
              depth={depth + 1}
              activePath={activePath}
              onOpen={onOpen}
            />
          ))}
          {children && !children.length && !error && <div className={styles.empty}>Empty</div>}
        </div>
      )}
    </div>
  );
}

export function FileTree({
  projectRoot,
  activePath,
  onOpen,
  refreshKey,
}: {
  projectRoot: string;
  activePath: string | null;
  onOpen: (path: string) => void;
  refreshKey: number;
}) {
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .listDir(projectRoot, ".")
      .then((r) => {
        if (!cancelled) {
          setEntries(r.entries);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [projectRoot, refreshKey]);

  return (
    <div className={styles.tree} data-testid="file-tree">
      {error && <div className={styles.error}>{error}</div>}
      {entries.map((e) => (
        <TreeNode
          key={`${refreshKey}:${e.path}`}
          projectRoot={projectRoot}
          entry={e}
          depth={0}
          activePath={activePath}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
