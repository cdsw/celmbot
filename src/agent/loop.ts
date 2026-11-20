import { randomUUID } from "node:crypto";
import type {
  AgentRole,
  KeyEntry,
  PendingApproval,
  RunEvent,
  RunScopes,
  RunState,
  ToolCall,
  ToolName,
} from "../shared/types.js";
import { findKey, loadConfig, saveConfig } from "../config.js";
import { AGENT_TOOLS, chatCompletions, type ChatMessage } from "../keys/modelClient.js";
import { RateLimitQueue } from "../keys/rateQueue.js";
import { markCooldown, pickKey, recordLatency } from "../keys/router.js";
import { loadAllSkills } from "../skills/loader.js";
import { bumpTool, emptyRunStats, loadLifetimeStats, p50, recordLlmCall, saveLifetimeStats } from "../stats/collector.js";
import { gateToolCall } from "../safety/runMode.js";
import { runRecipe } from "../safety/recipes.js";
import { grepFiles, listDir, readFile, unifiedDiff, writeFile } from "../tools/fsTools.js";
import { PathJailError } from "../safety/pathGuard.js";
import { buildSystemPrompt } from "./prompts.js";
import { saveRun } from "./persistence.js";

export type EventSink = (ev: RunEvent) => void;

const queues = new Map<string, RateLimitQueue>();

function queueFor(key: KeyEntry): RateLimitQueue {
  let q = queues.get(key.id);
  if (!q) {
    q = new RateLimitQueue(key.id, key.rpm, key.rpd);
    queues.set(key.id, q);
  } else {
    q.updateLimits(key.rpm, key.rpd);
  }
  if (key.cooldownUntil) q.cooldownUntil = key.cooldownUntil;
  return q;
}

function emit(state: RunState, sink: EventSink, partial: Omit<RunEvent, "id" | "runId" | "ts">): void {
  const ev: RunEvent = {
    id: randomUUID(),
    runId: state.id,
    ts: Date.now(),
    ...partial,
  };
  state.events.push(ev);
  if (state.events.length > 500) state.events = state.events.slice(-500);
  sink(ev);
}

export function createRun(opts: {
  task: string;
  scopes: RunScopes;
  verifyRecipe?: string;
  mode?: "solo" | "orchestrated";
  skillIds?: string[];
  maxSteps?: number;
}): RunState {
  const id = randomUUID();
  const now = Date.now();
  const state: RunState = {
    id,
    mode: opts.mode ?? "solo",
    status: "idle",
    task: opts.task,
    verifyRecipe: opts.verifyRecipe ?? "npm_test",
    scopes: opts.scopes,
    skillIds: opts.skillIds ?? [],
    createdAt: now,
    updatedAt: now,
    step: 0,
    maxSteps: opts.maxSteps ?? 15,
    messages: [],
    events: [],
    agents: [
      {
        id: "solo-1",
        role: "worker",
        writeAllow: opts.scopes.writeAllow,
        status: "idle",
      },
    ],
    filesTouched: [],
    verifyPassed: false,
    stats: emptyRunStats(),
  };
  saveRun(state);
  return state;
}

