import { lazy, Suspense, useEffect, useState } from "react";
import { api, type Catalog, type Key } from "./api";
import { ActivityTeaser } from "./components/ActivityTeaser";
import { AgentRoster } from "./components/AgentRoster";
import {
  AggregateReport,
  buildAggregateFromRun,
  type AggregateReportData,
} from "./components/AggregateReport";
import { ApprovalCard } from "./components/ApprovalCard";
import { DisclaimerModal } from "./components/DisclaimerModal";
import { EventTimeline, type TimelineEvent } from "./components/EventTimeline";
import { FileTree, type FsChange } from "./components/FileTree";
import { GitPanel } from "./components/GitPanel";
import { OperatorChat, type ChatBubble } from "./components/OperatorChat";
import { QueueBanner } from "./components/QueueBanner";
import { RunChrome } from "./components/RunChrome";
import { RunHistory, type RunSummary } from "./components/RunHistory";
import { SettingsPanel } from "./components/SettingsPanel";
import { StatsStrip } from "./components/StatsStrip";
import { UserGuideModal } from "./components/UserGuideModal";

const CodeEditor = lazy(() =>
  import("./components/CodeEditor").then((m) => ({ default: m.CodeEditor })),
);
import {
  applyTheme,
  defaultUiSettings,
  loadUiSettings,
  saveUiSettings,
  type UiSettings,
} from "./settings";
import styles from "./App.module.scss";

type RunEvent = TimelineEvent;

interface RunState {
  id: string;
  status: string;
  task: string;
  events: RunEvent[];
  pendingApproval?: {
    id: string;
    summary: string;
    diff?: string;
    agentId?: string;
  };
  pendingApprovals?: Array<{
    id: string;
    summary: string;
    diff?: string;
    agentId?: string;
  }>;
  stats: Record<string, unknown>;
  filesTouched: string[];
  verifyPassed: boolean;
  activeAgentId?: string;
  aggregateReport?: AggregateReportData;
  agents: Array<{
    id: string;
    role: string;
    writeAllow?: string[];
    status?: string;
    brief?: string;
    keyId?: string;
    reportStatus?: string;
    filesTouched?: string[];
    issues?: string[];
  }>;
}

interface EditorTab {
  path: string;
  language: string;
  content: string;
  saved: string;
  truncated?: boolean;
}

