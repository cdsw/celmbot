import crypto from "node:crypto";
import type {
  CelmbotConfig,
  KeyEntry,
  KeyPool,
  ProviderCredential,
  ResolvedRoute,
} from "../shared/types.js";

export const CONFIG_VERSION_CREDENTIALS = 2;

export function normalizeBaseUrl(baseUrl: string): string {
  return (baseUrl || "").replace(/\/+$/, "");
}

export function credentialEligible(cred: ProviderCredential, model: string): boolean {
  if (cred.enabled === false) return false;
  if (cred.modelLock && cred.modelLock !== model) return false;
  return true;
}

export function allCredentials(cfg: CelmbotConfig): ProviderCredential[] {
  return [...(cfg.credentials?.cloud ?? []), ...(cfg.credentials?.local ?? [])];
}

export function findCredential(cfg: CelmbotConfig, id: string): ProviderCredential | undefined {
  return allCredentials(cfg).find((c) => c.id === id);
}

export function findCredentialsForProvider(
  cfg: CelmbotConfig,
  opts: { pool?: KeyPool; providerId?: string; baseUrl?: string }
): ProviderCredential[] {
  const base = opts.baseUrl ? normalizeBaseUrl(opts.baseUrl) : undefined;
  return allCredentials(cfg).filter((c) => {
    if (opts.pool && c.pool !== opts.pool) return false;
    if (opts.providerId && c.providerId !== opts.providerId) return false;
    if (base && normalizeBaseUrl(c.baseUrl) !== base) return false;
    return true;
  });
}

/** Pick best credential for a model: prefer unlocked, then model-locked match. */
export function pickCredentialForModel(
  cfg: CelmbotConfig,
  opts: {
    pool: KeyPool;
    providerId: string;
    baseUrl: string;
    model: string;
    credentialId?: string;
  }
): ProviderCredential | undefined {
  if (opts.credentialId) {
    const c = findCredential(cfg, opts.credentialId);
    if (c && credentialEligible(c, opts.model)) return c;
  }
  const candidates = findCredentialsForProvider(cfg, {
    pool: opts.pool,
    providerId: opts.providerId,
    baseUrl: opts.baseUrl,
  }).filter((c) => credentialEligible(c, opts.model));
  if (!candidates.length) return undefined;
  const unlocked = candidates.filter((c) => !c.modelLock);
  return unlocked[0] ?? candidates[0];
}

export function resolveRoute(cfg: CelmbotConfig, entry: KeyEntry): ResolvedRoute | undefined {
  const cred =
    (entry.credentialId ? findCredential(cfg, entry.credentialId) : undefined) ??
    // Legacy rows still carrying apiKey/baseUrl without credentialId
    (entry.apiKey || entry.baseUrl
      ? ({
          id: entry.credentialId || `legacy-${entry.id}`,
          pool: entry.pool,
          providerId: entry.providerId,
          label: entry.label,
          baseUrl: entry.baseUrl,
          apiKey: entry.apiKey,
          rpm: entry.rpm ?? 20,
          rpd: entry.rpd ?? 50,
          enabled: true,
        } satisfies ProviderCredential)
      : undefined);

  if (!cred) return undefined;
  if (!credentialEligible(cred, entry.model)) return undefined;
  if (cred.enabled === false || entry.enabled === false) {
    // Still resolve for probe/display, but mark disabled
  }

  return {
    routeId: entry.id,
    credentialId: cred.id,
    pool: entry.pool,
    providerId: entry.providerId || cred.providerId,
    label: entry.label,
    baseUrl: normalizeBaseUrl(cred.baseUrl || entry.baseUrl),
    apiKey: cred.apiKey ?? entry.apiKey,
    model: entry.model,
    rpm: entry.rpm ?? cred.rpm ?? 20,
    rpd: entry.rpd ?? cred.rpd ?? 50,
    enabled: entry.enabled !== false && cred.enabled !== false,
    supportsTools: entry.supportsTools,
    supportsEmbeddings: entry.supportsEmbeddings,
    degradedMode: entry.degradedMode,
    contextLengthHint: entry.contextLengthHint,
    lastLatencyMs: entry.lastLatencyMs,
    cooldownUntil: entry.cooldownUntil,
  };
}

