import http from "node:http";

export interface FakeScript {
  /** Return assistant message JSON (OpenAI shape choice.message) */
  next: () => { content?: string; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> };
}

export function startFakeLlm(script: FakeScript): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url?.endsWith("/chat/completions")) {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const msg = script.next();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [{ message: { role: "assistant", ...msg } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          })
        );
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("no addr");
      resolve({
        url: `http://127.0.0.1:${addr.port}/v1`,
        close: () =>
          new Promise((r, j) => server.close((err) => (err ? j(err) : r()))),
      });
    });
  });
}
