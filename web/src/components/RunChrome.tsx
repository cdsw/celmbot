import { useState } from "react";
import styles from "../App.module.scss";

export function RunChrome({
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
  verifyRecipe,
  setVerifyRecipe,
  recipes,
  skillIds,
  setSkillIds,
  skills,
  busy,
  runId,
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
  verifyRecipe: string;
  setVerifyRecipe: (v: string) => void;
  recipes: Array<{ name: string; description?: string }>;
  skillIds: string[];
  setSkillIds: (v: string[]) => void;
  skills: Array<{ id: string; name: string }>;
  busy: boolean;
  runId?: string;
  onPause: () => void;
  onResume: () => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const optionalSkills = skills.filter((s) => s.id !== "principle-prove-it-works");

  return (
    <div className={styles.panelBlock} data-testid="run-chrome">
      <h2>Run settings</h2>
      <label>
        Playbook
        <select
          data-testid="playbook"
          value={mode}
          onChange={(e) => setMode(e.target.value as "solo" | "orchestrated")}
        >
          <option value="solo">Solo</option>
          <option value="orchestrated">Swarm</option>
        </select>
      </label>
      <label>
        Write policy
        <select value={runMode} onChange={(e) => setRunMode(e.target.value)} data-testid="write-policy">
          <option value="ask">Approve writes</option>
          <option value="allowlist">Allowlist</option>
          <option value="run-everything">Run everything (dangerous)</option>
        </select>
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
      <label>
        Write allow globs
        <textarea data-testid="write-allow" value={writeAllow} onChange={(e) => setWriteAllow(e.target.value)} />
      </label>

      <div className={styles.row}>
        <button
          type="button"
          className={styles.secondary}
          data-testid="advanced-toggle"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((o) => !o)}
        >
          {advancedOpen ? "Hide advanced" : "Advanced"}
        </button>
        {runId && (
          <>
            <button type="button" className={styles.secondary} disabled={busy} onClick={onPause}>
              Pause
            </button>
            <button type="button" className={styles.secondary} disabled={busy} onClick={onResume}>
              Resume
            </button>
          </>
        )}
      </div>

      {advancedOpen && (
        <div className={styles.advancedBlock} data-testid="advanced-fields">
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
                Swarm registers N workers with isolated transcripts. Disjoint globs required for parallel
                admission.
              </p>
            </>
          )}
          {optionalSkills.length > 0 && (
            <label>
              Extra skills
              <select
                multiple
                value={skillIds}
                onChange={(e) =>
                  setSkillIds(Array.from(e.target.selectedOptions).map((o) => o.value))
                }
                size={Math.min(4, optionalSkills.length)}
              >
                {optionalSkills.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className={styles.muted}>Prove-it-works attaches automatically.</p>
        </div>
      )}
    </div>
  );
}
