import styles from "../App.module.scss";

export function RunForm({
  runMode,
  setRunMode,
  mode,
  setMode,
  writeAllow,
  setWriteAllow,
  workerCount,
  setWorkerCount,
  workerGlobsText,
  setWorkerGlobsText,
  task,
  setTask,
  verifyRecipe,
  setVerifyRecipe,
  recipes,
  skillIds,
  setSkillIds,
  skills,
  busy,
  projectRoot,
  runId,
  onStart,
  onPause,
  onResume,
}: {
  runMode: string;
  setRunMode: (v: string) => void;
  mode: "solo" | "orchestrated";
  setMode: (v: "solo" | "orchestrated") => void;
  writeAllow: string;
  setWriteAllow: (v: string) => void;
  workerCount: number;
  setWorkerCount: (v: number) => void;
  workerGlobsText: string;
  setWorkerGlobsText: (v: string) => void;
  task: string;
  setTask: (v: string) => void;
  verifyRecipe: string;
  setVerifyRecipe: (v: string) => void;
  recipes: Array<{ name: string; description?: string }>;
  skillIds: string[];
  setSkillIds: (v: string[]) => void;
  skills: Array<{ id: string; name: string }>;
  busy: boolean;
  projectRoot: string;
  runId?: string;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  return (
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
          <option value="orchestrated">Orchestrated (swarm)</option>
        </select>
      </label>
      {mode === "orchestrated" && (
        <>
          <label>
            Worker count
            <input
              type="number"
              min={1}
              max={8}
              value={workerCount}
              onChange={(e) => setWorkerCount(Math.min(8, Math.max(1, Number(e.target.value) || 1)))}
            />
          </label>
          <label>
            Per-worker write globs (one worker per line; comma-separated globs)
            <textarea
              value={workerGlobsText}
              onChange={(e) => setWorkerGlobsText(e.target.value)}
              placeholder={"src/a/**\nsrc/b/**"}
            />
          </label>
          <p className={styles.muted}>
            Orchestrated registers N workers; free-tier runs them with isolated transcripts. Disjoint globs
            required for parallel admission.
          </p>
        </>
      )}
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
        {recipes.length ? (
          <select value={verifyRecipe} onChange={(e) => setVerifyRecipe(e.target.value)}>
            {recipes.map((r) => (
              <option key={r.name} value={r.name}>
                {r.name}
              </option>
            ))}
          </select>
        ) : (
          <input value={verifyRecipe} onChange={(e) => setVerifyRecipe(e.target.value)} />
        )}
      </label>
      {skills.length > 0 && (
        <label>
          Skills
          <select
            multiple
            value={skillIds}
            onChange={(e) =>
              setSkillIds(Array.from(e.target.selectedOptions).map((o) => o.value))
            }
            size={Math.min(4, skills.length)}
          >
            {skills.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className={styles.row}>
        <button type="button" data-testid="start-run" disabled={busy || !projectRoot} onClick={onStart}>
          Start
        </button>
        {runId && (
          <>
            <button type="button" className={styles.secondary} onClick={onPause}>
              Pause
            </button>
            <button type="button" className={styles.secondary} onClick={onResume}>
              Resume
            </button>
          </>
        )}
      </div>
      <p className={styles.muted}>
        Agent writes stay jail + allowlist. Editor Save can write any non-protected file in the project.
      </p>
    </div>
  );
}
