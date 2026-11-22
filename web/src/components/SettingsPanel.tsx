import type { UiSettings } from "../settings";
import styles from "../App.module.scss";

export function SettingsPanel({
  ui,
  onUiChange,
  runMode,
  onRunModeChange,
  budget,
  onBudgetChange,
  maxParallelWorkers,
  onMaxWorkersChange,
  onSaveServer,
  saving,
}: {
  ui: UiSettings;
  onUiChange: (next: UiSettings) => void;
  runMode: string;
  onRunModeChange: (v: string) => void;
  budget: string;
  onBudgetChange: (v: string) => void;
  maxParallelWorkers: number;
  onMaxWorkersChange: (v: number) => void;
  onSaveServer: () => void;
  saving: boolean;
}) {
  return (
    <div className={styles.panelBlock} data-testid="settings-panel">
      <h2>Appearance</h2>
      <label>
        Theme
        <select
          value={ui.theme}
          onChange={(e) => onUiChange({ ...ui, theme: e.target.value as UiSettings["theme"] })}
          data-testid="theme-select"
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <p className={styles.muted}>Matches the cl-frontend palette remap: light paper / dark charcoal with cyan accents.</p>

      <h2>Editor</h2>
      <label>
        Font size
        <input
          type="number"
          min={11}
          max={22}
          value={ui.editorFontSize}
          onChange={(e) => onUiChange({ ...ui, editorFontSize: Number(e.target.value) })}
        />
      </label>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={ui.editorMinimap}
          onChange={(e) => onUiChange({ ...ui, editorMinimap: e.target.checked })}
        />
        Show minimap
      </label>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={ui.editorWordWrap}
          onChange={(e) => onUiChange({ ...ui, editorWordWrap: e.target.checked })}
        />
        Word wrap
      </label>

      <h2>Agent defaults</h2>
      <label>
        Default mode
        <select
          value={ui.defaultMode}
          onChange={(e) =>
            onUiChange({ ...ui, defaultMode: e.target.value as UiSettings["defaultMode"] })
          }
        >
          <option value="solo">Solo</option>
          <option value="orchestrated">Swarm</option>
        </select>
      </label>
      <label>
        Default write allow globs
        <textarea
          value={ui.defaultWriteAllow}
          onChange={(e) => onUiChange({ ...ui, defaultWriteAllow: e.target.value })}
        />
      </label>
      <label>
        Default verify recipe
        <input
          value={ui.defaultVerifyRecipe}
          onChange={(e) => onUiChange({ ...ui, defaultVerifyRecipe: e.target.value })}
        />
      </label>
      <p className={styles.muted}>Applied to new Agent tab fields when you reload; current run form is left alone until you change it.</p>

      <h2>Server</h2>
      <label>
        Default write policy
        <select value={runMode} onChange={(e) => onRunModeChange(e.target.value)}>
          <option value="ask">Approve writes</option>
          <option value="allowlist">Allowlist</option>
          <option value="run-everything">Run everything (dangerous)</option>
        </select>
      </label>
      <label>
        Budget
        <select value={budget} onChange={(e) => onBudgetChange(e.target.value)}>
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
      </label>
      <label>
        Max parallel workers
        <input
          type="number"
          min={1}
          max={8}
          value={maxParallelWorkers}
          onChange={(e) => onMaxWorkersChange(Number(e.target.value))}
        />
      </label>
      <button type="button" disabled={saving} onClick={onSaveServer}>
        Save server settings
      </button>
      <p className={styles.muted}>Theme and editor prefs save instantly in this browser. Server settings write to CelmBot config.</p>
    </div>
  );
}
