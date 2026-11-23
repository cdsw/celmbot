export type KeyPool = "cloud" | "local";

export type RunMode = "ask" | "allowlist" | "run-everything";

export type AgentRole = "orchestrator" | "worker" | "verifier";

export type Budget = "large" | "medium" | "small";

/**
 * Provider credential — one (or more) API keys per provider.
 * Optionally lock to a single model via `modelLock`; otherwise any imported
 * model for the same provider/baseUrl may use it.
 */
export interface ProviderCredential {
  id: string;
  pool: KeyPool;
  providerId: string;
  label: string;
  baseUrl: string;
  apiKey?: string;
  rpm: number;
  rpd: number;
  /** When set, only this model id may use the credential. */
  modelLock?: string;
  enabled: boolean;
}

/**
 * Imported model route — what the agent router picks.
 * Auth comes from `credentialId` (not a pasted key per model).
 */
export interface KeyEntry {
  id: string;
  pool: KeyPool;
  providerId: string;
  /** Provider credential that supplies apiKey / baseUrl / RPM. */
  credentialId?: string;
  label: string;
  /** Denormalized from credential for UI / legacy callers. */
  baseUrl: string;
  /**
   * @deprecated Prefer credentials[].apiKey. Kept only for migration / legacy.
   */
  apiKey?: string;
  model: string;
  /** Optional per-model override; otherwise credential rpm/rpd apply. */
  rpm?: number;
  rpd?: number;
  enabled: boolean;
  supportsTools?: boolean;
  supportsEmbeddings?: boolean;
  degradedMode?: boolean;
  contextLengthHint?: number;
  lastLatencyMs?: number;
  cooldownUntil?: number;
}

/** Resolved auth + model for chat/probe (credential merged onto route). */
export interface ResolvedRoute {
  routeId: string;
  credentialId: string;
  pool: KeyPool;
  providerId: string;
  label: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  rpm: number;
  rpd: number;
  enabled: boolean;
  supportsTools?: boolean;
  supportsEmbeddings?: boolean;
  degradedMode?: boolean;
  contextLengthHint?: number;
  lastLatencyMs?: number;
  cooldownUntil?: number;
}

export interface RoleMap {
  orchestrator?: string;
  worker?: string;
  verifier?: string;
}

export interface CelmbotConfig {
  /** Schema version — 2 = credentials separated from model routes. */
  configVersion?: number;
  credentials: {
    cloud: ProviderCredential[];
    local: ProviderCredential[];
  };
  keys: {
    cloud: KeyEntry[];
    local: KeyEntry[];
  };
  roles: RoleMap;
  budget: Budget;
  runMode: RunMode;
  terminalAllowlist: string[];
  maxParallelWorkers: number;
  disclaimerAcceptedAt?: string;
  trustedProjects: string[];
  /** Last workspace folder opened in the editor UI. */
  lastProjectRoot?: string;
}

export interface RunScopes {
  projectRoot: string;
  writeAllow: string[];
  readAllow?: string[];
  shellAllow?: string[];
}

export type ToolName =
  | "list_dir"
  | "read_file"
  | "write_file"
  | "grep"
  | "run_recipe"
  | "fetch_url";

export interface ToolCall {
  id: string;
  name: ToolName;
  arguments: Record<string, unknown>;
}

export type WorkerReportStatus = "PASS" | "ISSUES" | "BLOCKED" | "GAP";

/** Recipe evidence attached to agent/run reports (prove-it-works). */
export interface VerifyEvidence {
  recipe: string;
  command: string;
  args: string[];
  exitCode: number;
  stdoutTail?: string;
  at: number;
}

export interface PendingApproval {
  id: string;
  runId: string;
  agentId: string;
  tool: ToolCall;
  summary: string;
  diff?: string;
  createdAt: number;
}

export type RunStatus =
  | "idle"
  | "running"
  | "waiting_approval"
  | "paused"
  | "done"
  | "error"
  | "rate_limited"
  | "interrupted"
  | "aggregating";

export interface AgentChatMessage {
  role: string;
  content: string;
  tool_calls?: unknown;
  name?: string;
  tool_call_id?: string;
}

export interface AgentState {
  id: string;
  role: AgentRole;
  keyId?: string;
  writeAllow: string[];
  status: RunStatus;
  brief?: string;
  messages: AgentChatMessage[];
  step: number;
  maxSteps: number;
  filesTouched: string[];
  verifyPassed: boolean;
  reportStatus?: WorkerReportStatus;
  issues?: string[];
  /** Last recipe run by this agent, if any. */
  evidence?: VerifyEvidence;
}

export interface AggregateReport {
  results: Array<{
    agentId: string;
    status: WorkerReportStatus;
    issues: string[];
    filesTouched: string[];
    evidence?: VerifyEvidence;
  }>;
  gaps: string[];
  overlaps: string[];
  verifyPassed: boolean;
  summary: string;
  /** Shared (post-worker) recipe evidence. */
  evidence?: VerifyEvidence;
  /** Optional operator-facing note when verify failed. */
  verifyNote?: string;
}

