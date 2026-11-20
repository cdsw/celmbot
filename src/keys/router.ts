import type { KeyEntry } from "../shared/types.js";

const DEFAULT_COOLDOWN_MS = 10 * 60 * 1000;

/** omfm-inspired: skip cooling keys, prefer lowest recent latency among ready keys. */
export function pickKey(
  candidates: KeyEntry[],
  opts?: { now?: number; preferDifferentFrom?: string }
): KeyEntry | undefined {
  const now = opts?.now ?? Date.now();
  let ready = candidates.filter((k) => k.enabled && (k.supportsTools !== false) && (!k.cooldownUntil || k.cooldownUntil <= now));
  if (opts?.preferDifferentFrom) {
    const preferred = ready.filter((k) => k.providerId !== opts.preferDifferentFrom);
    if (preferred.length) ready = preferred;
  }
  if (!ready.length) return undefined;
  ready.sort((a, b) => {
    const la = a.lastLatencyMs ?? Number.POSITIVE_INFINITY;
    const lb = b.lastLatencyMs ?? Number.POSITIVE_INFINITY;
    if (la !== lb) return la - lb;
    return a.id.localeCompare(b.id);
  });
  return ready[0];
}

export function markCooldown(entry: KeyEntry, ms = DEFAULT_COOLDOWN_MS, now = Date.now()): KeyEntry {
  return { ...entry, cooldownUntil: now + ms };
}

export function recordLatency(entry: KeyEntry, ms: number): KeyEntry {
  return { ...entry, lastLatencyMs: ms };
}

export { DEFAULT_COOLDOWN_MS };
