import { describe, expect, it } from "vitest";
import {
  credentialEligible,
  migrateCredentials,
  resolveRoute,
} from "../../src/keys/credentials.js";
import type { CelmbotConfig, KeyEntry, ProviderCredential } from "../../src/shared/types.js";

function baseCfg(partial?: Partial<CelmbotConfig>): CelmbotConfig {
  return {
    configVersion: 1,
    credentials: { cloud: [], local: [] },
    keys: { cloud: [], local: [] },
    roles: {},
    budget: "medium",
    runMode: "ask",
    terminalAllowlist: [],
    maxParallelWorkers: 3,
    trustedProjects: [],
    ...partial,
  };
}

describe("credentials", () => {
  it("migrates duplicated apiKeys into one shared credential", () => {
    const a: KeyEntry = {
      id: "a",
      pool: "cloud",
      providerId: "openrouter",
      label: "OpenRouter · m1",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-shared",
      model: "m1",
      rpm: 20,
      rpd: 50,
      enabled: true,
    };
    const b: KeyEntry = {
      ...a,
      id: "b",
      label: "OpenRouter · m2",
      model: "m2",
    };
    const { cfg, migrated } = migrateCredentials(
      baseCfg({ keys: { cloud: [a, b], local: [] } })
    );
    expect(migrated).toBe(true);
    expect(cfg.credentials.cloud).toHaveLength(1);
    expect(cfg.credentials.cloud[0]?.apiKey).toBe("sk-shared");
    expect(cfg.keys.cloud[0]?.credentialId).toBe(cfg.credentials.cloud[0]?.id);
    expect(cfg.keys.cloud[1]?.credentialId).toBe(cfg.credentials.cloud[0]?.id);
    expect(cfg.keys.cloud[0]?.apiKey).toBeUndefined();
    expect(cfg.keys.cloud[1]?.apiKey).toBeUndefined();
  });

  it("respects modelLock eligibility", () => {
    const cred: ProviderCredential = {
      id: "c1",
      pool: "cloud",
      providerId: "openrouter",
      label: "locked",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk",
      rpm: 20,
      rpd: 50,
      modelLock: "only-this",
      enabled: true,
    };
    expect(credentialEligible(cred, "only-this")).toBe(true);
    expect(credentialEligible(cred, "other")).toBe(false);
  });

  it("resolveRoute merges credential secret onto model route", () => {
    const cred: ProviderCredential = {
      id: "c1",
      pool: "local",
      providerId: "ollama",
      label: "ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: undefined,
      rpm: 60,
      rpd: 1000,
      enabled: true,
    };
    const route: KeyEntry = {
      id: "r1",
      pool: "local",
      providerId: "ollama",
      credentialId: "c1",
      label: "llama",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "llama3.2",
      enabled: true,
      supportsTools: true,
    };
    const resolved = resolveRoute(
      baseCfg({
        credentials: { cloud: [], local: [cred] },
        keys: { cloud: [], local: [route] },
      }),
      route
    );
    expect(resolved?.apiKey).toBeUndefined();
    expect(resolved?.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(resolved?.rpm).toBe(60);
    expect(resolved?.model).toBe("llama3.2");
    expect(resolved?.enabled).toBe(true);
  });

  it("blocks resolve when modelLock mismatches", () => {
    const cred: ProviderCredential = {
      id: "c1",
      pool: "cloud",
      providerId: "x",
      label: "x",
      baseUrl: "https://example.com/v1",
      apiKey: "sk",
      rpm: 20,
      rpd: 50,
      modelLock: "a",
      enabled: true,
    };
    const route: KeyEntry = {
      id: "r1",
      pool: "cloud",
      providerId: "x",
      credentialId: "c1",
      label: "b",
      baseUrl: "https://example.com/v1",
      model: "b",
      enabled: true,
    };
    expect(
      resolveRoute(
        baseCfg({
          credentials: { cloud: [cred], local: [] },
          keys: { cloud: [route], local: [] },
        }),
        route
      )
    ).toBeUndefined();
  });
});
