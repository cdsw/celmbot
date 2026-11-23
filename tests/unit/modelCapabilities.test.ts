import { describe, expect, it } from "vitest";
import {
  detectToolSupport,
  filterAgentCompatible,
  mapProviderModel,
} from "../../src/keys/modelCapabilities.js";

describe("modelCapabilities", () => {
  it("detects tools from OpenRouter supported_parameters", () => {
    expect(
      detectToolSupport({
        id: "meta/llama",
        supported_parameters: ["tools", "tool_choice", "temperature"],
      })
    ).toBe(true);
  });

  it("marks known catalogs without tools as false, sparse as unknown", () => {
    expect(
      detectToolSupport({
        id: "vendor/image",
        supported_parameters: ["temperature"],
      })
    ).toBe(false);
    expect(detectToolSupport({ id: "local-model" })).toBe(null);
  });

  it("maps embedding models as incompatible", () => {
    const mapped = mapProviderModel({
      id: "text-embedding-3",
      name: "Embed",
      type: "embedding",
      supported_parameters: ["tools"],
    });
    expect(mapped.supportsEmbeddings).toBe(true);
    expect(mapped.isChat).toBe(false);
    expect(mapped.agentCompatible).toBe(false);
  });

  it("filters agent-compatible models and optionally keeps unknown tools", () => {
    const tool = mapProviderModel({
      id: "chat/tools",
      supported_parameters: ["tools", "tool_choice"],
    });
    const noTools = mapProviderModel({
      id: "chat/plain",
      supported_parameters: ["temperature"],
    });
    const unknown = mapProviderModel({ id: "ollama/llama" });
    const embed = mapProviderModel({
      id: "embed/x",
      type: "embedding",
    });

    expect(filterAgentCompatible([tool, noTools, unknown, embed]).map((m) => m.id)).toEqual([
      "chat/tools",
    ]);
    expect(
      filterAgentCompatible([tool, noTools, unknown, embed], { allowUnknownTools: true }).map(
        (m) => m.id
      )
    ).toEqual(["chat/tools", "ollama/llama"]);
  });

  it("detects free pricing", () => {
    const mapped = mapProviderModel({
      id: "openrouter/free",
      pricing: { prompt: "0", completion: "0" },
      supported_parameters: ["tools"],
    });
    expect(mapped.isFree).toBe(true);
    expect(mapped.agentCompatible).toBe(true);
  });
});
