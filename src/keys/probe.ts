import type { KeyEntry } from "../shared/types.js";

export interface ProbeResult {
  ok: boolean;
  supportsTools: boolean;
  supportsEmbeddings: boolean;
  degradedMode: boolean;
  latencyMs: number;
  error?: string;
  sample?: string;
}

export async function probeKey(entry: KeyEntry): Promise<ProbeResult> {
  const started = Date.now();
  const base = entry.baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (entry.apiKey) headers.Authorization = `Bearer ${entry.apiKey}`;

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
    if (!chatRes.ok) {
      const text = await chatRes.text();
      return {
        ok: false,
        supportsTools: false,
        supportsEmbeddings: false,
        degradedMode: true,
        latencyMs: Date.now() - started,
        error: `chat ${chatRes.status}: ${text.slice(0, 200)}`,
      };
    }
    const chatJson = (await chatRes.json()) as {
      choices?: Array<{ message?: { content?: string; tool_calls?: unknown[] } }>;
    };
    const sample = chatJson.choices?.[0]?.message?.content ?? "";

    let supportsTools = false;
    try {
      const toolRes = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: entry.model,
          messages: [{ role: "user", content: "Call the echo tool with text=hi" }],
          tools: [
            {
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
            },
          ],
          tool_choice: "auto",
          max_tokens: 64,
          temperature: 0,
        }),
      });
      if (toolRes.ok) {
        const toolJson = (await toolRes.json()) as {
          choices?: Array<{ message?: { tool_calls?: unknown[] } }>;
        };
        supportsTools = Boolean(toolJson.choices?.[0]?.message?.tool_calls?.length);
      }
    } catch {
      supportsTools = false;
    }

    let supportsEmbeddings = false;
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

    return {
      ok: true,
      supportsTools,
      supportsEmbeddings,
      degradedMode: !supportsTools,
      latencyMs: Date.now() - started,
      sample: String(sample).slice(0, 80),
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
