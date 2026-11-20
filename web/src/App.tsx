import { useEffect, useMemo, useState } from "react";
import { api, type Catalog, type Key } from "./api";
import { CodeEditor } from "./components/CodeEditor";
import { DisclaimerModal } from "./components/DisclaimerModal";
import { FileTree } from "./components/FileTree";
import { GitPanel } from "./components/GitPanel";
import styles from "./App.module.scss";

interface RunEvent {
  id: string;
  type: string;
  message?: string;
  data?: Record<string, unknown>;
  ts: number;
  keyId?: string;
}

interface RunState {
  id: string;
  status: string;
  task: string;
  events: RunEvent[];
  pendingApproval?: {
    id: string;
    summary: string;
    diff?: string;
  };
  stats: Record<string, unknown>;
  filesTouched: string[];
  verifyPassed: boolean;
  agents: Array<{ id: string; role: string; writeAllow: string[] }>;
}

interface EditorTab {
  path: string;
  language: string;
  content: string;
  saved: string;
  truncated?: boolean;
}

export default function App() {
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [sideTab, setSideTab] = useState<"files" | "git">("files");
  const [agentTab, setAgentTab] = useState<"agent" | "keys">("agent");
  const [poolTab, setPoolTab] = useState<"cloud" | "local">("cloud");
  const [keys, setKeys] = useState<{ cloud: Key[]; local: Key[] }>({ cloud: [], local: [] });
  const [catalogs, setCatalogs] = useState<{ cloud: Catalog[]; local: Catalog[] }>({ cloud: [], local: [] });
  const [runMode, setRunMode] = useState("ask");
  const [projectRoot, setProjectRoot] = useState("");
  const [projectDraft, setProjectDraft] = useState("");
  const [writeAllow, setWriteAllow] = useState("src/**");
  const [task, setTask] = useState("Add a helloName(name) helper in src/ and make npm test pass.");
  const [verifyRecipe, setVerifyRecipe] = useState("npm_test");
  const [mode, setMode] = useState<"solo" | "orchestrated">("solo");
  const [run, setRun] = useState<RunState | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [lifetime, setLifetime] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState({
    providerId: "openrouter",
    label: "",
    baseUrl: "",
    apiKey: "",
    model: "",
    rpm: 20,
    rpd: 50,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [treeKey, setTreeKey] = useState(0);
  const [gitKey, setGitKey] = useState(0);
  const [branch, setBranch] = useState<string | null>(null);

  const activeTab = tabs.find((t) => t.path === activePath) ?? null;
  const dirtyCount = tabs.filter((t) => t.content !== t.saved).length;

  const refresh = async () => {
    const [cfg, k, cats, life] = await Promise.all([
      api.getConfig() as Promise<{
        runMode: string;
        disclaimerAcceptedAt?: string;
        lastProjectRoot?: string;
      }>,
      api.getKeys(),
      api.catalogs(),
      api.stats() as Promise<Record<string, unknown>>,
    ]);
    setRunMode(cfg.runMode);
    setShowDisclaimer(!cfg.disclaimerAcceptedAt);
    setKeys(k);
    setCatalogs(cats);
    setLifetime(life);
    if (cfg.lastProjectRoot && !projectRoot) {
      setProjectDraft(cfg.lastProjectRoot);
      setProjectRoot(cfg.lastProjectRoot);
    }
    const list = poolTab === "cloud" ? cats.cloud : cats.local;
    if (list[0] && !form.baseUrl) {
      setForm((f) => ({
        ...f,
        providerId: list[0].id,
        baseUrl: list[0].baseUrl,
        model: list[0].defaultModel,
        rpm: list[0].rpm,
        rpd: list[0].rpd,
        label: list[0].name,
      }));
    }
  };

  useEffect(() => {
    void refresh().catch((e) => setError(String(e.message ?? e)));
  }, []);

  useEffect(() => {
    if (!projectRoot) return;
    void api
      .gitStatus(projectRoot)
      .then((s) => setBranch(s.isRepo ? s.branch ?? "HEAD" : null))
      .catch(() => setBranch(null));
  }, [projectRoot, gitKey]);

  useEffect(() => {
    if (!run?.id) return;
    const es = new EventSource(`/api/runs/${run.id}/events`);
    const handler = (type: string) => (ev: MessageEvent) => {
      const data = JSON.parse(ev.data) as RunEvent;
      setEvents((prev) => [...prev, data]);
      if (type === "stats" && data.data) setStats(data.data);
      if (type === "approval" || type === "done" || type === "status") {
        void api.getRun(run.id).then((r) => setRun(r as RunState));
      }
      if (type === "tool_result" || type === "done") {
        setTreeKey((n) => n + 1);
        setGitKey((n) => n + 1);
      }
    };
    for (const t of ["status", "llm", "tool_request", "tool_result", "queue", "approval", "stats", "error", "done", "verify"]) {
      es.addEventListener(t, handler(t) as EventListener);
    }
    return () => es.close();
  }, [run?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void (async () => {
          const tab = tabs.find((t) => t.path === activePath);
          if (!projectRoot || !tab || tab.content === tab.saved) return;
          try {
            await api.writeFile(projectRoot, tab.path, tab.content);
            setTabs((prev) => prev.map((t) => (t.path === tab.path ? { ...t, saved: t.content } : t)));
            setGitKey((n) => n + 1);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        })();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [projectRoot, activePath, tabs]);

  const catalogList = poolTab === "cloud" ? catalogs.cloud : catalogs.local;
  const keyList = poolTab === "cloud" ? keys.cloud : keys.local;

  const applyCatalog = (id: string) => {
    const c = catalogList.find((x) => x.id === id);
    if (!c) return;
    setForm((f) => ({
      ...f,
      providerId: c.id,
      baseUrl: c.baseUrl,
      model: c.defaultModel,
      rpm: c.rpm,
      rpd: c.rpd,
      label: c.name,
    }));
  };

  const acceptDisclaimer = async () => {
    await api.putConfig({ disclaimerAcceptedAt: new Date().toISOString() });
    setShowDisclaimer(false);
  };

  const openProject = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.openWorkspace(projectDraft.trim());
      setProjectRoot(res.projectRoot);
      setTabs([]);
      setActivePath(null);
      setTreeKey((n) => n + 1);
      setGitKey((n) => n + 1);
      setBranch(res.git.isRepo ? res.git.branch ?? "HEAD" : null);
      setSideTab("files");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (filePath: string) => {
    if (!projectRoot) return;
    const existing = tabs.find((t) => t.path === filePath);
    if (existing) {
      setActivePath(filePath);
      return;
    }
    setError(null);
    try {
      const file = await api.readFile(projectRoot, filePath);
      setTabs((prev) => [
        ...prev,
        {
          path: file.path,
          language: file.language,
          content: file.content,
          saved: file.content,
          truncated: file.truncated,
        },
      ]);
      setActivePath(file.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const closeTab = (filePath: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== filePath);
      if (activePath === filePath) {
        setActivePath(next[next.length - 1]?.path ?? null);
      }
      return next;
    });
  };

  const updateActiveContent = (content: string) => {
    if (!activePath) return;
    setTabs((prev) => prev.map((t) => (t.path === activePath ? { ...t, content } : t)));
  };

  const saveActive = async () => {
    if (!projectRoot || !activeTab) return;
    setBusy(true);
    setError(null);
    try {
      await api.writeFile(projectRoot, activeTab.path, activeTab.content);
      setTabs((prev) =>
        prev.map((t) => (t.path === activeTab.path ? { ...t, saved: t.content } : t))
      );
      setGitKey((n) => n + 1);
      setTreeKey((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addKey = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.addKey({
        pool: poolTab,
        providerId: form.providerId,
        label: form.label || form.model,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey || undefined,
        model: form.model,
        rpm: Number(form.rpm),
        rpd: Number(form.rpd),
        enabled: true,
      });
      setForm((f) => ({ ...f, apiKey: "" }));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!projectRoot) return;
    setBusy(true);
    setError(null);
    setEvents([]);
    try {
      await api.putConfig({ runMode });
      const state = (await api.startRun({
        task,
        projectRoot,
        writeAllow: writeAllow
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
        verifyRecipe,
        mode,
        workerCount: 2,
      })) as RunState;
      setRun(state);
      setStats(state.stats);
      setEvents(state.events ?? []);
      setAgentTab("agent");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const strip = useMemo(() => {
    const s = stats ?? run?.stats ?? {};
    return [
      ["status", run?.status ?? "idle"],
      ["llm", String(s.llmCalls ?? 0)],
      ["latency", s.latencyLastMs != null ? `${s.latencyLastMs}ms` : "—"],
      ["429s", String(s.rateLimitHits ?? 0)],
      ["verify", run?.verifyPassed ? "pass" : "—"],
    ] as const;
  }, [stats, run]);

  return (
    <div className={styles.ide}>
      {showDisclaimer && <DisclaimerModal onAccept={() => void acceptDisclaimer()} />}

      <header className={styles.topbar}>
        <h1 className={styles.brand}>CelmBot</h1>
        <div className={styles.projectField}>
          <input
            data-testid="project-root"
            value={projectDraft}
            onChange={(e) => setProjectDraft(e.target.value)}
            placeholder="Absolute path to project folder"
            onKeyDown={(e) => {
              if (e.key === "Enter") void openProject();
            }}
          />
          <button type="button" disabled={busy || !projectDraft.trim()} onClick={() => void openProject()}>
            Open
          </button>
        </div>
        <div className={styles.topActions}>
          <button
            type="button"
            className={styles.secondary}
            disabled={!activeTab || activeTab.content === activeTab.saved || busy}
            onClick={() => void saveActive()}
          >
            Save
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <div className={styles.sideTabs}>
            <button
              type="button"
              className={`${styles.sideTab} ${sideTab === "files" ? styles.sideTabActive : ""}`}
              onClick={() => setSideTab("files")}
            >
              Files
            </button>
            <button
              type="button"
              className={`${styles.sideTab} ${sideTab === "git" ? styles.sideTabActive : ""}`}
              onClick={() => setSideTab("git")}
            >
              Git
            </button>
          </div>
          <div className={styles.sideBody}>
            {!projectRoot && <p className={styles.muted}>Open a project folder to browse files and git.</p>}
            {projectRoot && sideTab === "files" && (
              <FileTree
                projectRoot={projectRoot}
                activePath={activePath}
                onOpen={(p) => void openFile(p)}
                refreshKey={treeKey}
              />
            )}
            {projectRoot && sideTab === "git" && (
              <GitPanel
                projectRoot={projectRoot}
                refreshKey={gitKey}
                onRefresh={() => {
                  setTreeKey((n) => n + 1);
                  setGitKey((n) => n + 1);
                }}
                onOpenFile={(p) => void openFile(p)}
              />
            )}
          </div>
        </aside>

        <main className={styles.editorPane}>
          <div className={styles.tabs}>
            {tabs.map((t) => (
              <div
                key={t.path}
                className={`${styles.tab} ${t.path === activePath ? styles.tabActive : ""} ${
                  t.content !== t.saved ? styles.dirty : ""
                }`}
                title={t.path}
              >
                <button type="button" className={styles.tabLabel} onClick={() => setActivePath(t.path)}>
                  {t.path.split("/").pop()}
                </button>
                <button
                  type="button"
                  className={styles.tabClose}
                  onClick={() => closeTab(t.path)}
                  aria-label={`Close ${t.path}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className={styles.editorHost} data-testid="editor-host">
            {activeTab ? (
              <CodeEditor
                path={activeTab.path}
                language={activeTab.language}
                value={activeTab.content}
                onChange={updateActiveContent}
              />
            ) : (
              <div className={styles.emptyEditor}>
                <div>
                  <strong>CelmBot</strong>
                  Open a project, then pick a file from the sidebar.
                  <br />
                  Monaco editor · local git · verification-first agents
                </div>
              </div>
            )}
          </div>
        </main>

        <aside className={styles.agentPane}>
          <div className={styles.agentTabs}>
            <button
              type="button"
              className={`${styles.sideTab} ${agentTab === "agent" ? styles.sideTabActive : ""}`}
              onClick={() => setAgentTab("agent")}
            >
              Agent
            </button>
            <button
              type="button"
              className={`${styles.sideTab} ${agentTab === "keys" ? styles.sideTabActive : ""}`}
              onClick={() => setAgentTab("keys")}
            >
              Keys
            </button>
          </div>
          <div className={styles.agentBody}>
            {error && <p className={styles.error}>{error}</p>}

            {agentTab === "agent" && (
              <div className={styles.panelBlock}>
                <h2>Run</h2>
                <label>
                  Run mode
                  <select value={runMode} onChange={(e) => setRunMode(e.target.value)}>
                    <option value="ask">Ask (approve writes/recipes)</option>
                    <option value="allowlist">Allowlist</option>
                    <option value="run-everything">Run Everything (dangerous)</option>
                  </select>
                </label>
                <label>
                  Mode
                  <select value={mode} onChange={(e) => setMode(e.target.value as "solo" | "orchestrated")}>
                    <option value="solo">Solo</option>
                    <option value="orchestrated">Orchestrated</option>
                  </select>
                </label>
                <label>
                  Write allow globs
                  <textarea data-testid="write-allow" value={writeAllow} onChange={(e) => setWriteAllow(e.target.value)} />
                </label>
                <label>
                  Task
                  <textarea data-testid="task" value={task} onChange={(e) => setTask(e.target.value)} />
                </label>
                <label>
                  Verify recipe
                  <input value={verifyRecipe} onChange={(e) => setVerifyRecipe(e.target.value)} />
                </label>
                <div className={styles.row}>
                  <button type="button" data-testid="start-run" disabled={busy || !projectRoot} onClick={() => void start()}>
                    Start
                  </button>
                  {run && (
                    <>
                      <button type="button" className={styles.secondary} onClick={() => void api.pause(run.id)}>
                        Pause
                      </button>
                      <button type="button" className={styles.secondary} onClick={() => void api.resume(run.id)}>
                        Resume
                      </button>
                    </>
                  )}
                </div>
                <p className={styles.muted}>Agent writes stay jail + allowlist. Editor Save can write any non-protected file in the project.</p>

                {run?.pendingApproval && (
                  <div className={styles.approval} data-testid="approval-card">
                    <strong>Approval needed</strong>
                    <p className={styles.muted}>{run.pendingApproval.summary}</p>
                    {run.pendingApproval.diff && <pre className={styles.diff}>{run.pendingApproval.diff}</pre>}
                    <div className={styles.row}>
                      <button type="button" onClick={() => void api.approve(run.id, "allow")}>
                        Allow once
                      </button>
                      <button type="button" className={styles.secondary} onClick={() => void api.approve(run.id, "allowlist")}>
                        Allowlist
                      </button>
                      <button type="button" className={styles.danger} onClick={() => void api.approve(run.id, "deny")}>
                        Deny
                      </button>
                    </div>
                  </div>
                )}

                <h2>Timeline</h2>
                <div className={styles.timeline} data-testid="timeline">
                  {events.map((ev) => (
                    <div
                      key={ev.id}
                      className={`${styles.event} ${ev.type === "error" ? styles.eventError : ""} ${
                        ev.type === "verify" ? styles.eventVerify : ""
                      }`}
                    >
                      <strong>{ev.type}</strong>
                      {ev.keyId ? ` · ${ev.keyId}` : ""}
                      {ev.message ? ` — ${ev.message}` : ""}
                    </div>
                  ))}
                  {!events.length && <p className={styles.muted}>Events stream here when a run starts.</p>}
                </div>
              </div>
            )}

            {agentTab === "keys" && (
              <div className={styles.panelBlock}>
                <h2>Keys</h2>
                <div className={styles.row}>
                  <button
                    type="button"
                    className={`${styles.secondary} ${poolTab === "cloud" ? "" : ""}`}
                    onClick={() => setPoolTab("cloud")}
                  >
                    Cloud
                  </button>
                  <button type="button" className={styles.secondary} onClick={() => setPoolTab("local")}>
                    Local
                  </button>
                </div>
                <label>
                  Preset
                  <select value={form.providerId} onChange={(e) => applyCatalog(e.target.value)}>
                    {catalogList.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Base URL
                  <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
                </label>
                <label>
                  Model
                  <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
                </label>
                <label>
                  API key {poolTab === "local" ? "(optional)" : ""}
                  <input
                    type="password"
                    value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                    autoComplete="off"
                  />
                </label>
                <div className={styles.row}>
                  <label>
                    RPM
                    <input
                      type="number"
                      value={form.rpm}
                      onChange={(e) => setForm({ ...form, rpm: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    RPD
                    <input
                      type="number"
                      value={form.rpd}
                      onChange={(e) => setForm({ ...form, rpd: Number(e.target.value) })}
                    />
                  </label>
                </div>
                <button type="button" disabled={busy} onClick={() => void addKey()}>
                  Add {poolTab} key
                </button>
                <ul className={styles.list}>
                  {keyList.map((k) => (
                    <li key={k.id}>
                      <div>
                        <strong>{k.label}</strong> <span className={styles.badge}>{k.pool}</span>{" "}
                        {k.supportsTools ? <span className={`${styles.badge} ${styles.badgeOk}`}>tools</span> : null}
                        {k.degradedMode ? <span className={`${styles.badge} ${styles.badgeWarn}`}>degraded</span> : null}
                      </div>
                      <div className={styles.mono}>
                        {k.model}
                        {k.lastLatencyMs != null ? ` · ${k.lastLatencyMs}ms` : ""}
                      </div>
                      <div className={styles.row}>
                        <button
                          type="button"
                          className={styles.secondary}
                          onClick={() => void api.probeKey(k.id).then(refresh)}
                        >
                          Probe
                        </button>
                        <button
                          type="button"
                          className={styles.danger}
                          onClick={() => void api.deleteKey(k.id).then(refresh)}
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                  {!keyList.length && <li className={styles.muted}>No {poolTab} keys yet.</li>}
                </ul>
              </div>
            )}
          </div>
        </aside>
      </div>

      <footer className={styles.statusBar} data-testid="stats-strip">
        <span>
          branch: <strong>{branch ?? "—"}</strong>
        </span>
        <span>
          dirty tabs: <strong>{dirtyCount}</strong>
        </span>
        {strip.map(([k, v]) => (
          <span key={k}>
            {k}: <strong>{v}</strong>
          </span>
        ))}
        {lifetime && (
          <span>
            lifetime llm: {String(lifetime.totalLlmCalls ?? 0)} · runs: {String(lifetime.totalRuns ?? 0)}
          </span>
        )}
        <button
          type="button"
          className={styles.secondary}
          onClick={() => void api.clearStats().then((s) => setLifetime(s as Record<string, unknown>))}
        >
          Clear stats
        </button>
      </footer>
    </div>
  );
}
