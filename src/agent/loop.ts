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
  VerifyEvidence,
  WorkerReportStatus,
} from "../shared/types.js";
import { findKey, loadConfig, saveConfigDebounced, allKeys } from "../config.js";
import { resolveRoute, resolvedAsKeyEntry } from "../keys/credentials.js";
import { AGENT_TOOLS, chatCompletions, type ChatMessage } from "../keys/modelClient.js";
import { RateLimitQueue } from "../keys/rateQueue.js";
import { markCooldown, pickKey, recordLatency } from "../keys/router.js";
import { loadAllSkills } from "../skills/loader.js";
import { bumpTool, emptyRunStats, loadLifetimeStats, p50, recordLlmCall, saveLifetimeStats } from "../stats/collector.js";
import { gateToolCall } from "../safety/runMode.js";
import { normalizeRecipeName, runRecipe } from "../safety/recipes.js";
import { grepFiles, listDir, readFile, unifiedDiff, writeFile } from "../tools/fsTools.js";
import { PathJailError } from "../safety/pathGuard.js";
import { buildSystemPrompt } from "./prompts.js";
import { saveRun } from "./persistence.js";
import { createWorkerAgent, getActiveAgent, setActiveAgent, setAgentStatus, syncActiveMessages } from "./agents.js";

/** Worker steps with zero file touches before speculative discard (free-tier thrift). */
const IDLE_TOUCH_STEPS = 4;

export type EventSink = (ev: RunEvent) => void;

const queues = new Map<string, RateLimitQueue>();

function queueFor(key: KeyEntry): RateLimitQueue {
  const cfg = loadConfig();
  const resolved = resolveRoute(cfg, key);
  const queueId = resolved?.credentialId ?? key.credentialId ?? key.id;
  const rpm = resolved?.rpm ?? key.rpm ?? 20;
  const rpd = resolved?.rpd ?? key.rpd ?? 50;
  let q = queues.get(queueId);
  if (!q) {
    q = new RateLimitQueue(queueId, rpm, rpd);
    queues.set(queueId, q);
  } else {
    q.updateLimits(rpm, rpd);
  }
  if (key.cooldownUntil) q.cooldownUntil = Math.max(q.cooldownUntil, key.cooldownUntil);
  return q;
}

export function emit(
  state: RunState,
  sink: EventSink,
  partial: Omit<RunEvent, "id" | "runId" | "ts">
): void {
  const agent = getActiveAgent(state);
  const ev: RunEvent = {
    id: randomUUID(),
    runId: state.id,
    ts: Date.now(),
    ...partial,
    agentId: partial.agentId ?? agent?.id,
    role: partial.role ?? agent?.role,
  };
  state.events.push(ev);
  if (state.events.length > 500) state.events = state.events.slice(-500);
  sink(ev);
}

function headApproval(state: RunState): void {
  state.pendingApproval = state.pendingApprovals[0];
}

/** Evidence-gated: PASS only with a green recipe. No status → GAP (keep nudging). */
export function parseReportStatus(content: string, verifyPassed: boolean): WorkerReportStatus {
  const upper = content.toUpperCase();
  if (/\bBLOCKED\b/.test(upper)) return "BLOCKED";
  if (/\bGAP\b/.test(upper) && !/\bPASS\b/.test(upper) && !/\bISSUES\b/.test(upper)) return "GAP";
  const claimsPass =
    /^\s*\**\s*PASS\b/m.test(content) ||
    /\b\*\*PASS\*\*/i.test(content) ||
    (/\bPASS\b/.test(upper) && !/\bISSUES\b/.test(upper));
  if (claimsPass) return verifyPassed ? "PASS" : "ISSUES";
  if (/\bISSUES\b/.test(upper)) return "ISSUES";
  if (verifyPassed) return "PASS";
  return "GAP";
}

