import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { api, type FsEntry } from "../api";
import styles from "./FileTree.module.scss";

export type FsChange =
  | { type: "created"; kind: "file" | "folder"; path: string }
  | { type: "deleted"; path: string; kind: "file" | "dir" }
  | { type: "moved"; from: string; to: string; kind: "file" | "dir" };

type PromptKind = "new-file" | "new-folder" | "rename";

interface MenuState {
  x: number;
  y: number;
  target: { path: string; type: "file" | "dir" | "root" };
}

interface PromptState {
  kind: PromptKind;
  baseDir: string;
  initial: string;
  title: string;
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(0, i) : "";
}

function joinPath(dir: string, name: string): string {
  const clean = name.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!dir || dir === ".") return clean;
  return `${dir.replace(/\/+$/, "")}/${clean}`;
}

function isUnder(path: string, parent: string): boolean {
  return path === parent || path.startsWith(`${parent}/`);
}

function TreeNode({
  projectRoot,
  entry,
  depth,
  activePath,
  dropTarget,
  draggingPath,
  onOpen,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDragOverTarget,
  onDropOn,
}: {
  projectRoot: string;
  entry: FsEntry;
  depth: number;
  activePath: string | null;
  dropTarget: string | null;
  draggingPath: string | null;
  onOpen: (path: string) => void;
  onContextMenu: (e: ReactMouseEvent, entry: FsEntry) => void;
  onDragStart: (e: ReactDragEvent, entry: FsEntry) => void;
  onDragEnd: () => void;
  onDragOverTarget: (path: string | null) => void;
  onDropOn: (targetDir: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isDrop = entry.type === "dir" && dropTarget === entry.path;
  const isDragging = draggingPath === entry.path;

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

  useEffect(() => {
    if (entry.type === "dir" && dropTarget === entry.path && !open) setOpen(true);
  }, [dropTarget, entry.path, entry.type, open]);

  const rowClass = [
    styles.row,
    entry.type === "file" && activePath === entry.path ? styles.active : "",
    isDrop ? styles.dropTarget : "",
    isDragging ? styles.dragging : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (entry.type === "file") {
    return (
      <button
        type="button"
        className={rowClass}
        style={{ paddingLeft: `${0.45 + depth * 0.7}rem` }}
        onClick={() => onOpen(entry.path)}
        onContextMenu={(e) => onContextMenu(e, entry)}
        title={entry.path}
        draggable
        onDragStart={(e) => onDragStart(e, entry)}
        onDragEnd={onDragEnd}
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
        className={rowClass}
        style={{ paddingLeft: `${0.45 + depth * 0.7}rem` }}
        onClick={() => setOpen((v) => !v)}
        onContextMenu={(e) => onContextMenu(e, entry)}
        title={entry.path}
        draggable
        onDragStart={(e) => onDragStart(e, entry)}
        onDragEnd={onDragEnd}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDragOverTarget(entry.path);
        }}
        onDragLeave={(e) => {
          e.stopPropagation();
          onDragOverTarget(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDropOn(entry.path);
        }}
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
              dropTarget={dropTarget}
              draggingPath={draggingPath}
              onOpen={onOpen}
              onContextMenu={onContextMenu}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragOverTarget={onDragOverTarget}
              onDropOn={onDropOn}
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
  onFsChange,
  refreshKey,
}: {
  projectRoot: string;
  activePath: string | null;
  onOpen: (path: string) => void;
  onFsChange: (change: FsChange) => void;
  refreshKey: number;
}) {
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<FsEntry | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (prompt) {
      setDraft(prompt.initial);
      queueMicrotask(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [prompt]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const openMenu = (e: ReactMouseEvent, target: MenuState["target"]) => {
    e.preventDefault();
    e.stopPropagation();
    const pad = 8;
    const w = 180;
    const h = 220;
    const x = Math.min(e.clientX, window.innerWidth - w - pad);
    const y = Math.min(e.clientY, window.innerHeight - h - pad);
    setMenu({ x: Math.max(pad, x), y: Math.max(pad, y), target });
    setPrompt(null);
  };

  const startPrompt = (kind: PromptKind, target: MenuState["target"]) => {
    setMenu(null);
    if (kind === "rename") {
      if (target.type === "root") return;
      setPrompt({
        kind,
        baseDir: dirname(target.path),
        initial: basename(target.path),
        title: "Rename",
      });
      return;
    }
    const baseDir = target.type === "file" ? dirname(target.path) : target.type === "dir" ? target.path : "";
    setPrompt({
      kind,
      baseDir,
      initial: "",
      title: kind === "new-file" ? "New file" : "New folder",
    });
  };

  const cancelPrompt = () => setPrompt(null);

  const submitPrompt = async () => {
    if (!prompt || busy) return;
    const name = draft.trim().replace(/\\/g, "/");
    if (!name || name.includes("..")) {
      setError("Enter a valid name");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (prompt.kind === "new-file") {
        const path = joinPath(prompt.baseDir, name);
        const res = await api.writeFile(projectRoot, path, "", { createOnly: true });
        setPrompt(null);
        onFsChange({ type: "created", kind: "file", path: res.path });
      } else if (prompt.kind === "new-folder") {
        const path = joinPath(prompt.baseDir, name);
        const res = await api.mkdir(projectRoot, path);
        setPrompt(null);
        onFsChange({ type: "created", kind: "folder", path: res.path });
      } else {
        const to = joinPath(prompt.baseDir, name);
        const from = joinPath(prompt.baseDir, prompt.initial);
        if (to === from) {
          setPrompt(null);
          return;
        }
        const res = await api.movePath(projectRoot, from, to);
        setPrompt(null);
        onFsChange({ type: "moved", from: res.from, to: res.to, kind: res.type });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deleteTarget = async (target: MenuState["target"]) => {
    setMenu(null);
    if (target.type === "root") return;
    const label = target.type === "dir" ? `folder "${target.path}" and its contents` : `"${target.path}"`;
    if (!window.confirm(`Delete ${label}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.deletePath(projectRoot, target.path);
      onFsChange({ type: "deleted", path: res.path, kind: res.type });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const moveInto = async (from: FsEntry, targetDir: string) => {
    if (from.path === targetDir || (from.type === "dir" && isUnder(targetDir, from.path))) {
      setError("Cannot move a folder into itself");
      return;
    }
    const destParent = targetDir === "." || targetDir === "" ? "" : targetDir;
    const currentParent = dirname(from.path);
    if (destParent === currentParent) return;
    const to = joinPath(destParent, from.name);
    setBusy(true);
    setError(null);
    try {
      const res = await api.movePath(projectRoot, from.path, to);
      onFsChange({ type: "moved", from: res.from, to: res.to, kind: res.type });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`${styles.tree} ${dropTarget === "." ? styles.dropRoot : ""}`}
      data-testid="file-tree"
      onContextMenu={(e) => openMenu(e, { path: ".", type: "root" })}
      onDragOver={(e) => {
        if (!dragging) return;
        e.preventDefault();
        setDropTarget(".");
      }}
      onDragLeave={() => setDropTarget((t) => (t === "." ? null : t))}
      onDrop={(e) => {
        e.preventDefault();
        if (dragging) void moveInto(dragging, "");
        setDragging(null);
        setDropTarget(null);
      }}
    >
      <p className={styles.hint}>Right-click for new / rename / delete. Drag onto a folder to move.</p>

      {prompt && (
        <form
          className={styles.createForm}
          onSubmit={(e) => {
            e.preventDefault();
            void submitPrompt();
          }}
        >
          <label>
            {prompt.title}
            {prompt.baseDir ? ` in ${prompt.baseDir}` : " at project root"}
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={prompt.kind === "new-folder" ? "utils" : "hello.ts"}
              disabled={busy}
              data-testid="create-path"
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelPrompt();
              }}
            />
          </label>
          <div className={styles.createActions}>
            <button type="submit" disabled={busy || !draft.trim()}>
              {prompt.kind === "rename" ? "Rename" : "Create"}
            </button>
            <button type="button" className={styles.toolBtn} disabled={busy} onClick={cancelPrompt}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <div className={styles.error}>{error}</div>}
      {entries.map((e) => (
        <TreeNode
          key={`${refreshKey}:${e.path}`}
          projectRoot={projectRoot}
          entry={e}
          depth={0}
          activePath={activePath}
          dropTarget={dropTarget}
          draggingPath={dragging?.path ?? null}
          onOpen={onOpen}
          onContextMenu={(ev, entry) => openMenu(ev, { path: entry.path, type: entry.type })}
          onDragStart={(ev, entry) => {
            ev.dataTransfer.effectAllowed = "move";
            ev.dataTransfer.setData("text/plain", entry.path);
            setDragging(entry);
          }}
          onDragEnd={() => {
            setDragging(null);
            setDropTarget(null);
          }}
          onDragOverTarget={setDropTarget}
          onDropOn={(targetDir) => {
            if (dragging) void moveInto(dragging, targetDir);
            setDragging(null);
            setDropTarget(null);
          }}
        />
      ))}

      {menu && (
        <div
          ref={menuRef}
          className={styles.menu}
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          data-testid="file-context-menu"
        >
          <button type="button" role="menuitem" onClick={() => startPrompt("new-file", menu.target)}>
            New file
          </button>
          <button type="button" role="menuitem" onClick={() => startPrompt("new-folder", menu.target)}>
            New folder
          </button>
          {menu.target.type !== "root" && (
            <>
              <div className={styles.menuSep} />
              {menu.target.type === "file" && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    onOpen(menu.target.path);
                  }}
                >
                  Open
                </button>
              )}
              <button type="button" role="menuitem" onClick={() => startPrompt("rename", menu.target)}>
                Rename
              </button>
              <button
                type="button"
                role="menuitem"
                className={styles.menuDanger}
                onClick={() => void deleteTarget(menu.target)}
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
