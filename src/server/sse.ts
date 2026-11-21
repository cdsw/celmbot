import type { ServerResponse } from "node:http";
import type { RunEvent } from "../shared/types.js";

export class SseHub {
  private clients = new Map<string, Set<ServerResponse>>();

  subscribe(runId: string, res: ServerResponse, replay: RunEvent[] = []): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`event: ready\ndata: ${JSON.stringify({ runId })}\n\n`);
    for (const event of replay.slice(-100)) {
      try {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      } catch {
        break;
      }
    }
    let set = this.clients.get(runId);
    if (!set) {
      set = new Set();
      this.clients.set(runId, set);
    }
    set.add(res);
    res.on("close", () => {
      set!.delete(res);
    });
  }

  publish(runId: string, event: RunEvent): void {
    const set = this.clients.get(runId);
    if (!set) return;
    const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const res of set) {
      try {
        res.write(payload);
      } catch {
        set.delete(res);
      }
    }
  }
}
