import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { modelsCacheDir } from "../paths.js";
import {
  filterAgentCompatible,
  mapProviderModel,
  type MappedProviderModel,
} from "./modelCapabilities.js";

export const MODELS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface DiscoverModelsInput {
  baseUrl: string;
  apiKey?: string;
  providerId?: string;
  /** Bypass disk cache. */
  refresh?: boolean;
  /**
   * Default true: drop embedding / image-only / non-tool models so Keys import
   * cannot create entries that fail with "No enabled tool-capable keys".
   * Local providers without tool metadata keep unknown-tool chat models.
   */
  compatibleOnly?: boolean;
  /** Override cache TTL (ms). */
  ttlMs?: number;
}

export interface DiscoverModelsResult {
  models: MappedProviderModel[];
  cached: boolean;
  fetchedAt: number;
  expiresAt: number;
  source: string;
  totalRaw: number;
  filteredOut: number;
  error?: string;
}

interface CacheFile {
  baseUrl: string;
  providerId?: string;
  fetchedAt: number;
  expiresAt: number;
  models: MappedProviderModel[];
  totalRaw: number;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function cacheKey(baseUrl: string, apiKey?: string): string {
  const material = `${normalizeBaseUrl(baseUrl)}|${apiKey ? apiKey.slice(-8) : "nokey"}`;
  return crypto.createHash("sha256").update(material).digest("hex").slice(0, 24);
}

function cachePath(baseUrl: string, apiKey?: string): string {
  return path.join(modelsCacheDir(), `${cacheKey(baseUrl, apiKey)}.json`);
}

function readCache(file: string, now: number): CacheFile | null {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as CacheFile;
    if (!raw || !Array.isArray(raw.models) || !raw.expiresAt) return null;
    if (raw.expiresAt <= now) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeCache(file: string, payload: CacheFile): void {
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

function extractModelRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) return data as Record<string, unknown>[];
    const models = (payload as { models?: unknown }).models;
    if (Array.isArray(models)) return models as Record<string, unknown>[];
  }
  return [];
}

async function fetchRemoteModels(baseUrl: string, apiKey?: string): Promise<{
  models: MappedProviderModel[];
  totalRaw: number;
  source: string;
}> {
  const base = normalizeBaseUrl(baseUrl);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  // OpenRouter: request all modalities so we can filter; still maps via supported_parameters.
  const url =
    base.includes("openrouter.ai")
      ? `${base}/models?output_modalities=all`
      : `${base}/models`;

  const res = await fetch(url, { method: "GET", headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`models ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as unknown;
  const rows = extractModelRows(json);
  const models = rows
    .filter((row) => row && typeof row === "object" && row.id)
    .map((row) => mapProviderModel(row));
  return { models, totalRaw: rows.length, source: url };
}

function applyCompatibleFilter(
  models: MappedProviderModel[],
  baseUrl: string,
  compatibleOnly: boolean
): MappedProviderModel[] {
  if (!compatibleOnly) return models;
  const local =
    /localhost|127\.0\.0\.1|::1/i.test(baseUrl) ||
    /:11434|:1234|:8080/i.test(baseUrl);
  return filterAgentCompatible(models, { allowUnknownTools: local });
}

/** In-flight dedupe so parallel UI refreshes share one upstream call. */
const inflight = new Map<string, Promise<DiscoverModelsResult>>();

export async function discoverModels(input: DiscoverModelsInput): Promise<DiscoverModelsResult> {
  const baseUrl = normalizeBaseUrl(input.baseUrl || "");
  if (!baseUrl) {
    return {
      models: [],
      cached: false,
      fetchedAt: Date.now(),
      expiresAt: Date.now(),
      source: "",
      totalRaw: 0,
      filteredOut: 0,
      error: "baseUrl required",
    };
  }

  const compatibleOnly = input.compatibleOnly !== false;
  const ttlMs = input.ttlMs ?? MODELS_CACHE_TTL_MS;
  const key = cacheKey(baseUrl, input.apiKey);
  const file = cachePath(baseUrl, input.apiKey);
  const now = Date.now();

  if (!input.refresh) {
    const hit = readCache(file, now);
    if (hit) {
      const filtered = applyCompatibleFilter(hit.models, baseUrl, compatibleOnly);
      return {
        models: filtered,
        cached: true,
        fetchedAt: hit.fetchedAt,
        expiresAt: hit.expiresAt,
        source: "cache",
        totalRaw: hit.totalRaw,
        filteredOut: hit.models.length - filtered.length,
      };
    }
  }

  const existing = inflight.get(key);
  if (existing && !input.refresh) return existing;

  const promise = (async (): Promise<DiscoverModelsResult> => {
    try {
      const remote = await fetchRemoteModels(baseUrl, input.apiKey);
      const fetchedAt = Date.now();
      const expiresAt = fetchedAt + ttlMs;
      writeCache(file, {
        baseUrl,
        providerId: input.providerId,
        fetchedAt,
        expiresAt,
        models: remote.models,
        totalRaw: remote.totalRaw,
      });
      const filtered = applyCompatibleFilter(remote.models, baseUrl, compatibleOnly);
      return {
        models: filtered,
        cached: false,
        fetchedAt,
        expiresAt,
        source: remote.source,
        totalRaw: remote.totalRaw,
        filteredOut: remote.models.length - filtered.length,
      };
    } catch (err) {
      // Stale cache fallback on network error
      try {
        if (fs.existsSync(file)) {
          const stale = JSON.parse(fs.readFileSync(file, "utf8")) as CacheFile;
          if (Array.isArray(stale.models)) {
            const filtered = applyCompatibleFilter(stale.models, baseUrl, compatibleOnly);
            return {
              models: filtered,
              cached: true,
              fetchedAt: stale.fetchedAt,
              expiresAt: stale.expiresAt,
              source: "stale-cache",
              totalRaw: stale.totalRaw,
              filteredOut: stale.models.length - filtered.length,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }
      } catch {
        /* ignore */
      }
      return {
        models: [],
        cached: false,
        fetchedAt: Date.now(),
        expiresAt: Date.now(),
        source: "",
        totalRaw: 0,
        filteredOut: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

export function clearModelsCache(baseUrl?: string, apiKey?: string): void {
  if (baseUrl) {
    const file = cachePath(baseUrl, apiKey);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return;
  }
  const dir = modelsCacheDir();
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith(".json")) fs.unlinkSync(path.join(dir, name));
  }
}