export default function App() {
  const initialUi = typeof window !== "undefined" ? loadUiSettings() : defaultUiSettings();
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [sideTab, setSideTab] = useState<"files" | "git">("files");
  const [agentTab, setAgentTab] = useState<"agent" | "keys" | "activity" | "settings">("agent");
  const [poolTab, setPoolTab] = useState<"cloud" | "local">("cloud");
  const [keys, setKeys] = useState<{ cloud: Key[]; local: Key[] }>({ cloud: [], local: [] });
  const [catalogs, setCatalogs] = useState<{ cloud: Catalog[]; local: Catalog[] }>({ cloud: [], local: [] });
  const [runMode, setRunMode] = useState("ask");
  const [budget, setBudget] = useState("medium");
  const [maxParallelWorkers, setMaxParallelWorkers] = useState(3);
  const [ui, setUi] = useState<UiSettings>(initialUi);
  const [projectRoot, setProjectRoot] = useState("");
  const [projectDraft, setProjectDraft] = useState("");
  const [writeAllow, setWriteAllow] = useState(initialUi.defaultWriteAllow);
  const [verifyRecipe, setVerifyRecipe] = useState(initialUi.defaultVerifyRecipe);
  const [mode, setMode] = useState<"solo" | "orchestrated">(initialUi.defaultMode);
  const [workerCount, setWorkerCount] = useState(2);
  const [workerGlobsText, setWorkerGlobsText] = useState("");
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [skills, setSkills] = useState<Array<{ id: string; name: string }>>([]);
  const [recipes, setRecipes] = useState<Array<{ name: string; description?: string }>>([]);
  const [runHistory, setRunHistory] = useState<RunSummary[]>([]);
  const [queueInfo, setQueueInfo] = useState<{ message?: string; cooldownUntil?: number; waiting?: boolean }>({});
  const [run, setRun] = useState<RunState | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatBubble[]>([]);
  const [chatQueued, setChatQueued] = useState<string[]>([]);
  const [chatDraft, setChatDraft] = useState("");
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
        budget?: string;
        maxParallelWorkers?: number;
        disclaimerAcceptedAt?: string;
        lastProjectRoot?: string;
      }>,
      api.getKeys(),
      api.catalogs(),
      api.stats() as Promise<Record<string, unknown>>,
    ]);
    setRunMode(cfg.runMode);
    if (cfg.budget) setBudget(cfg.budget);
    if (cfg.maxParallelWorkers) {
      setMaxParallelWorkers(cfg.maxParallelWorkers);
      setWorkerCount(cfg.maxParallelWorkers);
    }
    setShowDisclaimer(!cfg.disclaimerAcceptedAt);
    setKeys(k);
    setCatalogs(cats);
    setLifetime(life);
    const [sk, rec, runs] = await Promise.all([
      api.skills() as Promise<Array<{ id: string; name: string }>>,
      api.recipes() as Promise<Array<{ name: string; description?: string }>>,
      api.listRuns() as Promise<RunSummary[]>,
    ]);
    setSkills(sk ?? []);
    setRecipes(rec ?? []);
    setRunHistory(runs ?? []);
    if (cfg.lastProjectRoot && !projectRoot) {
      setProjectDraft(cfg.lastProjectRoot);
      setProjectRoot(cfg.lastProjectRoot);
      void loadSessionForProject(cfg.lastProjectRoot).catch(() => undefined);
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
    applyTheme(ui.theme);
    saveUiSettings(ui);
  }, [ui]);

  useEffect(() => {
    void refresh().catch((e) => setError(String(e.message ?? e)));
  }, []);

  const updateUi = (next: UiSettings) => {
    setUi({
      ...next,
      editorFontSize: Math.min(22, Math.max(11, Math.round(Number(next.editorFontSize) || 13))),
    });
  };

  const saveServerSettings = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.putConfig({
        runMode,
        budget,
        maxParallelWorkers: Math.min(8, Math.max(1, Math.round(maxParallelWorkers) || 3)),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!projectRoot) return;
    void api
      .gitStatus(projectRoot)
      .then((s) => setBranch(s.isRepo ? s.branch ?? "HEAD" : null))
      .catch(() => setBranch(null));
  }, [projectRoot, gitKey]);

  useEffect(() => {
    if (!run?.id) return;
    let es = new EventSource(`/api/runs/${run.id}/events`);
    const poll: { id?: ReturnType<typeof setInterval> } = {};
    const attach = (source: EventSource) => {
      const handler = (type: string) => (ev: MessageEvent) => {
        if (type === "ready") return;
        const data = JSON.parse(ev.data) as RunEvent;
        setEvents((prev) => (prev.some((p) => p.id === data.id) ? prev : [...prev, data]));
        if (type === "stats" && data.data) setStats(data.data);
        if (type === "queue") {
          setQueueInfo({
            message: data.message,
            cooldownUntil: typeof data.data?.cooldownUntil === "number" ? data.data.cooldownUntil : undefined,
            waiting: Boolean(data.data?.waiting),
          });
        }
        if (type === "approval" || type === "done" || type === "status" || type === "report") {
          void api.getRun(run.id).then((r) => setRun(r as RunState));
          void api.listRuns().then((rows) => setRunHistory(rows as RunSummary[]));
        }
        if ((type === "done" || type === "report") && sessionId) {
          void api.getSessionById(sessionId).then((s) => applySession(s as Parameters<typeof applySession>[0]));
        }
        if (type === "tool_result" || type === "done") {
          setTreeKey((n) => n + 1);
          setGitKey((n) => n + 1);
        }
      };
      for (const t of [
        "ready",
        "status",
        "llm",
        "tool_request",
        "tool_result",
        "queue",
        "approval",
        "stats",
        "error",
        "done",
        "verify",
        "report",
      ]) {
        source.addEventListener(t, handler(t) as EventListener);
      }
    };
    attach(es);
    poll.id = setInterval(() => {
      if (es.readyState === EventSource.CLOSED) {
        es.close();
        es = new EventSource(`/api/runs/${run.id}/events`);
        attach(es);
        void api.getRun(run.id).then((r) => {
          setRun(r as RunState);
          const st = r as RunState;
          if (st.events?.length) setEvents(st.events as RunEvent[]);
        });
      }
    }, 4000);
    return () => {
      es.close();
      if (poll.id) clearInterval(poll.id);
    };
  }, [run?.id, sessionId]);

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

  const applySession = (session: {
    id: string;
    messages?: ChatBubble[];
    queued?: string[];
    activeRunId?: string;
    chrome?: {
      mode?: "solo" | "orchestrated";
      writeAllow?: string[];
      verifyRecipe?: string;
      skillIds?: string[];
      workerCount?: number;
      workerGlobs?: string[][];
    };
  }) => {
    setSessionId(session.id);
    setChatMessages(session.messages ?? []);
    setChatQueued(session.queued ?? []);
    if (session.chrome) {
      if (session.chrome.mode) setMode(session.chrome.mode);
      if (session.chrome.writeAllow) setWriteAllow(session.chrome.writeAllow.join("\n"));
      if (session.chrome.verifyRecipe) setVerifyRecipe(session.chrome.verifyRecipe);
      if (session.chrome.skillIds) setSkillIds(session.chrome.skillIds.filter((id) => id !== "principle-prove-it-works"));
      if (session.chrome.workerCount) setWorkerCount(session.chrome.workerCount);
      if (session.chrome.workerGlobs) {
        setWorkerGlobsText(session.chrome.workerGlobs.map((row) => row.join(", ")).join("\n"));
      }
    }
    if (session.activeRunId) {
      void api.getRun(session.activeRunId).then((r) => {
        const st = r as RunState;
        setRun(st);
        setEvents((st.events as RunEvent[]) ?? []);
        setStats(st.stats);
      });
    }
  };

  const loadSessionForProject = async (root: string) => {
    const session = (await api.getSession(root)) as Parameters<typeof applySession>[0];
    applySession(session);
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
      await loadSessionForProject(res.projectRoot);
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

  const languageFromPath = (filePath: string): string => {
    const ext = filePath.includes(".") ? `.${filePath.split(".").pop()!.toLowerCase()}` : "";
    const map: Record<string, string> = {
      ".ts": "typescript",
      ".tsx": "typescript",
      ".js": "javascript",
      ".jsx": "javascript",
      ".mjs": "javascript",
      ".cjs": "javascript",
      ".json": "json",
      ".md": "markdown",
      ".css": "css",
      ".scss": "scss",
      ".html": "html",
      ".yml": "yaml",
      ".yaml": "yaml",
      ".py": "python",
      ".rs": "rust",
      ".go": "go",
      ".sh": "shell",
      ".toml": "ini",
      ".txt": "plaintext",
    };
    return map[ext] ?? "plaintext";
  };

  const handleFsChange = (change: FsChange) => {
    setTreeKey((n) => n + 1);
    setGitKey((n) => n + 1);
    if (change.type === "created") {
      if (change.kind === "file") void openFile(change.path);
      return;
    }
    if (change.type === "deleted") {
      setTabs((prev) => {
        const next = prev.filter(
          (t) => !(t.path === change.path || t.path.startsWith(`${change.path}/`))
        );
        if (activePath && (activePath === change.path || activePath.startsWith(`${change.path}/`))) {
          setActivePath(next[next.length - 1]?.path ?? null);
        }
        return next;
      });
      return;
    }
    setTabs((prev) =>
      prev.map((t) => {
        if (change.kind === "file" && t.path === change.from) {
          return { ...t, path: change.to, language: languageFromPath(change.to) };
        }
        if (change.kind === "dir" && (t.path === change.from || t.path.startsWith(`${change.from}/`))) {
          const nextPath = change.to + t.path.slice(change.from.length);
          return { ...t, path: nextPath, language: languageFromPath(nextPath) };
        }
        return t;
      })
    );
    setActivePath((prev) => {
      if (!prev) return prev;
      if (change.kind === "file" && prev === change.from) return change.to;
      if (change.kind === "dir" && (prev === change.from || prev.startsWith(`${change.from}/`))) {
        return change.to + prev.slice(change.from.length);
      }
      return prev;
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

  const buildChrome = () => {
    const allow = writeAllow
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const workerGlobs = workerGlobsText
      .split("\n")
      .map((line) =>
        line
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      )
      .filter((row) => row.length);
    return {
      mode,
      writeAllow: allow,
      verifyRecipe,
      skillIds,
      workerCount: mode === "orchestrated" ? workerCount : 1,
      workerGlobs: mode === "orchestrated" && workerGlobs.length ? workerGlobs : undefined,
    };
  };

  const refreshSession = async (id: string) => {
    const session = (await api.getSessionById(id)) as Parameters<typeof applySession>[0];
    applySession(session);
  };

  const sendChat = async () => {
    if (!projectRoot || !chatDraft.trim()) return;
    setBusy(true);
    setError(null);
    setQueueInfo({});
    try {
      await api.putConfig({ runMode, maxParallelWorkers });
      let sid = sessionId;
      if (!sid) {
        const created = (await api.getSession(projectRoot)) as { id: string };
        sid = created.id;
        setSessionId(sid);
      }
      const chrome = buildChrome();
      await api.putSessionChrome(sid, chrome);
      const res = (await api.postSessionMessage(sid, { text: chatDraft.trim(), chrome })) as {
        session?: Parameters<typeof applySession>[0];
        run?: RunState;
        id?: string;
        messages?: ChatBubble[];
        queued?: string[];
        activeRunId?: string;
      };
      setChatDraft("");
      if (res.session) {
        applySession(res.session);
      } else if (res.messages) {
        applySession(res as Parameters<typeof applySession>[0]);
      } else {
        await refreshSession(sid);
      }
      if (res.run) {
        setRun(res.run);
        setStats(res.run.stats);
        setEvents(res.run.events ?? []);
      }
      setAgentTab("agent");
      void api.listRuns().then((rows) => setRunHistory(rows as RunSummary[]));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const loadHistoryRun = async (id: string) => {
    const r = (await api.getRun(id)) as RunState;
    setRun(r);
    setEvents((r.events as RunEvent[]) ?? []);
    setStats(r.stats);
    setAgentTab("activity");
  };

  const activeKeyId = run?.agents?.find((a) => a.id === run.activeAgentId)?.keyId;
  const approvals =
    run?.pendingApprovals?.length
      ? run.pendingApprovals
      : run?.pendingApproval
        ? [run.pendingApproval]
        : [];
  const aggregateReport = run ? buildAggregateFromRun(run, events) : null;
  const runFinished =
    !!run && ["done", "error", "rate_limited", "interrupted"].includes(run.status);

  return (
    <div className={styles.ide}>
      {showDisclaimer && <DisclaimerModal onAccept={() => void acceptDisclaimer()} />}
      {showGuide && <UserGuideModal onClose={() => setShowGuide(false)} />}

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
            onClick={() => setShowGuide(true)}
            data-testid="user-guide"
            aria-label="Open user guide"
          >
            Help
          </button>
          <button
            type="button"
            className={styles.secondary}
            disabled={!activeTab || activeTab.content === activeTab.saved || busy}
            onClick={() => void saveActive()}
            data-testid="save-file"
          >
            Save
          </button>
        </div>
      </header>

      {error && (
        <div className={styles.errorBanner} role="alert" data-testid="app-error">
          <p className={styles.errorBannerText}>{error}</p>
          <button
            type="button"
            className={styles.errorBannerDismiss}
            aria-label="Dismiss error"
            onClick={() => setError(null)}
          >
            ×
          </button>
        </div>
      )}

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
                onFsChange={handleFsChange}
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
              <Suspense
                fallback={
                  <div style={{ padding: "1rem", color: "var(--tx-mid)" }}>Loading editor…</div>
                }
              >
                <CodeEditor
                  path={activeTab.path}
                  language={activeTab.language}
                  value={activeTab.content}
                  onChange={updateActiveContent}
                  theme={ui.theme}
                  fontSize={ui.editorFontSize}
                  minimap={ui.editorMinimap}
                  wordWrap={ui.editorWordWrap}
                />
              </Suspense>
            ) : (
              <div className={styles.emptyEditor}>
                <div>
                  <strong>CelmBot</strong>
                  Open a project, then pick a file from the sidebar.
                  <br />
                  Monaco editor · local git · operator chat · verification-first agents
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
              className={`${styles.sideTab} ${agentTab === "activity" ? styles.sideTabActive : ""}`}
              onClick={() => setAgentTab("activity")}
              data-testid="activity-tab"
            >
              Activity{events.length ? ` (${events.length})` : ""}
            </button>
            <button
              type="button"
              className={`${styles.sideTab} ${agentTab === "keys" ? styles.sideTabActive : ""}`}
              onClick={() => setAgentTab("keys")}
            >
              Keys
            </button>
            <button
              type="button"
              className={`${styles.sideTab} ${agentTab === "settings" ? styles.sideTabActive : ""}`}
              onClick={() => setAgentTab("settings")}
              data-testid="settings-tab"
            >
              Settings
            </button>
          </div>
          <div className={styles.agentBody}>
            {agentTab === "agent" && (
              <>
                <RunChrome
                  runMode={runMode}
                  setRunMode={setRunMode}
                  mode={mode}
                  setMode={setMode}
                  writeAllow={writeAllow}
                  setWriteAllow={setWriteAllow}
                  workerCount={workerCount}
                  setWorkerCount={setWorkerCount}
                  workerGlobsText={workerGlobsText}
                  setWorkerGlobsText={setWorkerGlobsText}
                  verifyRecipe={verifyRecipe}
                  setVerifyRecipe={setVerifyRecipe}
                  recipes={recipes}
                  skillIds={skillIds}
                  setSkillIds={setSkillIds}
                  skills={skills}
                  busy={busy}
                  runId={run?.id}
                  onPause={() => run && void api.pauseScope(run.id, "all")}
                  onResume={() => run && void api.resume(run.id)}
                />
                <OperatorChat
                  messages={chatMessages}
                  queued={chatQueued}
                  draft={chatDraft}
                  setDraft={setChatDraft}
                  busy={busy}
                  disabled={!projectRoot}
                  onSend={() => void sendChat()}
                />
                <QueueBanner
                  message={queueInfo.message}
                  cooldownUntil={queueInfo.cooldownUntil}
                  waiting={queueInfo.waiting}
                />
                {run && <AgentRoster agents={run.agents ?? []} activeAgentId={run.activeAgentId} />}
                <ApprovalCard
                  approvals={approvals}
                  onDecide={(id, decision) => run && void api.approve(run.id, decision, id)}
                />
                {runFinished && aggregateReport && <AggregateReport report={aggregateReport} />}
                <ActivityTeaser
                  events={events}
                  runStatus={run?.status}
                  onOpen={() => setAgentTab("activity")}
                />
              </>
            )}

            {agentTab === "activity" && (
              <>
                <EventTimeline events={events} />
                <RunHistory
                  runs={runHistory}
                  activeId={run?.id}
                  onSelect={(id) => void loadHistoryRun(id)}
                />
              </>
            )}

            {agentTab === "settings" && (
              <SettingsPanel
                ui={ui}
                onUiChange={updateUi}
                runMode={runMode}
                onRunModeChange={setRunMode}
                budget={budget}
                onBudgetChange={setBudget}
                maxParallelWorkers={maxParallelWorkers}
                onMaxWorkersChange={setMaxParallelWorkers}
                onSaveServer={() => void saveServerSettings()}
                saving={busy}
              />
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

      <StatsStrip
        branch={branch}
        dirtyCount={dirtyCount}
        runStatus={run?.status}
        stats={stats ?? (run?.stats as Record<string, unknown>) ?? null}
        verifyPassed={run?.verifyPassed}
        lifetime={lifetime}
        activeKeyId={activeKeyId}
        cooldownUntil={queueInfo.cooldownUntil}
        onClearStats={() => void api.clearStats().then((s) => setLifetime(s as Record<string, unknown>))}
      />
    </div>
  );
}
