import type { ChatSession, RunState, SessionChrome } from "../shared/types.js";
import { loadAllSkills } from "../skills/loader.js";
import { createOrchestratedRun, startOrchestrated } from "./orchestrator.js";
import { createRun, startRun, type EventSink } from "./loop.js";
import { saveRun } from "./persistence.js";
import {
  appendMessage,
  buildFollowUpTask,
  formatAggregateForChat,
  isTerminalRunStatus,
  loadSession,
  mergeProveItSkills,
  saveSession,
} from "./session.js";

export type RunKick = {
  onUpdate: (state: RunState) => void;
};

function scopesFrom(session: ChatSession, chrome: SessionChrome) {
  return {
    projectRoot: session.projectRoot,
    writeAllow: chrome.writeAllow ?? [],
  };
}

export function createRunFromChrome(
  session: ChatSession,
  task: string,
  chrome: SessionChrome
): RunState {
  const scopes = scopesFrom(session, chrome);
  const available = loadAllSkills().map((s) => s.id);
  const skillIds = mergeProveItSkills(chrome.skillIds, available);
  if (chrome.mode === "orchestrated") {
    return createOrchestratedRun({
      task,
      scopes,
      verifyRecipe: chrome.verifyRecipe,
      skillIds,
      workerGlobs:
        chrome.workerGlobs ??
        Array.from({ length: chrome.workerCount ?? 2 }, () => scopes.writeAllow),
    });
  }
  return createRun({
    task,
    scopes,
    verifyRecipe: chrome.verifyRecipe,
    skillIds,
    mode: "solo",
  });
}

export function attachRunToSession(session: ChatSession, state: RunState, userText: string): void {
  appendMessage(session, { role: "user", text: userText, runId: state.id });
  appendMessage(session, {
    role: "system",
    text: `Run ${state.id} started (${state.mode}).`,
    runId: state.id,
  });
  session.activeRunId = state.id;
  saveSession(session);
}

export function watchRunToSettle(
  sessionId: string,
  state: RunState,
  mode: "solo" | "orchestrated",
  kick: RunKick,
  makeSink: (runId: string) => EventSink
): void {
  kick.onUpdate(state);
  const sink = makeSink(state.id);
  const starter = mode === "orchestrated" ? startOrchestrated : startRun;
  void starter(state, sink).then(async (final) => {
    kick.onUpdate(final);
    saveRun(final);
    const latest = loadSession(sessionId);
    if (latest) await settleSessionRun(latest, final, kick, makeSink);
  });
}

/** When a run reaches a terminal status, post report to session and drain queue. */
export async function settleSessionRun(
  session: ChatSession,
  state: RunState,
  kick: RunKick,
  makeSink: (runId: string) => EventSink
): Promise<ChatSession> {
  if (!isTerminalRunStatus(state.status)) {
    session.activeRunId = state.id;
    saveSession(session);
    return session;
  }

  const already = session.messages.some((m) => m.runId === state.id && m.role === "assistant");
  if (!already) {
    appendMessage(session, {
      role: "assistant",
      text: formatAggregateForChat(state.aggregateReport, state),
      runId: state.id,
    });
  }
  session.activeRunId = undefined;
  saveSession(session);

  return drainSessionQueue(session, state, kick, makeSink);
}

export async function drainSessionQueue(
  session: ChatSession,
  prior: RunState | null,
  kick: RunKick,
  makeSink: (runId: string) => EventSink
): Promise<ChatSession> {
  if (session.activeRunId) {
    saveSession(session);
    return session;
  }
  const nextText = session.queued.shift();
  if (!nextText) {
    saveSession(session);
    return session;
  }
  saveSession(session);

  const chrome = session.chrome;
  const task = prior ? buildFollowUpTask(prior, nextText) : nextText;
  const state = createRunFromChrome(session, task, chrome);
  attachRunToSession(session, state, nextText);
  watchRunToSettle(session.id, state, chrome.mode, kick, makeSink);
  return session;
}
