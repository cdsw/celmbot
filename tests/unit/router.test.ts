import { describe, expect, it } from "vitest";
import { markCooldown, pickKey } from "../../src/keys/router.js";
import type { KeyEntry } from "../../src/shared/types.js";

function key(partial: Partial<KeyEntry> & { id: string }): KeyEntry {
  return {
    pool: "cloud",
    providerId: "x",
    label: partial.id,
    baseUrl: "https://example.com/v1",
    model: "m",
    rpm: 20,
    rpd: 50,
    enabled: true,
    supportsTools: true,
    ...partial,
  };
}

describe("router", () => {
  it("prefers lowest latency", () => {
    const picked = pickKey([key({ id: "slow", lastLatencyMs: 900 }), key({ id: "fast", lastLatencyMs: 100 })]);
    expect(picked?.id).toBe("fast");
  });

  it("skips cooling keys", () => {
    const cooling = markCooldown(key({ id: "hot", lastLatencyMs: 10 }), 60_000, 1_000);
    const picked = pickKey([cooling, key({ id: "ok", lastLatencyMs: 200 })], { now: 2_000 });
    expect(picked?.id).toBe("ok");
  });
});
