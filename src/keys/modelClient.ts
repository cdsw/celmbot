import type { KeyEntry } from "../shared/types.js";

export interface ChatMessage {
  role: string;
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export interface ChatResult {
  message: ChatMessage;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  latencyMs: number;
  status: number;
  rawError?: string;
}

export async function chatCompletions(
  key: KeyEntry,
  messages: ChatMessage[],
  tools?: unknown[]
): Promise<ChatResult> {
  const started = Date.now();
  const base = key.baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (key.apiKey) headers.Authorization = `Bearer ${key.apiKey}`;

  const body: Record<string, unknown> = {
    model: key.model,
    messages,
    temperature: 0.2,
  };
  if (tools?.length && !key.degradedMode) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - started;
  const text = await res.text();
  let json: {
    choices?: Array<{ message?: ChatMessage }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  } = {};
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    return { message: { role: "assistant", content: text }, latencyMs, status: res.status, rawError: text.slice(0, 500) };
  }
  if (!res.ok) {
    return {
      message: { role: "assistant", content: json.error?.message ?? text },
      latencyMs,
      status: res.status,
      rawError: json.error?.message ?? text.slice(0, 500),
    };
  }
  return {
    message: json.choices?.[0]?.message ?? { role: "assistant", content: "" },
    usage: json.usage,
    latencyMs,
    status: res.status,
  };
}

export const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List files in a directory under the project root",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Relative directory path" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file inside the project",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          maxChars: { type: "number" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write a UTF-8 text file (must match writeAllow globs)",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep",
      description: "Search file contents under the project for a string/regex",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string", description: "Subdirectory or file to search" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_recipe",
      description: "Run an allowlisted verify/build recipe (npm_test, node, tsc, …)",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          args: { type: "array", items: { type: "string" } },
        },
        required: ["name"],
      },
    },
  },
];