/** KeyEntry shaped for chat/probe helpers that still take KeyEntry. */
export function resolvedAsKeyEntry(resolved: ResolvedRoute): KeyEntry {
  return {
    id: resolved.routeId,
    pool: resolved.pool,
    providerId: resolved.providerId,
    credentialId: resolved.credentialId,
    label: resolved.label,
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
    model: resolved.model,
    rpm: resolved.rpm,
    rpd: resolved.rpd,
    enabled: resolved.enabled,
    supportsTools: resolved.supportsTools,
    supportsEmbeddings: resolved.supportsEmbeddings,
    degradedMode: resolved.degradedMode,
    contextLengthHint: resolved.contextLengthHint,
    lastLatencyMs: resolved.lastLatencyMs,
    cooldownUntil: resolved.cooldownUntil,
  };
}

function stableCredId(pool: KeyPool, providerId: string, baseUrl: string, apiKey: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${pool}|${providerId}|${normalizeBaseUrl(baseUrl)}|${apiKey}`)
    .digest("hex")
    .slice(0, 10);
  return `cred-${pool}-${providerId}-${hash}`;
}

/**
 * Migrate legacy KeyEntry rows (apiKey embedded per model) into shared credentials.
 * Idempotent: safe to run on every load.
 */
export function migrateCredentials(cfg: CelmbotConfig): { cfg: CelmbotConfig; migrated: boolean } {
  const credentials: CelmbotConfig["credentials"] = {
    cloud: [...(cfg.credentials?.cloud ?? [])],
    local: [...(cfg.credentials?.local ?? [])],
  };

  const byId = new Map<string, ProviderCredential>();
  for (const c of [...credentials.cloud, ...credentials.local]) byId.set(c.id, c);

  let changed = false;
  const mapPool = (pool: KeyPool, list: KeyEntry[]): KeyEntry[] =>
    list.map((entry) => {
      if (entry.credentialId && byId.has(entry.credentialId) && !entry.apiKey) {
        const cred = byId.get(entry.credentialId)!;
        const baseUrl = normalizeBaseUrl(cred.baseUrl || entry.baseUrl);
        if (entry.baseUrl !== baseUrl) {
          changed = true;
          return { ...entry, baseUrl };
        }
        return entry;
      }

      const apiKey = entry.apiKey ?? "";
      const baseUrl = normalizeBaseUrl(entry.baseUrl || "");
      const providerId = entry.providerId || "custom";
      const id =
        entry.credentialId && byId.has(entry.credentialId)
          ? entry.credentialId
          : stableCredId(pool, providerId, baseUrl, apiKey);

      if (!byId.has(id)) {
        const cred: ProviderCredential = {
          id,
          pool,
          providerId,
          label: entry.label?.includes("·")
            ? entry.label.split("·")[0]!.trim() || providerId
            : providerId,
          baseUrl,
          apiKey: apiKey || undefined,
          rpm: typeof entry.rpm === "number" ? entry.rpm : 20,
          rpd: typeof entry.rpd === "number" ? entry.rpd : 50,
          enabled: true,
        };
        byId.set(id, cred);
        credentials[pool].push(cred);
        changed = true;
      }

      const next: KeyEntry = {
        ...entry,
        credentialId: id,
        baseUrl,
        rpm: entry.rpm,
        rpd: entry.rpd,
      };
      if (next.apiKey !== undefined) {
        delete next.apiKey;
        changed = true;
      }
      if (entry.credentialId !== id) changed = true;
      return next;
    });

  const keys = {
    cloud: mapPool("cloud", cfg.keys?.cloud ?? []),
    local: mapPool("local", cfg.keys?.local ?? []),
  };

  const version = cfg.configVersion ?? 0;
  if (version < CONFIG_VERSION_CREDENTIALS) changed = true;

  if (!changed && cfg.credentials) {
    return { cfg, migrated: false };
  }

  return {
    cfg: {
      ...cfg,
      configVersion: CONFIG_VERSION_CREDENTIALS,
      credentials,
      keys,
    },
    migrated: true,
  };
}

export function redactCredential(c: ProviderCredential): ProviderCredential {
  return {
    ...c,
    apiKey: c.apiKey ? `••••${c.apiKey.slice(-4)}` : "",
  };
}