export interface RunEvent {
  id: string;
  runId: string;
  ts: number;
  type:
    | "status"
    | "llm"
    | "tool_request"
    | "tool_result"
    | "queue"
    | "approval"
    | "stats"
    | "error"
    | "done"
    | "verify"
    | "report";
  agentId?: string;
  role?: AgentRole;
  keyId?: string;
  message?: string;
  data?: Record<string, unknown>;
}

export interface RunState {
  id: string;
  mode: "solo" | "orchestrated";
  status: RunStatus;
  task: string;
  verifyRecipe: string;
  scopes: RunScopes;
  skillIds: string[];
  createdAt: number;
  updatedAt: number;
  /** Parent/orchestrator step counter (sum of progress / cap across schedule). */
  step: number;
  maxSteps: number;
  /** Mirror of the active agent's messages (compat + solo simplicity). */
  messages: AgentChatMessage[];
  events: RunEvent[];
  /** Head of approval queue (compat). */
  pendingApproval?: PendingApproval;
  pendingApprovals: PendingApproval[];
  activeAgentId: string;
  agents: AgentState[];
  filesTouched: string[];
  verifyPassed: boolean;
  stats: RunStatsSnapshot;
  aggregateReport?: AggregateReport;
  /** Shared verify recipe evidence (orchestrated). */
  verifyEvidence?: VerifyEvidence;
  /** How many post-verify fix passes have been spent (free-tier cap). */
  fixAttempts?: number;
}

export interface RunStatsSnapshot {
  wallMs: number;
  llmCalls: number;
  toolCalls: Record<string, number>;
  verifyAttempts: number;
  lastVerifyExitCode?: number;
  approvalsGranted: number;
  approvalsDenied: number;
  tokensIn?: number;
  tokensOut?: number;
  latencyLastMs?: number;
  latencyP50Ms?: number;
  latencyMaxMs?: number;
  queueWaitMs: number;
  errors: number;
  rateLimitHits: number;
}

export interface LifetimeStats {
  totalRuns: number;
  totalLlmCalls: number;
  verifyPass: number;
  verifyFail: number;
  perKey: Record<
    string,
    {
      calls: number;
      failures: number;
      rateLimits: number;
      latencySamples: number[];
    }
  >;
  updatedAt: number;
}

export interface RecipeDef {
  name: string;
  description: string;
  command: string;
  args: string[];
}

/** Provider catalog row from `providers/catalog.*.json`. */
export interface Catalog {
  id: string;
  name: string;
  baseUrl: string;
  defaultModel: string;
  rpm: number;
  rpd: number;
  signupUrl?: string;
  notes?: string;
}

/** Capability chip from provider catalog autodetection. */
export interface DiscoveredModelCapability {
  id: string;
  label: string;
  glyph: string;
  important: boolean;
  input?: boolean;
  output?: boolean;
}

/** One model from provider `/models` (or cache), after capability mapping. */
export interface DiscoveredModel {
  id: string;
  modelId: string;
  label: string;
  supportsTools: boolean | null;
  supportsEmbeddings: boolean;
  supportsVision: boolean;
  supportsFileInput: boolean;
  isFree: boolean;
  isChat: boolean;
  agentCompatible: boolean;
  contextLength?: number;
  pricing?: { prompt: number | null; completion: number | null };
  capabilities: DiscoveredModelCapability[];
}

export interface FsEntry {
  name: string;
  path: string;
  type: "file" | "dir";
}

export interface GitResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

export interface GitStatusEntry {
  path: string;
  index: string;
  worktree: string;
  status: string;
}

export interface GitStatus {
  isRepo: boolean;
  branch?: string;
  ahead?: number;
  behind?: number;
  entries: GitStatusEntry[];
  raw?: string;
}

/** Web UI alias for KeyEntry (same shape). */
export type Key = KeyEntry;

/** Web UI alias for ProviderCredential. */
export type Credential = ProviderCredential;

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  body: string;
  sourcePath: string;
  attribution?: string;
}

export type OperatorChatRole = "user" | "assistant" | "system";

export interface OperatorChatMessage {
  id: string;
  role: OperatorChatRole;
  text: string;
  ts: number;
  runId?: string;
}

export interface SessionChrome {
  mode: "solo" | "orchestrated";
  writeAllow: string[];
  verifyRecipe: string;
  skillIds: string[];
  workerCount: number;
  workerGlobs?: string[][];
}

export interface ChatSession {
  id: string;
  projectRoot: string;
  messages: OperatorChatMessage[];
  queued: string[];
  activeRunId?: string;
  chrome: SessionChrome;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_PORT = 7429;
export const PORT_FALLBACK_END = 7439;
