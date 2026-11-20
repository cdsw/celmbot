import { useEffect, useMemo, useState } from "react";
import { api, type Catalog, type Key } from "./api";
import { DisclaimerModal } from "./components/DisclaimerModal";
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

export default function App() {
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [poolTab, setPoolTab] = useState<"cloud" | "local">("cloud");
  const [keys, setKeys] = useState<{ cloud: Key[]; local: Key[] }>({ cloud: [], local: [] });
  const [catalogs, setCatalogs] = useState<{ cloud: Catalog[]; local: Catalog[] }>({ cloud: [], local: [] });
  const [runMode, setRunMode] = useState("ask");
  const [projectRoot, setProjectRoot] = useState("");
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

  const refresh = async () => {
    const [cfg, k, cats, life] = await Promise.all([
      api.getConfig() as Promise<{ runMode: string; disclaimerAcceptedAt?: string }>,
      api.getKeys(),
      api.catalogs(),
      api.stats() as Promise<Record<string, unknown>>,
    ]);
    setRunMode(cfg.runMode);
    setShowDisclaimer(!cfg.disclaimerAcceptedAt);
    setKeys(k);
    setCatalogs(cats);
    setLifetime(life);
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
    if (!run?.id) return;
    const es = new EventSource(`/api/runs/${run.id}/events`);
    es.onmessage = () => undefined;
    const handler = (type: string) => (ev: MessageEvent) => {
      const data = JSON.parse(ev.data) as RunEvent;
      setEvents((prev) => [...prev, data]);
      if (type === "stats" && data.data) setStats(data.data);
      if (type === "approval" || type === "done" || type === "status") {
        void api.getRun(run.id).then((r) => setRun(r as RunState));
      }
    };
    for (const t of ["status", "llm", "tool_request", "tool_result", "queue", "approval", "stats", "error", "done", "verify"]) {
      es.addEventListener(t, handler(t) as EventListener);
    }
    return () => es.close();
  }, [run?.id]);

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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const strip = useMemo(() => {
    const s = stats ?? run?.stats ?? {};
    return [
      ["status", run?.status ?? "—"],
      ["llm", String(s.llmCalls ?? 0)],
      ["latency", s.latencyLastMs != null ? `${s.latencyLastMs}ms` : "n/a"],
      ["queue wait", s.queueWaitMs != null ? `${s.queueWaitMs}ms` : "0"],
      ["429s", String(s.rateLimitHits ?? 0)],
      ["verify", run?.verifyPassed ? "pass" : "—"],
    ] as const;
  }, [stats, run]);

  return (
    <div className={styles.shell}>
      {showDisclaimer && <DisclaimerModal onAccept={() => void acceptDisclaimer()} />}
      <h1 className={styles.brand}>CelmBot</h1>
      <p className={styles.tagline}>
        Practice verification-first agents on free tiers. Inspired by Lauren Tan’s pstack. Queues, jail, and evidence —
        all on localhost.
      </p>

      <div className={styles.statsStrip} data-testid="stats-strip">
        {strip.map(([k, v]) => (
          <span key={k}>
            {k}: <strong>{v}</strong>
          </span>
        ))}
        {lifetime && (
          <span className={styles.muted}>
            lifetime llm: {String(lifetime.totalLlmCalls ?? 0)} · runs: {String(lifetime.totalRuns ?? 0)}
          </span>
        )}
        <button
          type="button"
          className={styles.secondary}
          onClick={() =>
            void api.clearStats().then((s) => setLifetime(s as Record<string, unknown>))
          }
        >
          Clear local stats
        </button>
      </div>

      {error && <p className={styles.badgeWarn}>{error}</p>}

      <div className={styles.grid}>
        <section className={styles.panel}>
          <h2>Keys</h2>
          <div className={styles.tabs}>
            <button
              type="button"
              className={`${styles.tab} ${poolTab === "cloud" ? styles.tabActive : ""}`}
              onClick={() => setPoolTab("cloud")}
            >
              Cloud
            </button>
            <button
              type="button"
              className={`${styles.tab} ${poolTab === "local" ? styles.tabActive : ""}`}
              onClick={() => setPoolTab("local")}
            >
              Local
            </button>
          </div>

          <div className={styles.row}>
            <label>
              Preset
              <select
                value={form.providerId}
                onChange={(e) => applyCatalog(e.target.value)}
              >
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
            <label>
              RPM
              <input type="number" value={form.rpm} onChange={(e) => setForm({ ...form, rpm: Number(e.target.value) })} />
            </label>
            <label>
              RPD
              <input type="number" value={form.rpd} onChange={(e) => setForm({ ...form, rpd: Number(e.target.value) })} />
            </label>
          </div>
          <div className={styles.row}>
            <button type="button" disabled={busy} onClick={() => void addKey()}>
              Add {poolTab} key
            </button>
          </div>

          <ul className={styles.list}>
            {keyList.map((k) => (
              <li key={k.id}>
                <div>
                  <strong>{k.label}</strong>{" "}
                  <span className={styles.badge}>{k.pool}</span>{" "}
                  {k.supportsTools ? <span className={`${styles.badge} ${styles.badgeOk}`}>tools</span> : null}
                  {k.degradedMode ? <span className={`${styles.badge} ${styles.badgeWarn}`}>degraded</span> : null}
                </div>
                <div className={styles.mono}>
                  {k.model} · {k.baseUrl}
                  {k.lastLatencyMs != null ? ` · ${k.lastLatencyMs}ms` : ""}
                </div>
                <div className={styles.row}>
                  <button type="button" className={styles.secondary} onClick={() => void api.probeKey(k.id).then(refresh)}>
                    Probe
                  </button>
                  <button type="button" className={styles.danger} onClick={() => void api.deleteKey(k.id).then(refresh)}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
            {!keyList.length && <li className={styles.muted}>No {poolTab} keys yet.</li>}
          </ul>
        </section>

        <section className={styles.panel}>
          <h2>Run</h2>
          <div className={styles.row}>
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
          </div>
          <label>
            Project folder (absolute path)
            <input
              data-testid="project-root"
              value={projectRoot}
              onChange={(e) => setProjectRoot(e.target.value)}
              placeholder="D:\path\to\project"
            />
          </label>
          <label>
            Write allow globs (comma or newline)
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
          <p className={styles.muted}>
            Empty write allowlist means no writes. Freeform shell is off — recipes only. See docs/TRUST.md.
          </p>
        </section>
      </div>

      {run?.pendingApproval && (
        <section className={styles.panel} data-testid="approval-card">
          <h2>Approval needed</h2>
          <p>{run.pendingApproval.summary}</p>
          {run.pendingApproval.diff && <pre className={styles.diff}>{run.pendingApproval.diff}</pre>}
          <div className={styles.row}>
            <button type="button" onClick={() => void api.approve(run.id, "allow")}>
              Allow once
            </button>
            <button type="button" className={styles.secondary} onClick={() => void api.approve(run.id, "allowlist")}>
              Allowlist pattern
            </button>
            <button type="button" className={styles.danger} onClick={() => void api.approve(run.id, "deny")}>
              Deny
            </button>
          </div>
        </section>
      )}

      <section className={styles.panel}>
        <h2>Timeline</h2>
        {run && (
          <p className={styles.muted}>
            run {run.id.slice(0, 8)} · files: {run.filesTouched?.join(", ") || "—"} · agents:{" "}
            {run.agents?.map((a) => a.id).join(", ")}
          </p>
        )}
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
          {!events.length && <p className={styles.muted}>Events will stream here when a run starts.</p>}
        </div>
      </section>
    </div>
  );
}