async function executeTool(
  state: RunState,
  tool: ToolCall,
  writeAllow: string[]
): Promise<{ content: string; diff?: string }> {
  const root = state.scopes.projectRoot;
  const readAllow = state.scopes.readAllow;
  switch (tool.name) {
    case "list_dir": {
      const entries = listDir(root, String(tool.arguments.path ?? "."), readAllow);
      return { content: entries.join("\n") || "(empty)" };
    }
    case "read_file": {
      const text = readFile(root, String(tool.arguments.path), {
        maxChars: Number(tool.arguments.maxChars ?? 40_000),
        readAllow,
      });
      return { content: text };
    }
    case "write_file": {
      const filePath = String(tool.arguments.path);
      const content = String(tool.arguments.content ?? "");
      const result = writeFile(root, filePath, content, writeAllow);
      if (!state.filesTouched.includes(result.rel)) state.filesTouched.push(result.rel);
      const diff = unifiedDiff(result.rel, result.previous, content);
      return { content: `wrote ${result.rel} (${result.created ? "created" : "updated"})`, diff };
    }
    case "grep": {
      const hits = grepFiles(root, String(tool.arguments.pattern), String(tool.arguments.path ?? "."), readAllow);
      return {
        content: hits.map((h) => `${h.file}:${h.line}: ${h.text}`).join("\n") || "(no matches)",
      };
    }
    case "run_recipe": {
      const name = String(tool.arguments.name);
      const args = Array.isArray(tool.arguments.args) ? (tool.arguments.args as string[]) : [];
      state.stats.verifyAttempts += 1;
      const result = await runRecipe(root, name, args, { timeoutMs: 120_000 });
      state.stats.lastVerifyExitCode = result.exitCode;
      if (name === state.verifyRecipe || name === "npm_test") {
        state.verifyPassed = result.exitCode === 0;
      }
      return {
        content: `exit ${result.exitCode}\n$ ${result.command} ${result.args.join(" ")}\n${result.stdout}\n${result.stderr}`.slice(
          0,
          30_000
        ),
      };
    }
    case "fetch_url": {
      const url = String(tool.arguments.url ?? "");
      const res = await fetch(url);
      const text = await res.text();
      return { content: `status ${res.status}\n${text.slice(0, 8000)}` };
    }
    default:
      throw new PathJailError(`unknown tool`);
  }
}

export async function resolveApproval(
  state: RunState,
  decision: "allow" | "deny" | "allowlist",
  sink: EventSink
): Promise<RunState> {
  const pending = state.pendingApproval;
  if (!pending) return state;
  if (decision === "deny") {
    state.stats.approvalsDenied += 1;
    state.pendingApproval = undefined;
    state.status = "running";
    state.messages.push({
      role: "tool",
      tool_call_id: pending.tool.id,
      content: "User denied this tool call.",
    });
    emit(state, sink, { type: "approval", message: "denied", data: { id: pending.id } });
    saveRun(state);
    return tick(state, sink);
  }
  if (decision === "allowlist") {
    const cfg = loadConfig();
    const name = String(pending.tool.arguments.name ?? pending.tool.name);
    const entry = pending.tool.name === "run_recipe" ? `recipe:${name}` : pending.tool.name;
    if (!cfg.terminalAllowlist.includes(entry)) cfg.terminalAllowlist.push(entry);
    saveConfig(cfg);
  }
  state.stats.approvalsGranted += 1;
  state.pendingApproval = undefined;
  state.status = "running";
  try {
    const agent = state.agents[0];
    const result = await executeTool(state, pending.tool, agent?.writeAllow ?? state.scopes.writeAllow);
    bumpTool(state.stats, pending.tool.name);
    state.messages.push({
      role: "tool",
      tool_call_id: pending.tool.id,
      content: result.content,
    });
    emit(state, sink, {
      type: "tool_result",
      message: pending.tool.name,
      data: { content: result.content.slice(0, 4000), diff: result.diff },
    });
  } catch (err) {
    state.stats.errors += 1;
    const msg = err instanceof Error ? err.message : String(err);
    state.messages.push({ role: "tool", tool_call_id: pending.tool.id, content: `Error: ${msg}` });
    emit(state, sink, { type: "error", message: msg });
  }
  saveRun(state);
  return tick(state, sink);
}

