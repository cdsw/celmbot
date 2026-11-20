import type { RunMode, ToolCall, ToolName } from "../shared/types.js";
import { isProtectedPath } from "./pathGuard.js";

const READ_TOOLS: ToolName[] = ["list_dir", "read_file", "grep"];

export interface GateDecision {
  allow: boolean;
  reason: string;
  needsApproval: boolean;
}

export function gateToolCall(opts: {
  mode: RunMode;
  tool: ToolCall;
  projectRoot: string;
  terminalAllowlist: string[];
  freeformShellEnabled?: boolean;
}): GateDecision {
  const { mode, tool, projectRoot, terminalAllowlist } = opts;

  if (tool.name === "run_recipe") {
    const name = String(tool.arguments.name ?? "");
    const pattern = `recipe:${name}`;
    if (mode === "run-everything") {
      return { allow: true, reason: "run-everything", needsApproval: false };
    }
    if (mode === "allowlist" && terminalAllowlist.some((a) => name.startsWith(a) || pattern.startsWith(a) || a === pattern)) {
      return { allow: true, reason: "allowlist", needsApproval: false };
    }
    return {
      allow: false,
      reason: "recipe requires approval",
      needsApproval: true,
    };
  }

  if (tool.name === "fetch_url") {
    if (mode === "run-everything") {
      return { allow: true, reason: "run-everything", needsApproval: false };
    }
    return { allow: false, reason: "fetch requires approval", needsApproval: true };
  }

  if (tool.name === "write_file") {
    const filePath = String(tool.arguments.path ?? "");
    const absHint = filePath;
    if (isProtectedPath(projectRoot, absHint) || filePath.includes(".env") || filePath.includes(".git/")) {
      return {
        allow: false,
        reason: "protected path always needs approval",
        needsApproval: true,
      };
    }
    if (mode === "run-everything") {
      return { allow: true, reason: "run-everything", needsApproval: false };
    }
    if (mode === "allowlist") {
      return { allow: false, reason: "writes need approval unless allowlisted policy says otherwise", needsApproval: true };
    }
    return { allow: false, reason: "write requires approval", needsApproval: true };
  }

  if (READ_TOOLS.includes(tool.name)) {
    return { allow: true, reason: "read tools auto-allow inside jail", needsApproval: false };
  }

  if (mode === "ask") {
    return { allow: false, reason: "ask mode", needsApproval: true };
  }

  return { allow: true, reason: "default allow", needsApproval: false };
}

export function isDeleteLike(content: string): boolean {
  return content.trim() === "" || /rm\s|del\s|Remove-Item/i.test(content);
}
