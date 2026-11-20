export type KeyPool = "cloud" | "local";

export type RunMode = "ask" | "allowlist" | "run-everything";

export type AgentRole = "orchestrator" | "worker" | "verifier";

export type Budget = "large" | "medium" | "small";

export interface KeyEntry {
  id: string;
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
  /** Last project folder opened in the editor UI. */
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

export interface PendingApproval {
  id: string;
  runId: string;
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
  | "rate_limited";

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
    | "verify";
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
  step: number;
  maxSteps: number;
  messages: Array<{ role: string; content: string; tool_calls?: unknown; name?: string; tool_call_id?: string }>;
  events: RunEvent[];
  pendingApproval?: PendingApproval;
  agents: Array<{
    id: string;
    role: AgentRole;
    keyId?: string;
    writeAllow: string[];
    status: RunStatus;
    brief?: string;
  }>;
  filesTouched: string[];
  verifyPassed: boolean;
  stats: RunStatsSnapshot;
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

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  body: string;
  sourcePath: string;
  attribution?: string;
}

export const DEFAULT_PORT = 7429;
export const PORT_FALLBACK_END = 7439;
