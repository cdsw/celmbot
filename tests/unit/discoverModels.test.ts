import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("discoverModels cache", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "celmbot-models-"));
    process.env.CELMBOT_CONFIG_DIR = tmp;
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    delete process.env.CELMBOT_CONFIG_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("caches provider model lists and filters non-tool models", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            id: "good/tools",
            name: "Good",
            supported_parameters: ["tools", "tool_choice"],
            pricing: { prompt: "0", completion: "0" },
          },
          {
            id: "bad/plain",
            name: "Plain",
            supported_parameters: ["temperature"],
          },
          {
            id: "bad/embed",
            name: "Embed",
            type: "embedding",
          },
        ],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { discoverModels, clearModelsCache } = await import("../../src/keys/discoverModels.js");
    clearModelsCache();

    const first = await discoverModels({
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      compatibleOnly: true,
    });
    expect(first.cached).toBe(false);
    expect(first.models.map((m) => m.id)).toEqual(["good/tools"]);
    expect(first.filteredOut).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await discoverModels({
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      compatibleOnly: true,
    });
    expect(second.cached).toBe(true);
    expect(second.models.map((m) => m.id)).toEqual(["good/tools"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const all = await discoverModels({
      baseUrl: "https://example.com/v1",
      apiKey: "sk-test",
      compatibleOnly: false,
    });
    expect(all.cached).toBe(true);
    expect(all.models.length).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