function extractIssues(content: string): string[] {
  return content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-*•]/.test(l) || /^issue\b/i.test(l))
    .map((l) => l.replace(/^[-*•]\s*/, ""))
    .slice(0, 20);
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
  const maxSteps = opts.maxSteps ?? 15;
  const worker = createWorkerAgent({
    id: "solo-1",
    writeAllow: opts.scopes.writeAllow,
    brief: opts.task,
    maxSteps,
  });
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
    maxSteps,
    messages: worker.messages,
    events: [],
    pendingApprovals: [],
    activeAgentId: worker.id,
    agents: [worker],
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
  const agent = getActiveAgent(state);
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
      if (agent && !agent.filesTouched.includes(result.rel)) agent.filesTouched.push(result.rel);
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
      const normalized = normalizeRecipeName(name);
      const verifyName = normalizeRecipeName(state.verifyRecipe);
      const evidence: VerifyEvidence = {
        recipe: normalized,
        command: result.command,
        args: result.args,
        exitCode: result.exitCode,
        stdoutTail: `${result.stdout}\n${result.stderr}`.trim().slice(-2000),
        at: Date.now(),
      };
      if (agent) agent.evidence = evidence;
      state.verifyEvidence = evidence;
      if (normalized === verifyName || normalized === "npm_test") {
        state.verifyPassed = result.exitCode === 0;
        if (agent) agent.verifyPassed = result.exitCode === 0;
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

function selectKey(
  role: AgentRole,
  excludeIds: string[] = [],
  opts?: { avoidProviderId?: string }
): KeyEntry | undefined {
  const cfg = loadConfig();
  const keys = allKeys(cfg).filter((k) => {
    if (excludeIds.includes(k.id)) return false;
    const resolved = resolveRoute(cfg, k);
    return Boolean(resolved?.enabled);
  });
  // Verifier: prefer a different provider than workers when 2+ keys exist.
  if (role === "verifier" && opts?.avoidProviderId) {
    const alt = pickKey(keys, { excludeIds, preferDifferentFrom: opts.avoidProviderId });
    if (alt) return alt;
  }
  const preferredId = cfg.roles[role] ?? cfg.roles.worker ?? cfg.roles.orchestrator;
  let key = preferredId && !excludeIds.includes(preferredId) ? findKey(cfg, preferredId) : undefined;
  if (key) {
    const resolved = resolveRoute(cfg, key);
    if (!resolved?.enabled || (key.cooldownUntil ?? 0) > Date.now()) key = undefined;
    if (
      key &&
      role === "verifier" &&
      opts?.avoidProviderId &&
      key.providerId === opts.avoidProviderId
    ) {
      const alt = pickKey(keys, { excludeIds: [...excludeIds, key.id], preferDifferentFrom: opts.avoidProviderId });
      if (alt) return alt;
    }
  }
  if (!key) key = pickKey(keys, { excludeIds, preferDifferentFrom: opts?.avoidProviderId });
  return key;
}

function avoidProviderForRole(state: RunState, role: AgentRole): string | undefined {
  if (role !== "verifier") return undefined;
  const cfg = loadConfig();
  const workers = state.agents.filter((a) => a.role === "worker" && a.keyId);
  const last = workers[workers.length - 1];
  if (!last?.keyId) return undefined;
  return findKey(cfg, last.keyId)?.providerId;
}

function persistKeyUpdate(nextKey: KeyEntry): void {
  const cfg2 = loadConfig();
  const pool = nextKey.pool;
  cfg2.keys[pool] = cfg2.keys[pool].map((k) => (k.id === nextKey.id ? nextKey : k));
  saveConfigDebounced(cfg2);
}

export async function resolveApproval(
  state: RunState,
  decision: "allow" | "deny" | "allowlist",
  sink: EventSink,
  approvalId?: string
): Promise<RunState> {
  const idx = approvalId
    ? state.pendingApprovals.findIndex((p) => p.id === approvalId)
    : 0;
  const pending = idx >= 0 ? state.pendingApprovals[idx] : undefined;
  if (!pending) return state;

  setActiveAgent(state, pending.agentId);
  const agent = getActiveAgent(state);

  if (decision === "deny") {
    state.stats.approvalsDenied += 1;
    state.pendingApprovals.splice(idx, 1);
    headApproval(state);
    state.status = state.pendingApprovals.length ? "waiting_approval" : "running";
    agent!.messages.push({
      role: "tool",
      tool_call_id: pending.tool.id,
      content: "User denied this tool call.",
    });
    syncActiveMessages(state);
    emit(state, sink, {
      type: "approval",
      message: "denied",
      agentId: pending.agentId,
      data: { id: pending.id },
    });
    saveRun(state);
    if (state.pendingApprovals.length) return state;
    return tick(state, sink);
  }
  if (decision === "allowlist") {
    const cfg = loadConfig();
    const name = String(pending.tool.arguments.name ?? pending.tool.name);
    const entry = pending.tool.name === "run_recipe" ? `recipe:${name}` : pending.tool.name;
    if (!cfg.terminalAllowlist.includes(entry)) cfg.terminalAllowlist.push(entry);
    saveConfigDebounced(cfg);
  }
  state.stats.approvalsGranted += 1;
  state.pendingApprovals.splice(idx, 1);
  headApproval(state);
  state.status = state.pendingApprovals.length ? "waiting_approval" : "running";
  try {
    const result = await executeTool(state, pending.tool, agent?.writeAllow ?? state.scopes.writeAllow);
    bumpTool(state.stats, pending.tool.name);
    agent!.messages.push({
      role: "tool",
      tool_call_id: pending.tool.id,
      content: result.content,
    });
    syncActiveMessages(state);
    emit(state, sink, {
      type: "tool_result",
      message: pending.tool.name,
      agentId: pending.agentId,
      data: { content: result.content.slice(0, 4000), diff: result.diff },
    });
  } catch (err) {
    state.stats.errors += 1;
    const msg = err instanceof Error ? err.message : String(err);
    agent!.messages.push({ role: "tool", tool_call_id: pending.tool.id, content: `Error: ${msg}` });
    syncActiveMessages(state);
    emit(state, sink, { type: "error", message: msg, agentId: pending.agentId });
  }
  saveRun(state);
  if (state.pendingApprovals.length) return state;
  const after = await tick(state, sink);
  if (
    after.mode === "orchestrated" &&
    after.status !== "waiting_approval" &&
    after.status !== "paused" &&
    after.status !== "done"
  ) {
    const { continueOrchestrated } = await import("./scheduler.js");
    const agentDone = getActiveAgent(after);
    if (agentDone && (agentDone.status === "done" || agentDone.status === "error" || agentDone.status === "rate_limited")) {
      return continueOrchestrated(after, sink);
    }
  }
  return after;
}

export async function tick(state: RunState, sink: EventSink): Promise<RunState> {
  if (state.status === "paused" || state.status === "done" || state.status === "waiting_approval") {
    return state;
  }
  state.status = "running";
  state.stats.wallMs = Date.now() - state.createdAt;

  const agent = getActiveAgent(state);
  if (!agent) {
    state.status = "error";
    emit(state, sink, { type: "error", message: "No active agent" });
    saveRun(state);
    return state;
  }

  if (agent.step >= agent.maxSteps) {
    agent.status = "done";
    agent.reportStatus = agent.reportStatus ?? (agent.verifyPassed ? "PASS" : "GAP");
    if (agent.reportStatus === "PASS" && !agent.verifyPassed) agent.reportStatus = "ISSUES";
    setAgentStatus(state, agent.id, "done");
    emit(state, sink, {
      type: "done",
      message: "agent step cap reached",
      agentId: agent.id,
      data: { reportStatus: agent.reportStatus },
    });
    saveRun(state);
    return state;
  }

  // Speculative discard: worker burned steps with no writes and no verify.
  if (
    agent.role === "worker" &&
    agent.step >= IDLE_TOUCH_STEPS &&
    agent.filesTouched.length === 0 &&
    !agent.verifyPassed
  ) {
    agent.status = "done";
    agent.reportStatus = "GAP";
    agent.issues = [`No file touches after ${agent.step} steps — discarded to save free-tier budget`];
    setAgentStatus(state, agent.id, "done");
    emit(state, sink, {
      type: "done",
      message: "speculative discard (idle worker)",
      agentId: agent.id,
      data: { reportStatus: "GAP", idleSteps: agent.step },
    });
    saveRun(state);
    return state;
  }

  const role: AgentRole = agent.role;
  const avoidProviderId = avoidProviderForRole(state, role);
  let key = selectKey(role, [], { avoidProviderId });
  if (!key) {
    state.status = "error";
    emit(state, sink, {
      type: "error",
      message:
        "No enabled tool-capable keys. Add a provider key, then import a tool-capable model.",
      agentId: agent.id,
    });
    saveRun(state);
    return state;
  }

  if (!agent.messages.length) {
    const cfg = loadConfig();
    const skills = loadAllSkills().filter((s) => !state.skillIds.length || state.skillIds.includes(s.id));
    const brief = agent.brief ?? state.task;
    agent.messages.push({
      role: "system",
      content: buildSystemPrompt({
        task: brief,
        projectRoot: state.scopes.projectRoot,
        writeAllow: agent.writeAllow.length ? agent.writeAllow : state.scopes.writeAllow,
        verifyRecipe: state.verifyRecipe,
        skills,
        budget: cfg.budget,
        role,
      }),
    });
    agent.messages.push({
      role: "user",
      content:
        brief +
        (role === "worker" || role === "verifier"
          ? `\n\nRun recipe ${state.verifyRecipe} before claiming PASS. End with PASS, ISSUES, or BLOCKED and list every proven issue. Prefer the smallest change.`
          : ""),
    });
    syncActiveMessages(state);
  }

  const triedKeys: string[] = [];
  let result:
    | Awaited<ReturnType<typeof chatCompletions>>
    | undefined;

  for (let attempt = 0; attempt < 4; attempt++) {
    if (!key) break;
    const q = queueFor(key);
    const qStats = q.getStats();
    if (qStats.waiting || q.cooldownUntil > Date.now()) {
      emit(state, sink, {
        type: "queue",
        keyId: key.id,
        agentId: agent.id,
        role,
        message: `waiting on key ${key.label || key.id}`,
        data: { ...qStats, cooldownUntil: q.cooldownUntil },
      });
    }

    agent.step += 1;
    state.step += 1;
    agent.keyId = key.id;
    emit(state, sink, {
      type: "llm",
      keyId: key.id,
      agentId: agent.id,
      role,
      message: `step ${agent.step} via ${key.pool}/${key.model}`,
    });

    try {
      result = await q.enqueue(() => {
        const cfg = loadConfig();
        const resolved = resolveRoute(cfg, key!);
        const auth = resolved ? resolvedAsKeyEntry(resolved) : key!;
        return chatCompletions(auth, agent.messages as ChatMessage[], AGENT_TOOLS);
      });
    } catch (err) {
      state.stats.errors += 1;
      state.status = "error";
      agent.status = "error";
      emit(state, sink, {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
        agentId: agent.id,
      });
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

    let nextKey: KeyEntry = recordLatency(key, result.latencyMs);
    if (result.status === 429 || result.status === 402) {
      state.stats.rateLimitHits += 1;
      nextKey = markCooldown(nextKey);
      q.setCooldown(10 * 60 * 1000);
      persistKeyUpdate(nextKey);
      triedKeys.push(key.id);
      emit(state, sink, {
        type: "queue",
        keyId: key.id,
        agentId: agent.id,
        message: `${result.status} — cooling down key, trying failover`,
        data: { error: result.rawError, failover: true },
      });
      const failover = selectKey(role, triedKeys, { avoidProviderId });
      if (failover) {
        key = failover;
        agent.step = Math.max(0, agent.step - 1);
        state.step = Math.max(0, state.step - 1);
        continue;
      }
      state.status = "rate_limited";
      agent.status = "rate_limited";
      emit(state, sink, {
        type: "queue",
        keyId: key.id,
        agentId: agent.id,
        message: "rate limited — no alternate keys",
        data: { error: result.rawError },
      });
      saveRun(state);
      return state;
    }

    persistKeyUpdate(nextKey);

    let lifetime = loadLifetimeStats();
    lifetime = recordLlmCall(lifetime, key.id, {
      latencyMs: result.latencyMs,
      ok: result.status < 400,
      rateLimited: false,
    });
    saveLifetimeStats(lifetime);
    const samples = lifetime.perKey[key.id]?.latencySamples ?? [];
    state.stats.latencyP50Ms = p50(samples);

    if (result.status >= 400) {
      state.stats.errors += 1;
      emit(state, sink, {
        type: "error",
        message: result.rawError ?? `HTTP ${result.status}`,
        agentId: agent.id,
      });
      saveRun(state);
      state.status = "error";
      agent.status = "error";
      return state;
    }
    break;
  }

  if (!result || result.status >= 400) {
    return state;
  }

  const msg = result.message;
  agent.messages.push({
    role: "assistant",
    content: msg.content ?? "",
    tool_calls: msg.tool_calls,
  });
  syncActiveMessages(state);

  const toolCalls = msg.tool_calls ?? [];
  if (!toolCalls.length) {
    const content = msg.content ?? "";
    agent.reportStatus = parseReportStatus(content, agent.verifyPassed);
    agent.issues = extractIssues(content);
    const claimedStatus = /\b(PASS|ISSUES|BLOCKED)\b/i.test(content);
    // Green recipe → done. Explicit ISSUES/BLOCKED (or claimed PASS without evidence → ISSUES) → done.
    // Bare GAP / no status → nudge to run recipe.
    const canFinish =
      agent.verifyPassed ||
      agent.reportStatus === "BLOCKED" ||
      (agent.reportStatus === "ISSUES" && claimedStatus);
    if (canFinish) {
      if (agent.verifyPassed && agent.reportStatus !== "BLOCKED" && agent.reportStatus !== "ISSUES") {
        agent.reportStatus = "PASS";
      }
      agent.status = "done";
      state.verifyPassed = state.mode === "solo" ? agent.verifyPassed : state.verifyPassed;
      if (state.mode === "solo") {
        state.status = "done";
        const lifetime = loadLifetimeStats();
        if (agent.verifyPassed) lifetime.verifyPass += 1;
        else lifetime.verifyFail += 1;
        lifetime.totalRuns += 1;
        saveLifetimeStats(lifetime);
        emit(state, sink, {
          type: "done",
          message: content || "done",
          agentId: agent.id,
          data: {
            verifyPassed: agent.verifyPassed,
            reportStatus: agent.reportStatus,
            evidence: agent.evidence,
          },
        });
      } else {
        emit(state, sink, {
          type: "done",
          message: content || "worker done",
          agentId: agent.id,
          data: {
            verifyPassed: agent.verifyPassed,
            reportStatus: agent.reportStatus,
            evidence: agent.evidence,
          },
        });
      }
    } else {
      emit(state, sink, {
        type: "verify",
        message: "Model stopped without successful verify. Continuing or await user.",
        agentId: agent.id,
      });
      agent.messages.push({
        role: "user",
        content: `You have not proven the work. Run recipe ${state.verifyRecipe} and only then finish with PASS/ISSUES/BLOCKED.`,
      });
      syncActiveMessages(state);
      if (agent.step >= agent.maxSteps - 1) {
        agent.status = "done";
        agent.reportStatus = "ISSUES";
        if (state.mode === "solo") {
          state.status = "done";
          const lifetime = loadLifetimeStats();
          lifetime.verifyFail += 1;
          lifetime.totalRuns += 1;
          saveLifetimeStats(lifetime);
          emit(state, sink, {
            type: "done",
            message: "finished without verify",
            agentId: agent.id,
            data: { verifyPassed: false, reportStatus: "ISSUES" },
          });
        } else {
          emit(state, sink, {
            type: "done",
            message: "worker finished without verify",
            agentId: agent.id,
            data: { verifyPassed: false, reportStatus: "ISSUES" },
          });
        }
      } else {
        saveRun(state);
        return tick(state, sink);
      }
    }
    saveRun(state);
    emit(state, sink, { type: "stats", data: { ...state.stats }, agentId: agent.id });
    return state;
  }

  const cfg = loadConfig();
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
      agentId: agent.id,
      role,
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
        agentId: agent.id,
        tool,
        summary: `${agent.id}: ${tool.name} ${JSON.stringify(tool.arguments).slice(0, 200)}`,
        diff,
        createdAt: Date.now(),
      };
      state.pendingApprovals.push(pending);
      headApproval(state);
      state.status = "waiting_approval";
      agent.status = "waiting_approval";
      emit(state, sink, {
        type: "approval",
        message: pending.summary,
        agentId: agent.id,
        data: { ...pending },
      });
      saveRun(state);
      return state;
    }

    try {
      const out = await executeTool(state, tool, agent.writeAllow.length ? agent.writeAllow : state.scopes.writeAllow);
      bumpTool(state.stats, tool.name);
      agent.messages.push({ role: "tool", tool_call_id: tool.id, content: out.content });
      syncActiveMessages(state);
      emit(state, sink, {
        type: "tool_result",
        message: tool.name,
        agentId: agent.id,
        data: { content: out.content.slice(0, 4000), diff: out.diff },
      });
      if (tool.name === "run_recipe") {
        emit(state, sink, {
          type: "verify",
          message: agent.verifyPassed ? "verify passed" : "verify failed",
          agentId: agent.id,
          data: { exitCode: state.stats.lastVerifyExitCode },
        });
      }
    } catch (err) {
      state.stats.errors += 1;
      const message = err instanceof Error ? err.message : String(err);
      agent.messages.push({ role: "tool", tool_call_id: tool.id, content: `Error: ${message}` });
      syncActiveMessages(state);
      emit(state, sink, { type: "error", message, agentId: agent.id });
    }
  }

  emit(state, sink, { type: "stats", data: { ...state.stats }, agentId: agent.id });
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
  const agent = getActiveAgent(state);
  state.status = "running";
  if (agent) agent.status = "running";
  emit(state, sink, { type: "status", message: "running", agentId: agent?.id });
  saveRun(state);
  return tick(state, sink);
}