export async function tick(state: RunState, sink: EventSink): Promise<RunState> {
  if (state.status === "paused" || state.status === "done" || state.status === "waiting_approval") {
    return state;
  }
  state.status = "running";
  state.stats.wallMs = Date.now() - state.createdAt;

  if (state.step >= state.maxSteps) {
    state.status = "done";
    emit(state, sink, { type: "done", message: "step cap reached" });
    saveRun(state);
    return state;
  }

  const cfg = loadConfig();
  const skills = loadAllSkills().filter((s) => !state.skillIds.length || state.skillIds.includes(s.id));
  const role: AgentRole = state.agents[0]?.role ?? "worker";
  const keyId =
    cfg.roles[role] ??
    cfg.roles.worker ??
    cfg.roles.orchestrator ??
    [...cfg.keys.cloud, ...cfg.keys.local].find((k) => k.enabled)?.id;
  let key = keyId ? findKey(cfg, keyId) : undefined;
  if (!key) {
    key = pickKey([...cfg.keys.cloud, ...cfg.keys.local]);
  }
  if (!key) {
    state.status = "error";
    emit(state, sink, { type: "error", message: "No enabled tool-capable keys. Add a Cloud or Local key." });
    saveRun(state);
    return state;
  }

  if (!state.messages.length) {
    state.messages.push({
      role: "system",
      content: buildSystemPrompt({
        task: state.task,
        projectRoot: state.scopes.projectRoot,
        writeAllow: state.scopes.writeAllow,
        verifyRecipe: state.verifyRecipe,
        skills,
        budget: cfg.budget,
        role,
      }),
    });
    state.messages.push({ role: "user", content: state.task });
  }

  const q = queueFor(key);
  const qStats = q.getStats();
  if (qStats.waiting || q.cooldownUntil > Date.now()) {
    emit(state, sink, {
      type: "queue",
      keyId: key.id,
      message: `waiting on key ${key.label || key.id}`,
      data: { ...qStats, cooldownUntil: q.cooldownUntil },
    });
  }

  state.step += 1;
  emit(state, sink, {
    type: "llm",
    keyId: key.id,
    role,
    message: `step ${state.step} via ${key.pool}/${key.model}`,
  });

  let result;
  try {
    result = await q.enqueue(() => chatCompletions(key!, state.messages as ChatMessage[], AGENT_TOOLS));
  } catch (err) {
    state.stats.errors += 1;
    state.status = "error";
    emit(state, sink, { type: "error", message: err instanceof Error ? err.message : String(err) });
    saveRun(state);
    return state;
  }

  state.stats.llmCalls += 1;
  state.stats.latencyLastMs = result.latencyMs;
  state.stats.latencyMaxMs = Math.max(state.stats.latencyMaxMs ?? 0, result.latencyMs);
  state.stats.queueWaitMs += q.lastWaitMs;
  if (result.usage?.prompt_tokens) state.stats.tokensIn = (state.stats.tokensIn ?? 0) + result.usage.prompt_tokens;
  if (result.usage?.completion_tokens)
    state.stats.tokensOut = (state.stats.tokensOut ?? 0) + result.usage.completion_tokens;

  // update key latency / cooldown in config
  let nextKey: KeyEntry = recordLatency(key, result.latencyMs);
  if (result.status === 429 || result.status === 402) {
    state.stats.rateLimitHits += 1;
    nextKey = markCooldown(nextKey);
    q.setCooldown(10 * 60 * 1000);
    state.status = "rate_limited";
    emit(state, sink, {
      type: "queue",
      keyId: key.id,
      message: `${result.status} — cooling down key`,
      data: { error: result.rawError },
    });
  }
  const cfg2 = loadConfig();
  const pool = nextKey.pool;
  cfg2.keys[pool] = cfg2.keys[pool].map((k) => (k.id === nextKey.id ? nextKey : k));
  saveConfig(cfg2);

  let lifetime = loadLifetimeStats();
  lifetime = recordLlmCall(lifetime, key.id, {
    latencyMs: result.latencyMs,
    ok: result.status < 400,
    rateLimited: result.status === 429 || result.status === 402,
  });
  saveLifetimeStats(lifetime);

  const samples = lifetime.perKey[key.id]?.latencySamples ?? [];
  state.stats.latencyP50Ms = p50(samples);

  if (result.status >= 400) {
    state.stats.errors += 1;
    emit(state, sink, { type: "error", message: result.rawError ?? `HTTP ${result.status}` });
    saveRun(state);
    if (state.status === "rate_limited") return state;
    state.status = "error";
    return state;
  }

  const msg = result.message;
  state.messages.push({
    role: "assistant",
    content: msg.content ?? "",
    tool_calls: msg.tool_calls,
  });

  const toolCalls = msg.tool_calls ?? [];
  if (!toolCalls.length) {
    if (state.verifyPassed) {
      state.status = "done";
      lifetime.verifyPass += 1;
      lifetime.totalRuns += 1;
      saveLifetimeStats(lifetime);
      emit(state, sink, { type: "done", message: msg.content ?? "done", data: { verifyPassed: true } });
    } else {
      emit(state, sink, {
        type: "verify",
        message: "Model stopped without successful verify. Continuing or await user.",
      });
      // nudge once
      state.messages.push({
        role: "user",
        content: `You have not proven the work. Run recipe ${state.verifyRecipe} and only then finish.`,
      });
      if (state.step >= state.maxSteps - 1) {
        state.status = "done";
        lifetime.verifyFail += 1;
        lifetime.totalRuns += 1;
        saveLifetimeStats(lifetime);
        emit(state, sink, { type: "done", message: "finished without verify", data: { verifyPassed: false } });
      } else {
        saveRun(state);
        return tick(state, sink);
      }
    }
    saveRun(state);
    emit(state, sink, { type: "stats", data: { ...state.stats } });
    return state;
  }

  for (const tc of toolCalls) {
    const tool: ToolCall = {
      id: tc.id,
      name: tc.function.name as ToolName,
      arguments: safeParseArgs(tc.function.arguments),
    };
    const decision = gateToolCall({
      mode: cfg.runMode,
      tool,
      projectRoot: state.scopes.projectRoot,
      terminalAllowlist: cfg.terminalAllowlist,
    });
    emit(state, sink, {
      type: "tool_request",
      message: tool.name,
      data: { arguments: tool.arguments, needsApproval: decision.needsApproval },
    });

    if (decision.needsApproval) {
      let diff: string | undefined;
      if (tool.name === "write_file") {
        try {
          const prev = readFile(state.scopes.projectRoot, String(tool.arguments.path), {
            readAllow: state.scopes.readAllow,
          });
          diff = unifiedDiff(String(tool.arguments.path), prev, String(tool.arguments.content ?? ""));
        } catch {
          diff = unifiedDiff(String(tool.arguments.path), undefined, String(tool.arguments.content ?? ""));
        }
      }
      const pending: PendingApproval = {
        id: randomUUID(),
        runId: state.id,
        tool,
        summary: `${tool.name} ${JSON.stringify(tool.arguments).slice(0, 200)}`,
        diff,
        createdAt: Date.now(),
      };
      state.pendingApproval = pending;
      state.status = "waiting_approval";
      emit(state, sink, { type: "approval", message: pending.summary, data: { ...pending } });
      saveRun(state);
      return state;
    }

    try {
      const out = await executeTool(state, tool, state.agents[0]?.writeAllow ?? state.scopes.writeAllow);
      bumpTool(state.stats, tool.name);
      state.messages.push({ role: "tool", tool_call_id: tool.id, content: out.content });
      emit(state, sink, {
        type: "tool_result",
        message: tool.name,
        data: { content: out.content.slice(0, 4000), diff: out.diff },
      });
      if (tool.name === "run_recipe") {
        emit(state, sink, {
          type: "verify",
          message: state.verifyPassed ? "verify passed" : "verify failed",
          data: { exitCode: state.stats.lastVerifyExitCode },
        });
      }
    } catch (err) {
      state.stats.errors += 1;
      const message = err instanceof Error ? err.message : String(err);
      state.messages.push({ role: "tool", tool_call_id: tool.id, content: `Error: ${message}` });
      emit(state, sink, { type: "error", message });
    }
  }

  emit(state, sink, { type: "stats", data: { ...state.stats } });
  saveRun(state);
  return tick(state, sink);
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function startRun(state: RunState, sink: EventSink): Promise<RunState> {
  state.status = "running";
  emit(state, sink, { type: "status", message: "running" });
  saveRun(state);
  return tick(state, sink);
}

export function pauseRun(state: RunState, sink: EventSink): RunState {
  state.status = "paused";
  emit(state, sink, { type: "status", message: "paused" });
  saveRun(state);
  return state;
}

export async function resumeRun(state: RunState, sink: EventSink): Promise<RunState> {
  if (state.status === "waiting_approval") return state;
  state.status = "running";
  emit(state, sink, { type: "status", message: "resumed" });
  saveRun(state);
  return tick(state, sink);
}
