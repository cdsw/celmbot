import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allKeys,
  isLocalBaseUrl,
  loadConfig,
  removeKey,
  saveConfig,
  upsertKey,
} from "../config.js";
import {
  createRun,
  pauseRun,
  resolveApproval,
  resumeRun,
  startRun,
} from "../agent/loop.js";
import { createOrchestratedRun, startOrchestrated } from "../agent/orchestrator.js";
import { listRuns, loadRun, saveRun } from "../agent/persistence.js";
import { probeKey } from "../keys/probe.js";
import { clearLifetimeStats, loadLifetimeStats } from "../stats/collector.js";
import { loadAllSkills } from "../skills/loader.js";
import { BUILTIN_RECIPES } from "../safety/recipes.js";
import type { KeyEntry, KeyPool } from "../shared/types.js";
import { languageFromPath, listEntries, readProjectFile, writeProjectFile } from "../workspace/projectFs.js";
import {
  gitAdd,
  gitBranches,
  gitCheckoutBranch,
  gitCommit,
  gitDiff,
  gitInit,
  gitLog,
  gitRestore,
  gitStatus,
} from "../workspace/git.js";
import { SseHub } from "./sse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson<T>(req: http.IncomingMessage): Promise<T> {
  const raw = await readBody(req);
  return (raw ? JSON.parse(raw) : {}) as T;
}

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function loadCatalog(name: "cloud" | "local"): unknown {
  const candidates = [
    path.resolve(__dirname, `../../providers/catalog.${name}.json`),
    path.resolve(process.cwd(), `providers/catalog.${name}.json`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return JSON.parse(fs.readFileSync(c, "utf8"));
  }
  return [];
}

function webDistDir(): string {
  const candidates = [
    path.resolve(__dirname, "../../web/dist"),
    path.resolve(process.cwd(), "web/dist"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

export function createServer(): { server: http.Server; hub: SseHub } {
  const hub = new SseHub();
  const active = new Map<string, ReturnType<typeof loadRun>>();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const { pathname } = url;

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    try {
      if (pathname === "/api/health") {
        sendJson(res, 200, { ok: true, name: "celmbot" });
        return;
      }

      if (pathname === "/api/config" && req.method === "GET") {
        const cfg = loadConfig();
        // redact keys in list view partially
        const redacted = {
          ...cfg,
          keys: {
            cloud: cfg.keys.cloud.map((k) => ({ ...k, apiKey: k.apiKey ? "••••" + k.apiKey.slice(-4) : "" })),
            local: cfg.keys.local.map((k) => ({ ...k, apiKey: k.apiKey ? "••••" + k.apiKey.slice(-4) : "" })),
          },
        };
        sendJson(res, 200, redacted);
        return;
      }

      if (pathname === "/api/config" && req.method === "PUT") {
        const body = await readJson<Partial<ReturnType<typeof loadConfig>>>(req);
        const cfg = loadConfig();
        const next = { ...cfg, ...body, keys: cfg.keys };
        if (body.runMode) next.runMode = body.runMode;
        if (body.budget) next.budget = body.budget;
        if (body.roles) next.roles = body.roles;
        if (body.terminalAllowlist) next.terminalAllowlist = body.terminalAllowlist;
        if (body.maxParallelWorkers) next.maxParallelWorkers = body.maxParallelWorkers;
        if (body.disclaimerAcceptedAt) next.disclaimerAcceptedAt = body.disclaimerAcceptedAt;
        if (body.trustedProjects) next.trustedProjects = body.trustedProjects;
        if (body.lastProjectRoot !== undefined) next.lastProjectRoot = body.lastProjectRoot;
        saveConfig(next);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (pathname === "/api/workspace/open" && req.method === "POST") {
        const body = await readJson<{ projectRoot?: string }>(req);
        const root = body.projectRoot ? path.resolve(body.projectRoot) : "";
        if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
          sendJson(res, 400, { error: "projectRoot missing or is not a directory" });
          return;
        }
        const cfg = loadConfig();
        cfg.lastProjectRoot = root;
        if (!cfg.trustedProjects.includes(root)) cfg.trustedProjects.push(root);
        saveConfig(cfg);
        sendJson(res, 200, { ok: true, projectRoot: root, git: await gitStatus(root) });
        return;
      }

      if (pathname === "/api/fs/list" && req.method === "GET") {
        const root = url.searchParams.get("projectRoot");
        const dir = url.searchParams.get("path") ?? ".";
        if (!root) {
          sendJson(res, 400, { error: "projectRoot required" });
          return;
        }
        sendJson(res, 200, { entries: listEntries(path.resolve(root), dir) });
        return;
      }

      if (pathname === "/api/fs/read" && req.method === "GET") {
        const root = url.searchParams.get("projectRoot");
        const filePath = url.searchParams.get("path");
        if (!root || !filePath) {
          sendJson(res, 400, { error: "projectRoot and path required" });
          return;
        }
        const file = readProjectFile(path.resolve(root), filePath);
        sendJson(res, 200, { ...file, language: languageFromPath(file.path) });
        return;
      }

      if (pathname === "/api/fs/write" && req.method === "PUT") {
        const body = await readJson<{ projectRoot?: string; path?: string; content?: string }>(req);
        if (!body.projectRoot || !body.path || body.content == null) {
          sendJson(res, 400, { error: "projectRoot, path, and content required" });
          return;
        }
        const result = writeProjectFile(path.resolve(body.projectRoot), body.path, body.content);
        sendJson(res, 200, { ok: true, ...result });
        return;
      }

      if (pathname === "/api/git/status" && req.method === "GET") {
        const root = url.searchParams.get("projectRoot");
        if (!root) {
          sendJson(res, 400, { error: "projectRoot required" });
          return;
        }
        sendJson(res, 200, await gitStatus(path.resolve(root)));
        return;
      }

      if (pathname === "/api/git/diff" && req.method === "GET") {
        const root = url.searchParams.get("projectRoot");
        if (!root) {
          sendJson(res, 400, { error: "projectRoot required" });
          return;
        }
        const staged = url.searchParams.get("staged") === "1";
        const filePath = url.searchParams.get("path") ?? undefined;
        sendJson(res, 200, await gitDiff(path.resolve(root), { staged, path: filePath }));
        return;
      }

      if (pathname === "/api/git/log" && req.method === "GET") {
        const root = url.searchParams.get("projectRoot");
        if (!root) {
          sendJson(res, 400, { error: "projectRoot required" });
          return;
        }
        const limit = Number(url.searchParams.get("limit") ?? 20);
        sendJson(res, 200, await gitLog(path.resolve(root), limit));
        return;
      }

      if (pathname === "/api/git/branches" && req.method === "GET") {
        const root = url.searchParams.get("projectRoot");
        if (!root) {
          sendJson(res, 400, { error: "projectRoot required" });
          return;
        }
        sendJson(res, 200, await gitBranches(path.resolve(root)));
        return;
      }

      if (pathname === "/api/git/init" && req.method === "POST") {
        const body = await readJson<{ projectRoot?: string }>(req);
        if (!body.projectRoot) {
          sendJson(res, 400, { error: "projectRoot required" });
          return;
        }
        sendJson(res, 200, await gitInit(path.resolve(body.projectRoot)));
        return;
      }

      if (pathname === "/api/git/add" && req.method === "POST") {
        const body = await readJson<{ projectRoot?: string; paths?: string[] }>(req);
        if (!body.projectRoot || !body.paths?.length) {
          sendJson(res, 400, { error: "projectRoot and paths required" });
          return;
        }
        sendJson(res, 200, await gitAdd(path.resolve(body.projectRoot), body.paths));
        return;
      }

      if (pathname === "/api/git/restore" && req.method === "POST") {
        const body = await readJson<{ projectRoot?: string; paths?: string[]; staged?: boolean }>(req);
        if (!body.projectRoot || !body.paths?.length) {
          sendJson(res, 400, { error: "projectRoot and paths required" });
          return;
        }
        sendJson(res, 200, await gitRestore(path.resolve(body.projectRoot), body.paths, { staged: body.staged }));
        return;
      }

      if (pathname === "/api/git/commit" && req.method === "POST") {
        const body = await readJson<{ projectRoot?: string; message?: string }>(req);
        if (!body.projectRoot || !body.message) {
          sendJson(res, 400, { error: "projectRoot and message required" });
          return;
        }
        sendJson(res, 200, await gitCommit(path.resolve(body.projectRoot), body.message));
        return;
      }

      if (pathname === "/api/git/checkout" && req.method === "POST") {
        const body = await readJson<{ projectRoot?: string; branch?: string }>(req);
        if (!body.projectRoot || !body.branch) {
          sendJson(res, 400, { error: "projectRoot and branch required" });
          return;
        }
        sendJson(res, 200, await gitCheckoutBranch(path.resolve(body.projectRoot), body.branch));
        return;
      }

      if (pathname === "/api/keys" && req.method === "GET") {
        sendJson(res, 200, loadConfig().keys);
        return;
      }

      if (pathname === "/api/keys" && req.method === "POST") {
        const body = await readJson<Partial<KeyEntry> & { pool?: KeyPool }>(req);
        const pool: KeyPool =
          body.pool ?? (body.baseUrl && isLocalBaseUrl(body.baseUrl) ? "local" : "cloud");
        const entry: KeyEntry = {
          id: body.id ?? `${pool}-${Date.now()}`,
          pool,
          providerId: body.providerId ?? "custom",
          label: body.label ?? body.model ?? "key",
          baseUrl: body.baseUrl ?? "",
          apiKey: body.apiKey,
          model: body.model ?? "",
          rpm: body.rpm ?? 20,
          rpd: body.rpd ?? 50,
          enabled: body.enabled ?? true,
        };
        let cfg = loadConfig();
        cfg = upsertKey(cfg, entry);
        saveConfig(cfg);
        sendJson(res, 200, { ok: true, id: entry.id });
        return;
      }

      if (pathname.startsWith("/api/keys/") && req.method === "DELETE") {
        const id = decodeURIComponent(pathname.slice("/api/keys/".length));
        let cfg = loadConfig();
        cfg = removeKey(cfg, id);
        saveConfig(cfg);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (pathname.startsWith("/api/keys/") && pathname.endsWith("/probe") && req.method === "POST") {
        const id = decodeURIComponent(pathname.slice("/api/keys/".length, -"/probe".length));
        const cfg = loadConfig();
        const key = allKeys(cfg).find((k) => k.id === id);
        if (!key) {
          sendJson(res, 404, { error: "key not found" });
          return;
        }
        const result = await probeKey(key);
        const updated = {
          ...key,
          supportsTools: result.supportsTools,
          supportsEmbeddings: result.supportsEmbeddings,
          degradedMode: result.degradedMode,
          lastLatencyMs: result.latencyMs,
        };
        saveConfig(upsertKey(cfg, updated));
        sendJson(res, 200, result);
        return;
      }

      if (pathname === "/api/catalogs" && req.method === "GET") {
        sendJson(res, 200, { cloud: loadCatalog("cloud"), local: loadCatalog("local") });
        return;
      }

      if (pathname === "/api/skills" && req.method === "GET") {
        sendJson(res, 200, loadAllSkills());
        return;
      }

      if (pathname === "/api/recipes" && req.method === "GET") {
        sendJson(res, 200, BUILTIN_RECIPES);
        return;
      }

      if (pathname === "/api/stats" && req.method === "GET") {
        sendJson(res, 200, loadLifetimeStats());
        return;
      }

      if (pathname === "/api/stats" && req.method === "DELETE") {
        sendJson(res, 200, clearLifetimeStats());
        return;
      }

      if (pathname === "/api/runs" && req.method === "GET") {
        sendJson(res, 200, listRuns());
        return;
      }

      if (pathname === "/api/runs" && req.method === "POST") {
        const body = await readJson<{
          task: string;
          projectRoot: string;
          writeAllow: string[];
          readAllow?: string[];
          verifyRecipe?: string;
          mode?: "solo" | "orchestrated";
          skillIds?: string[];
          workerCount?: number;
          workerGlobs?: string[][];
        }>(req);
        if (!body.projectRoot || !fs.existsSync(body.projectRoot)) {
          sendJson(res, 400, { error: "projectRoot missing or does not exist" });
          return;
        }
        const scopes = {
          projectRoot: path.resolve(body.projectRoot),
          writeAllow: body.writeAllow ?? [],
          readAllow: body.readAllow,
        };
        const state =
          body.mode === "orchestrated"
            ? createOrchestratedRun({
                task: body.task,
                scopes,
                verifyRecipe: body.verifyRecipe,
                skillIds: body.skillIds,
                workerGlobs:
                  body.workerGlobs ??
                  Array.from({ length: body.workerCount ?? 2 }, () => scopes.writeAllow),
              })
            : createRun({
                task: body.task,
                scopes,
                verifyRecipe: body.verifyRecipe,
                skillIds: body.skillIds,
                mode: "solo",
              });
        active.set(state.id, state);
        sendJson(res, 200, state);
        // kick async
        const sink = (ev: Parameters<typeof hub.publish>[1]) => hub.publish(state.id, ev);
        void (body.mode === "orchestrated" ? startOrchestrated(state, sink) : startRun(state, sink)).then(
          (s) => active.set(s.id, s)
        );
        return;
      }

      if (pathname.startsWith("/api/runs/") && req.method === "GET" && !pathname.includes("/events")) {
        const id = pathname.slice("/api/runs/".length).split("/")[0];
        const state = active.get(id) ?? loadRun(id);
        if (!state) {
          sendJson(res, 404, { error: "not found" });
          return;
        }
        sendJson(res, 200, state);
        return;
      }

      if (pathname.match(/^\/api\/runs\/[^/]+\/events$/) && req.method === "GET") {
        const id = pathname.split("/")[3];
        hub.subscribe(id, res);
        return;
      }

      if (pathname.match(/^\/api\/runs\/[^/]+\/pause$/) && req.method === "POST") {
        const id = pathname.split("/")[3];
        const state = active.get(id) ?? loadRun(id);
        if (!state) {
          sendJson(res, 404, { error: "not found" });
          return;
        }
        const next = pauseRun(state, (ev) => hub.publish(id, ev));
        active.set(id, next);
        sendJson(res, 200, next);
        return;
      }

      if (pathname.match(/^\/api\/runs\/[^/]+\/resume$/) && req.method === "POST") {
        const id = pathname.split("/")[3];
        const state = active.get(id) ?? loadRun(id);
        if (!state) {
          sendJson(res, 404, { error: "not found" });
          return;
        }
        sendJson(res, 200, { ok: true });
        void resumeRun(state, (ev) => hub.publish(id, ev)).then((s) => {
          active.set(id, s);
          saveRun(s);
        });
        return;
      }

      if (pathname.match(/^\/api\/runs\/[^/]+\/approve$/) && req.method === "POST") {
        const id = pathname.split("/")[3];
        const body = await readJson<{ decision: "allow" | "deny" | "allowlist" }>(req);
        const state = active.get(id) ?? loadRun(id);
        if (!state) {
          sendJson(res, 404, { error: "not found" });
          return;
        }
        sendJson(res, 200, { ok: true });
        void resolveApproval(state, body.decision ?? "allow", (ev) => hub.publish(id, ev)).then((s) => {
          active.set(id, s);
        });
        return;
      }

      // static UI
      const dist = webDistDir();
      let filePath = path.join(dist, pathname === "/" ? "index.html" : pathname);
      if (!filePath.startsWith(dist)) {
        sendJson(res, 403, { error: "forbidden" });
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(dist, "index.html");
      }
      if (!fs.existsSync(filePath)) {
        sendJson(res, 200, {
          message: "CelmBot API is running. Build the web UI with npm run build:web",
        });
        return;
      }
      const ext = path.extname(filePath);
      const types: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".json": "application/json",
        ".woff2": "font/woff2",
      };
      res.writeHead(200, { "Content-Type": types[ext] ?? "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  return { server, hub };
}
