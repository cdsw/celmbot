import Editor from "@monaco-editor/react";

export function CodeEditor({
  path,
  language,
  value,
  onChange,
}: {
  path: string;
  language: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <Editor
      key={path}
      path={path}
      language={language}
      value={value}
      theme="vs"
      onChange={(v) => onChange(v ?? "")}
      options={{
        fontFamily: '"Iosevka Charon Mono", Consolas, "Cascadia Mono", monospace',
        fontSize: 13,
        minimap: { enabled: true, scale: 1 },
        wordWrap: "on",
        automaticLayout: true,
        scrollBeyondLastLine: false,
        tabSize: 2,
        renderLineHighlight: "line",
        padding: { top: 8 },
      }}
      loading={<div style={{ padding: "1rem", color: "#888" }}>Loading editor…</div>}
    />
  );
}
