import fs from "node:fs";
import type { CelmbotConfig, KeyEntry, KeyPool, ProviderCredential } from "./shared/types.js";
import { migrateCredentials } from "./keys/credentials.js";
import { configPath, ensureDataDir } from "./paths.js";

export function defaultConfig(): CelmbotConfig {
  return {
    configVersion: 2,
    credentials: { cloud: [], local: [] },
    keys: { cloud: [], local: [] },
    roles: {},
    budget: "medium",
    runMode: "ask",
    terminalAllowlist: ["npm_test", "recipe:npm_test"],
    maxParallelWorkers: 3,
    trustedProjects: [],
  };
}

export function loadConfig(): CelmbotConfig {
  ensureDataDir();
  const file = configPath();
  if (!fs.existsSync(file)) {
    const cfg = defaultConfig();
    saveConfig(cfg);
    return cfg;
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as CelmbotConfig;
  const base: CelmbotConfig = {
    ...defaultConfig(),
    ...raw,
    credentials: {
      cloud: raw.credentials?.cloud ?? [],
      local: raw.credentials?.local ?? [],
    },
    keys: {
      cloud: raw.keys?.cloud ?? [],
      local: raw.keys?.local ?? [],
    },
    trustedProjects: raw.trustedProjects ?? [],
  };
  const { cfg, migrated } = migrateCredentials(base);
  if (migrated) saveConfig(cfg);
  return cfg;
}

export function saveConfig(cfg: CelmbotConfig): void {
  ensureDataDir();
  const file = configPath();
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let pendingCfg: CelmbotConfig | undefined;

/** Coalesce rapid key cooldown/latency writes under parallel workers. */
export function saveConfigDebounced(cfg: CelmbotConfig, delayMs = 80): void {
  pendingCfg = cfg;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (pendingCfg) saveConfig(pendingCfg);
    pendingCfg = undefined;
    debounceTimer = undefined;
  }, delayMs);
}

export function flushConfigSave(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = undefined;
  if (pendingCfg) {
    saveConfig(pendingCfg);
    pendingCfg = undefined;
  }
}

export function allKeys(cfg: CelmbotConfig): KeyEntry[] {
  return [...cfg.keys.cloud, ...cfg.keys.local];
}

export function findKey(cfg: CelmbotConfig, id: string): KeyEntry | undefined {
  return allKeys(cfg).find((k) => k.id === id);
}

export function upsertKey(cfg: CelmbotConfig, entry: KeyEntry): CelmbotConfig {
  const pool = entry.pool === "local" ? "local" : "cloud";
  const list = cfg.keys[pool].filter((k) => k.id !== entry.id);
  list.push(entry);
  return {
    ...cfg,
    keys: {
      ...cfg.keys,
      [pool]: list,
    },
  };
}

export function removeKey(cfg: CelmbotConfig, id: string): CelmbotConfig {
  return {
    ...cfg,
    keys: {
      cloud: cfg.keys.cloud.filter((k) => k.id !== id),
      local: cfg.keys.local.filter((k) => k.id !== id),
    },
  };
}

export function upsertCredential(cfg: CelmbotConfig, entry: ProviderCredential): CelmbotConfig {
  const pool: KeyPool = entry.pool === "local" ? "local" : "cloud";
  const list = (cfg.credentials?.[pool] ?? []).filter((c) => c.id !== entry.id);
  list.push(entry);
  // Keep denormalized baseUrl on routes that use this credential.
  const keys = {
    cloud: cfg.keys.cloud.map((k) =>
      k.credentialId === entry.id ? { ...k, baseUrl: entry.baseUrl, providerId: entry.providerId } : k
    ),
    local: cfg.keys.local.map((k) =>
      k.credentialId === entry.id ? { ...k, baseUrl: entry.baseUrl, providerId: entry.providerId } : k
    ),
  };
  return {
    ...cfg,
    credentials: {
      cloud: pool === "cloud" ? list : cfg.credentials?.cloud ?? [],
      local: pool === "local" ? list : cfg.credentials?.local ?? [],
    },
    keys,
  };
}

export function removeCredential(cfg: CelmbotConfig, id: string): CelmbotConfig {
  const stillUsed = allKeys(cfg).some((k) => k.credentialId === id);
  if (stillUsed) {
    // Detach routes first — caller should remove or reassign models.
    throw new Error("Credential still used by imported models. Remove or reassign models first.");
  }
  return {
    ...cfg,
    credentials: {
      cloud: (cfg.credentials?.cloud ?? []).filter((c) => c.id !== id),
      local: (cfg.credentials?.local ?? []).filter((c) => c.id !== id),
    },
  };
}

export function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "::1";
  } catch {
    return false;
  }
}
