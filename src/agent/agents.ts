import type { AgentState, RunState, RunStatus } from "../shared/types.js";

export function getActiveAgent(state: RunState): AgentState | undefined {
  return state.agents.find((a) => a.id === state.activeAgentId) ?? state.agents[0];
}

export function setActiveAgent(state: RunState, agentId: string): AgentState | undefined {
  const agent = state.agents.find((a) => a.id === agentId);
  if (!agent) return undefined;
  state.activeAgentId = agentId;
  state.messages = agent.messages;
  if (agent.writeAllow.length) {
    state.scopes = { ...state.scopes, writeAllow: agent.writeAllow };
  }
  return agent;
}

export function syncActiveMessages(state: RunState): void {
  const agent = getActiveAgent(state);
  if (agent) state.messages = agent.messages;
}

export function setAgentStatus(state: RunState, agentId: string, status: RunStatus): void {
  const agent = state.agents.find((a) => a.id === agentId);
  if (agent) agent.status = status;
}

export function createWorkerAgent(opts: {
  id: string;
  writeAllow: string[];
  brief: string;
  maxSteps: number;
}): AgentState {
  return {
    id: opts.id,
    role: "worker",
    writeAllow: opts.writeAllow,
    status: "idle",
    brief: opts.brief,
    messages: [],
    step: 0,
    maxSteps: opts.maxSteps,
    filesTouched: [],
    verifyPassed: false,
  };
}

export function createOrchestratorAgent(brief: string): AgentState {
  return {
    id: "orch-1",
    role: "orchestrator",
    writeAllow: [],
    status: "idle",
    brief,
    messages: [],
    step: 0,
    maxSteps: 4,
    filesTouched: [],
    verifyPassed: false,
  };
}

export function createVerifierAgent(maxSteps = 4): AgentState {
  return {
    id: "verifier-1",
    role: "verifier",
    writeAllow: [],
    status: "idle",
    brief: "Verify the aggregated worker results with the shared recipe.",
    messages: [],
    step: 0,
    maxSteps,
    filesTouched: [],
    verifyPassed: false,
  };
}

export function mergeFilesTouched(state: RunState): string[] {
  const set = new Set<string>();
  for (const a of state.agents) {
    for (const f of a.filesTouched) set.add(f);
  }
  for (const f of state.filesTouched) set.add(f);
  return [...set];
}

export function findWriteOverlaps(workers: AgentState[]): string[] {
  const counts = new Map<string, number>();
  for (const w of workers) {
    for (const f of w.filesTouched) {
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([f]) => f);
}

export function globsOverlap(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return true;
  const setB = new Set(b);
  return a.some((g) => setB.has(g));
}
