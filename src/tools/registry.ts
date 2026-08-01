/**
 * CODER — tool registry.
 *
 * Registers every tool (filesystem, shell, git, patch, search, memory,
 * validation) and resolves tools by id for the executor and the agent.
 */

import { filesystemTools } from "./filesystem.js";
import { shellTools } from "./shell.js";
import { gitTools } from "./git.js";
import { patchTools } from "./patch.js";
import { searchTools } from "./search-tools.js";
import { memoryTools } from "./memory.js";
import { validationTools } from "./validation.js";
import { workspaceTools } from "./workspace-tools.js";
import { type ToolDefinition } from "./types.js";
import { type PermissionLevel } from "../workspace/types.js";

export const ALL_TOOLS: ToolDefinition[] = [
  ...workspaceTools,
  ...filesystemTools,
  ...searchTools,
  ...shellTools,
  ...gitTools,
  ...patchTools,
  ...memoryTools,
  ...validationTools,
];

const byId = new Map(ALL_TOOLS.map((t) => [t.id, t]));

export function getTool(id: string): ToolDefinition | undefined {
  return byId.get(id);
}

export function listTools(level?: PermissionLevel): ToolDefinition[] {
  if (!level) return ALL_TOOLS;
  return ALL_TOOLS.filter((t) => t.level === level || t.level === "safe");
}

/** Render the tool catalogue for the agent system prompt. */
export function renderToolSchema(tools: ToolDefinition[] = ALL_TOOLS): string {
  return tools
    .map((t) => {
      const params = t.params.map((p) => `${p.name}${p.required ? "" : "?"}: ${p.type}${p.enum ? ` (${p.enum.join("|")})` : ""} — ${p.description}`).join("; ");
      return `- ${t.id}: ${t.description}${params ? ` [params: ${params}]` : ""}`;
    })
    .join("\n");
}