export function pauseRun(state: RunState, sink: EventSink, scope: "all" | "one" = "all"): RunState {
  if (scope === "one") {
    const agent = getActiveAgent(state);
    if (agent) agent.status = "paused";
  } else {
    for (const a of state.agents) {
      if (a.status === "running" || a.status === "waiting_approval") a.status = "paused";
    }
    state.status = "paused";
  }
  emit(state, sink, { type: "status", message: scope === "one" ? "paused active agent" : "paused" });
  saveRun(state);
  return state;
}

export async function resumeRun(state: RunState, sink: EventSink): Promise<RunState> {
  if (state.status === "waiting_approval") return state;
  state.status = "running";
  const agent = getActiveAgent(state);
  if (agent && agent.status === "paused") agent.status = "running";
  emit(state, sink, { type: "status", message: "resumed", agentId: agent?.id });
  saveRun(state);
  const after = await tick(state, sink);
  if (
    after.mode === "orchestrated" &&
    after.status !== "waiting_approval" &&
    after.status !== "paused" &&
    after.status !== "done"
  ) {
    const { continueOrchestrated } = await import("./scheduler.js");
    const a = getActiveAgent(after);
    if (a && (a.status === "done" || a.status === "error" || a.status === "rate_limited")) {
      return continueOrchestrated(after, sink);
    }
  }
  return after;
}
