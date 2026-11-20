export type ThemeMode = "light" | "dark";

export interface UiSettings {
  theme: ThemeMode;
  editorFontSize: number;
  editorMinimap: boolean;
  editorWordWrap: boolean;
  defaultWriteAllow: string;
  defaultVerifyRecipe: string;
  defaultMode: "solo" | "orchestrated";
}

export const UI_SETTINGS_KEY = "celmbot.ui";

export const defaultUiSettings = (): UiSettings => ({
  theme: "light",
  editorFontSize: 13,
  editorMinimap: true,
  editorWordWrap: true,
  defaultWriteAllow: "src/**",
  defaultVerifyRecipe: "npm_test",
  defaultMode: "solo",
});

export function loadUiSettings(): UiSettings {
  const base = defaultUiSettings();
  try {
    const raw = localStorage.getItem(UI_SETTINGS_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<UiSettings>;
    return {
      ...base,
      ...parsed,
      theme: parsed.theme === "dark" ? "dark" : "light",
      editorFontSize: clampFont(Number(parsed.editorFontSize ?? base.editorFontSize)),
      editorMinimap: parsed.editorMinimap ?? base.editorMinimap,
      editorWordWrap: parsed.editorWordWrap ?? base.editorWordWrap,
      defaultWriteAllow: String(parsed.defaultWriteAllow ?? base.defaultWriteAllow),
      defaultVerifyRecipe: String(parsed.defaultVerifyRecipe ?? base.defaultVerifyRecipe),
      defaultMode: parsed.defaultMode === "orchestrated" ? "orchestrated" : "solo",
    };
  } catch {
    return base;
  }
}

export function saveUiSettings(settings: UiSettings): void {
  localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(settings));
}

export function applyTheme(theme: ThemeMode): void {
  document.documentElement.setAttribute("data-theme", theme);
}

function clampFont(n: number): number {
  if (!Number.isFinite(n)) return 13;
  return Math.min(22, Math.max(11, Math.round(n)));
}
