import type { KeyEntry } from "../shared/types.js";

export interface ProbeResult {
  ok: boolean;
  supportsTools: boolean;
  supportsEmbeddings: boolean;
  degradedMode: boolean;
  latencyMs: number;
  error?: string;
  sample?: string;
  /** HTTP status from the primary chat call, when available. */
  status?: number;
}

export interface ProbeOptions {
  /** Skip embeddings check (faster; used during batch import). */
  skipEmbeddings?: boolean;
  /**
   * Prefer forcing a tool call. `auto` is unreliable — many models reply in
   * plain text even when they support tools.
   */
  forceTools?: boolean;
}

const ECHO_TOOL = {
  type: "function",
  function: {
    name: "echo",
    description: "Echo text",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
};

function authHeaders(entry: KeyEntry): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (entry.apiKey) headers.Authorization = `Bearer ${entry.apiKey}`;
  return headers;
}

async function readJson(res: Response): Promise<{
  choices?: Array<{ message?: { content?: string; tool_calls?: unknown[] } }>;
  error?: { message?: string };
}> {
  const text = await res.text();
  try {
    return JSON.parse(text) as {
      choices?: Array<{ message?: { content?: string; tool_calls?: unknown[] } }>;
      error?: { message?: string };
    };
  } catch {
    return { error: { message: text.slice(0, 200) } };
  }
}

async function probeTools(
  base: string,
  headers: Record<string, string>,
  model: string,
  force: boolean
): Promise<boolean> {
  const attempts: unknown[] = force
    ? [
        "required",
        { type: "function", function: { name: "echo" } },
        "auto",
      ]
    : ["auto", "required"];

  for (const toolChoice of attempts) {
    try {
      const toolRes = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Call the echo tool with text=hi" }],
          tools: [ECHO_TOOL],
          tool_choice: toolChoice,
          max_tokens: 64,
          temperature: 0,
        }),
      });
      if (!toolRes.ok) continue;
      const toolJson = await readJson(toolRes);
      if (toolJson.choices?.[0]?.message?.tool_calls?.length) return true;
    } catch {
      /* try next strategy */
    }
  }
  return false;
}

/** Cheap chat-only reachability check (no tools). */
export async function probeChat(entry: KeyEntry): Promise<ProbeResult> {
  const started = Date.now();
  const base = entry.baseUrl.replace(/\/$/, "");
  const headers = authHeaders(entry);
  try {
    const chatRes = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: entry.model,
        messages: [{ role: "user", content: "Reply with the single word: pong" }],
        max_tokens: 16,
        temperature: 0,
      }),
    });
    const chatJson = await readJson(chatRes);
    if (!chatRes.ok) {
      return {
        ok: false,
        supportsTools: false,
        supportsEmbeddings: false,
        degradedMode: true,
        latencyMs: Date.now() - started,
        status: chatRes.status,
        error: `chat ${chatRes.status}: ${chatJson.error?.message ?? "failed"}`.slice(0, 220),
      };
    }
    return {
      ok: true,
      supportsTools: false,
      supportsEmbeddings: false,
      degradedMode: true,
      latencyMs: Date.now() - started,
      status: chatRes.status,
      sample: String(chatJson.choices?.[0]?.message?.content ?? "").slice(0, 80),
    };
  } catch (err) {
    return {
      ok: false,
      supportsTools: false,
      supportsEmbeddings: false,
      degradedMode: true,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function probeKey(entry: KeyEntry, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const started = Date.now();
  const base = entry.baseUrl.replace(/\/$/, "");
  const headers = authHeaders(entry);
  const forceTools = opts.forceTools !== false;

  try {
    const chat = await probeChat(entry);
    if (!chat.ok) return { ...chat, latencyMs: Date.now() - started };

    const supportsTools = await probeTools(base, headers, entry.model, forceTools);

    let supportsEmbeddings = false;
    if (!opts.skipEmbeddings) {
      try {
        const emb = await fetch(`${base}/embeddings`, {
          method: "POST",
          headers,
          body: JSON.stringify({ model: entry.model, input: "celmbot probe" }),
        });
        supportsEmbeddings = emb.ok;
      } catch {
        supportsEmbeddings = false;
      }
    }

    return {
      ok: true,
      supportsTools,
      supportsEmbeddings,
      degradedMode: !supportsTools,
      latencyMs: Date.now() - started,
      status: chat.status,
      sample: chat.sample,
    };
  } catch (err) {
    return {
      ok: false,
      supportsTools: false,
      supportsEmbeddings: false,
      degradedMode: true,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
