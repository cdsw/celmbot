const json = async <T>(res: Response): Promise<T> => {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
};

export const api = {
  getConfig: () => fetch("/api/config").then((r) => json(r)),
  putConfig: (body: unknown) =>
    fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) =>
      json(r)
    ),
  getKeys: () => fetch("/api/keys").then((r) => json<{ cloud: Key[]; local: Key[] }>(r)),
  addKey: (body: Partial<Key> & { pool: "cloud" | "local" }) =>
    fetch("/api/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) =>
      json<{ ok: boolean; id: string }>(r)
    ),
  deleteKey: (id: string) => fetch(`/api/keys/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => json(r)),
  probeKey: (id: string) => fetch(`/api/keys/${encodeURIComponent(id)}/probe`, { method: "POST" }).then((r) => json(r)),
  catalogs: () => fetch("/api/catalogs").then((r) => json<{ cloud: Catalog[]; local: Catalog[] }>(r)),
  skills: () => fetch("/api/skills").then((r) => json(r)),
  recipes: () => fetch("/api/recipes").then((r) => json(r)),
  stats: () => fetch("/api/stats").then((r) => json(r)),
  clearStats: () => fetch("/api/stats", { method: "DELETE" }).then((r) => json(r)),
  listRuns: () => fetch("/api/runs").then((r) => json(r)),
  getRun: (id: string) => fetch(`/api/runs/${id}`).then((r) => json(r)),
  startRun: (body: unknown) =>
    fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) =>
      json(r)
    ),
  pause: (id: string) => fetch(`/api/runs/${id}/pause`, { method: "POST" }).then((r) => json(r)),
  resume: (id: string) => fetch(`/api/runs/${id}/resume`, { method: "POST" }).then((r) => json(r)),
  approve: (id: string, decision: "allow" | "deny" | "allowlist") =>
    fetch(`/api/runs/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    }).then((r) => json(r)),
};

export interface Key {
  id: string;
  pool: "cloud" | "local";
  providerId: string;
  label: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  rpm: number;
  rpd: number;
  enabled: boolean;
  supportsTools?: boolean;
  degradedMode?: boolean;
  lastLatencyMs?: number;
  cooldownUntil?: number;
}

export interface Catalog {
  id: string;
  name: string;
  baseUrl: string;
  defaultModel: string;
  rpm: number;
  rpd: number;
  notes?: string;
}
