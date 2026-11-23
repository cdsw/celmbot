import type {
  Catalog,
  Credential,
  DiscoveredModel,
  FsEntry,
  GitResult,
  GitStatus,
  Key,
} from "@shared/types";

export type { Catalog, Credential, DiscoveredModel, FsEntry, GitResult, GitStatus, Key };

export interface BrowseModelsResult {
  models: DiscoveredModel[];
  cached: boolean;
  fetchedAt: number;
  expiresAt: number;
  source: string;
  totalRaw: number;
  filteredOut: number;
  error?: string;
}

export interface BatchKeysResult {
  ok: boolean;
  added: string[];
  skipped: Array<{ model: string; reason: string }>;
  count: number;
}

const json = async <T>(res: Response): Promise<T> => {
  const text = await res.text();
  const trimmed = text.trim();
  let data: unknown = null;
  if (trimmed) {
    try {
      data = JSON.parse(trimmed);
    } catch {
      const snippet = trimmed.slice(0, 120).replace(/\s+/g, " ");
      throw new Error(
        res.ok
          ? `Expected JSON from ${res.url || "server"}, got: ${snippet}`
          : `${res.status} ${res.statusText}: ${snippet}`
      );
    }
  }
  if (!res.ok) {
    const err = (data as { error?: string } | null)?.error;
    throw new Error(err ?? `${res.status} ${res.statusText}`);
  }
  return data as T;
};

