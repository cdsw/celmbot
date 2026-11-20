import { describe, expect, it } from "vitest";
import { RateLimitQueue } from "../../src/keys/rateQueue.js";

describe("RateLimitQueue", () => {
  it("serializes jobs and respects rpm spacing", async () => {
    const q = new RateLimitQueue("k1", 60, 1000);
    const times: number[] = [];
    await Promise.all([
      q.enqueue(async () => {
        times.push(Date.now());
        return 1;
      }),
      q.enqueue(async () => {
        times.push(Date.now());
        return 2;
      }),
    ]);
    expect(times).toHaveLength(2);
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(900);
  });

  it("isolates per-key queues", async () => {
    const a = new RateLimitQueue("a", 1000, 1000);
    const b = new RateLimitQueue("b", 1000, 1000);
    const order: string[] = [];
    await Promise.all([
      a.enqueue(async () => {
        order.push("a");
      }),
      b.enqueue(async () => {
        order.push("b");
      }),
    ]);
    expect(order.sort()).toEqual(["a", "b"]);
  });
});
