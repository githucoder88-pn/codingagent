/**
 * CODER — permission engine.
 *
 * Execution levels:
 *   safe       — read-only tools (files, search, git reads, patches)
 *   balanced   — file writes, patches, git mutations (commit/checkout)
 *   full-auto  — everything including shell execution and installs
 *
 * A tool's required level is checked before execution. When the current
 * level is insufficient and stdin is interactive, the user is asked for
 * one-time approval; otherwise the call is denied.
 */

import { type PermissionLevel } from "../workspace/types.js";
import { promptConfirm } from "../ui/components/prompt.js";
import { type ToolDefinition } from "../tools/types.js";

export const LEVEL_RANK: Record<PermissionLevel, number> = {
  safe: 1,
  balanced: 2,
  "full-auto": 3,
};

export function levelAllows(current: PermissionLevel, required: PermissionLevel): boolean {
  return LEVEL_RANK[current] >= LEVEL_RANK[required];
}

export interface PermissionDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Decide whether a tool call is permitted.
 * `interactive` enables one-time prompts; `ask` is injected for tests.
 */
export async function checkPermission(
  tool: ToolDefinition,
  currentLevel: PermissionLevel,
  opts: { interactive?: boolean; ask?: (question: string) => Promise<boolean | null> } = {},
): Promise<PermissionDecision> {
  if (levelAllows(currentLevel, tool.level)) return { allowed: true };

  const ask = opts.ask ?? ((question: string) => promptConfirm(question, false));
  if (opts.interactive) {
    const approved = await ask(
      `Tool "${tool.id}" requires ${tool.level} (current: ${currentLevel}). Allow this one time?`,
    );
    if (approved === true) return { allowed: true, reason: "one-time approval" };
  }
  return {
    allowed: false,
    reason: `requires ${tool.level} permission (current level: ${currentLevel}); run with --${currentLevel === "safe" ? "balanced" : "full-auto"} or approve interactively`,
  };
}
