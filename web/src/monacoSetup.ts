/**
 * Bundle Monaco locally so the editor does not fetch jsDelivr/CDN at runtime
 * (offline / blocked CDN → "Failed to fetch" when opening files).
 */
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import CssWorker from "monaco-editor/language/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/language/html/html.worker.js?worker";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker.js?worker";

const g = globalThis as typeof globalThis & {
  MonacoEnvironment?: { getWorker: (_: unknown, label: string) => Worker };
};

g.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === "json") return new JsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new CssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new HtmlWorker();
    if (label === "typescript" || label === "javascript") return new TsWorker();
    return new EditorWorker();
  },
};

loader.config({ monaco });

void loader.init().then((m) => {
  // Local sandbox: don't phone home for JSON schemas (package.json → schemastore).
  m.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: true,
    schemas: [],
    enableSchemaRequest: false,
  });
});
