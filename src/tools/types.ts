/**
 * CODER — tool definitions (Phase 3).
 */

import { type PermissionLevel, type ToolResult } from "../workspace/types.js";

export interface ToolParam {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  required?: boolean;
  description: string;
  enum?: string[];
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  params: ToolParam[];
  /** Minimum permission level required to execute. */
  level: PermissionLevel;
  /** Whether the tool mutates the workspace (undo snapshots). */
  mutating: boolean;
  execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export interface ToolContext {
  /** Workspace root (cwd for shell tools). */
  cwd: string;
  /** Optional logger. */
  log?: (msg: string) => void;
  /** Files changed by this execution (for undo). */
  touched: string[];
  /** Attach a snapshot id for rollback. */
  onSnapshot?: (files: string[]) => Promise<string | undefined>;
}