export const api = {
  getConfig: () => fetch("/api/config").then((r) => json(r)),
  putConfig: (body: unknown) =>
    fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) =>
      json(r)
    ),
  getCredentials: () =>
    fetch("/api/credentials").then((r) => json<{ cloud: Credential[]; local: Credential[] }>(r)),
  addCredential: (body: Partial<Credential> & { pool: "cloud" | "local"; baseUrl: string }) =>
    fetch("/api/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json<{ ok: boolean; id: string; credential: Credential }>(r)),
  deleteCredential: (id: string) =>
    fetch(`/api/credentials/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => json(r)),
  getKeys: () => fetch("/api/keys").then((r) => json<{ cloud: Key[]; local: Key[] }>(r)),
  addKey: (body: Partial<Key> & { pool?: "cloud" | "local"; credentialId: string; model: string }) =>
    fetch("/api/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) =>
      json<{ ok: boolean; id: string; credentialId: string }>(r)
    ),
  deleteKey: (id: string) => fetch(`/api/keys/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => json(r)),
  probeKey: (id: string) => fetch(`/api/keys/${encodeURIComponent(id)}/probe`, { method: "POST" }).then((r) => json(r)),
  browseModels: (body: {
    credentialId?: string;
    baseUrl?: string;
    apiKey?: string;
    providerId?: string;
    refresh?: boolean;
    compatibleOnly?: boolean;
  }) =>
    fetch("/api/models/browse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json<BrowseModelsResult>(r)),
  addKeysBatch: (body: {
    credentialId: string;
    providerId?: string;
    label?: string;
    models: string[];
    hints?: Record<string, { supportsTools?: boolean | null }>;
    probe?: boolean;
  }) =>
    fetch("/api/keys/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json<BatchKeysResult>(r)),
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
  getSession: (projectRoot: string) =>
    fetch(`/api/sessions?projectRoot=${encodeURIComponent(projectRoot)}`).then((r) => json(r)),
  getSessionById: (id: string) => fetch(`/api/sessions/${id}`).then((r) => json(r)),
  putSessionChrome: (id: string, chrome: unknown) =>
    fetch(`/api/sessions/${id}/chrome`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chrome),
    }).then((r) => json(r)),
  postSessionMessage: (id: string, body: { text: string; chrome?: unknown }) =>
    fetch(`/api/sessions/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => json(r)),
  drainSession: (id: string) =>
    fetch(`/api/sessions/${id}/drain`, { method: "POST" }).then((r) => json(r)),
  pause: (id: string) => fetch(`/api/runs/${id}/pause`, { method: "POST" }).then((r) => json(r)),
  resume: (id: string) => fetch(`/api/runs/${id}/resume`, { method: "POST" }).then((r) => json(r)),
  approve: (id: string, decision: "allow" | "deny" | "allowlist", approvalId?: string) =>
    fetch(`/api/runs/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, approvalId }),
    }).then((r) => json(r)),
  pauseScope: (id: string, scope: "all" | "one" = "all") =>
    fetch(`/api/runs/${id}/pause`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope }),
    }).then((r) => json(r)),

  openWorkspace: (projectRoot: string) =>
    fetch("/api/workspace/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectRoot }),
    }).then((r) => json<{ ok: boolean; projectRoot: string; git: GitStatus }>(r)),

  listDir: (projectRoot: string, dirPath = ".") =>
    fetch(`/api/fs/list?projectRoot=${encodeURIComponent(projectRoot)}&path=${encodeURIComponent(dirPath)}`).then((r) =>
      json<{ entries: FsEntry[] }>(r)
    ),
  readFile: (projectRoot: string, filePath: string) =>
    fetch(`/api/fs/read?projectRoot=${encodeURIComponent(projectRoot)}&path=${encodeURIComponent(filePath)}`).then((r) =>
      json<{ path: string; content: string; truncated: boolean; language: string }>(r)
    ),
  writeFile: (projectRoot: string, filePath: string, content: string, opts?: { createOnly?: boolean }) =>
    fetch("/api/fs/write", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectRoot, path: filePath, content, createOnly: opts?.createOnly }),
    }).then((r) => json<{ ok: boolean; path: string; created: boolean }>(r)),
  mkdir: (projectRoot: string, dirPath: string) =>
    fetch("/api/fs/mkdir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectRoot, path: dirPath }),
    }).then((r) => json<{ ok: boolean; path: string; created: boolean }>(r)),
  deletePath: (projectRoot: string, filePath: string) =>
    fetch("/api/fs/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectRoot, path: filePath }),
    }).then((r) => json<{ ok: boolean; path: string; type: "file" | "dir" }>(r)),
  movePath: (projectRoot: string, from: string, to: string) =>
    fetch("/api/fs/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectRoot, from, to }),
    }).then((r) => json<{ ok: boolean; from: string; to: string; type: "file" | "dir" }>(r)),

  gitStatus: (projectRoot: string) =>
    fetch(`/api/git/status?projectRoot=${encodeURIComponent(projectRoot)}`).then((r) => json<GitStatus>(r)),
  gitDiff: (projectRoot: string, opts?: { staged?: boolean; path?: string }) => {
    const q = new URLSearchParams({ projectRoot });
    if (opts?.staged) q.set("staged", "1");
    if (opts?.path) q.set("path", opts.path);
    return fetch(`/api/git/diff?${q}`).then((r) => json<GitResult>(r));
  },
  gitLog: (projectRoot: string, limit = 20) =>
    fetch(`/api/git/log?projectRoot=${encodeURIComponent(projectRoot)}&limit=${limit}`).then((r) => json<GitResult>(r)),
  gitBranches: (projectRoot: string) =>
    fetch(`/api/git/branches?projectRoot=${encodeURIComponent(projectRoot)}`).then((r) =>
      json<{ current?: string; branches: string[] }>(r)
    ),
  gitInit: (projectRoot: string) =>
    fetch("/api/git/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectRoot }),
    }).then((r) => json<GitResult>(r)),
  gitAdd: (projectRoot: string, paths: string[]) =>
    fetch("/api/git/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectRoot, paths }),
    }).then((r) => json<GitResult>(r)),
  gitRestore: (projectRoot: string, paths: string[], staged?: boolean) =>
    fetch("/api/git/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectRoot, paths, staged }),
    }).then((r) => json<GitResult>(r)),
  gitCommit: (projectRoot: string, message: string) =>
    fetch("/api/git/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectRoot, message }),
    }).then((r) => json<GitResult>(r)),
  gitCheckout: (projectRoot: string, branch: string) =>
    fetch("/api/git/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectRoot, branch }),
    }).then((r) => json<GitResult>(r)),
};
