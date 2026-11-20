import Editor from "@monaco-editor/react";

export function CodeEditor({
  path,
  language,
  value,
  onChange,
  theme = "light",
  fontSize = 13,
  minimap = true,
  wordWrap = true,
}: {
  path: string;
  language: string;
  value: string;
  onChange: (next: string) => void;
  theme?: "light" | "dark";
  fontSize?: number;
  minimap?: boolean;
  wordWrap?: boolean;
}) {
  return (
    <Editor
      key={path}
      path={path}
      language={language}
      value={value}
      theme={theme === "dark" ? "vs-dark" : "vs"}
      onChange={(v) => onChange(v ?? "")}
      options={{
        fontFamily: '"Iosevka Charon Mono", Consolas, "Cascadia Mono", monospace',
        fontSize,
        minimap: { enabled: minimap, scale: 1 },
        wordWrap: wordWrap ? "on" : "off",
        automaticLayout: true,
        scrollBeyondLastLine: false,
        tabSize: 2,
        renderLineHighlight: "line",
        padding: { top: 8 },
      }}
      loading={<div style={{ padding: "1rem", color: "var(--tx-mid)" }}>Loading editor…</div>}
    />
  );
}
