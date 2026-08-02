/**
 * CODER — agent role registry (Phase 4 / 7 / 9).
 *
 * A single source of truth for named agent roles. Each role carries a
 * system prompt, the subset of workspace tools it is permitted to use, and
 * a one-line responsibility. Multi-agent orchestration, the cognitive
 * civilization and directors all draw from this registry.
 *
 * The offline mock provider recognises a `CODER AGENT ROLE: <role>` marker
 * in the system prompt and returns a deterministic per-role completion, so
 * any pipeline built from these roles is fully testable without a network.
 */

import { type PermissionLevel } from "../workspace/types.js";
import { ALL_TOOLS } from "../tools/registry.js";
import { type ToolDefinition } from "../tools/types.js";

export interface AgentRole {
  id: string;
  /** Human title (e.g. "Planner"). */
  title: string;
  /** Short responsibility line. */
  responsibility: string;
  /** Full system prompt fragment (combined with the agent tool protocol). */
  systemPrompt: string;
  /** Tool ids this role may invoke (subset of ALL_TOOLS). `undefined` = all. */
  tools?: string[];
  /** Minimum permission level required for this role's tools. */
  level: PermissionLevel;
}

/** Build a role's tool subset from a predicate over the full tool list. */
function toolsWhere(pred: (t: ToolDefinition) => boolean): string[] {
  return ALL_TOOLS.filter(pred).map((t) => t.id);
}

const READ_TOOLS = toolsWhere((t) =>
  ["scan", "files", "read_file", "search", "find_symbol", "definition", "reference", "imports", "exports", "related", "git_status", "git_diff", "git_log", "memory_note", "validate"].includes(t.id),
);

const WRITE_TOOLS = [...READ_TOOLS, ...toolsWhere((t) => ["write_file", "append_file", "replace", "patch_create", "patch_apply", "git_commit"].includes(t.id))];

const SHELL_TOOLS = [...WRITE_TOOLS, ...toolsWhere((t) => ["execute_command", "run_tests", "run_build", "execute_script"].includes(t.id))];

export const AGENT_ROLES: Record<string, AgentRole> = {
  planner: {
    id: "planner",
    title: "Planner",
    responsibility: "Decompose goals into ordered, verifiable steps.",
    systemPrompt: "You are the Planner. Break the task into small, ordered, verifiable steps. Identify risks, dependencies and an acceptance criterion for each step. Do not write code.",
    tools: READ_TOOLS,
    level: "safe",
  },
  researcher: {
    id: "researcher",
    title: "Researcher",
    responsibility: "Survey the codebase and prior art for relevant context.",
    systemPrompt: "You are the Researcher. Survey the repository, symbols, dependencies and prior decisions. Surface the facts the rest of the team needs. Cite file paths and symbol names.",
    tools: READ_TOOLS,
    level: "safe",
  },
  developer: {
    id: "developer",
    title: "Developer",
    responsibility: "Implement the change following existing conventions.",
    systemPrompt: "You are the Developer. Implement the smallest correct change. Read before you write, match existing conventions, and keep diffs reviewable.",
    tools: WRITE_TOOLS,
    level: "balanced",
  },
  reviewer: {
    id: "reviewer",
    title: "Reviewer",
    responsibility: "Audit changes for correctness, style and regressions.",
    systemPrompt: "You are the Reviewer. Audit the change for correctness, style, security and regressions. Request concrete fixes or approve.",
    tools: READ_TOOLS,
    level: "safe",
  },
  tester: {
    id: "tester",
    title: "Tester",
    responsibility: "Design and run tests; report coverage gaps.",
    systemPrompt: "You are the Tester. Design and run tests that protect the change. Report pass/fail, flakiness and coverage gaps.",
    tools: SHELL_TOOLS,
    level: "full-auto",
  },
  security: {
    id: "security",
    title: "Security Engineer",
    responsibility: "Threat-model the change; flag risks.",
    systemPrompt: "You are the Security Engineer. Threat-model the change. Flag injection, secrets, broken authz, unsafe deserialization and vulnerable dependencies.",
    tools: READ_TOOLS,
    level: "safe",
  },
  documenter: {
    id: "documenter",
    title: "Documenter",
    responsibility: "Record the change in docs and examples.",
    systemPrompt: "You are the Documenter. Record the change in docs, README and accurate examples. Keep them in sync with the code.",
    tools: WRITE_TOOLS,
    level: "balanced",
  },
  memory: {
    id: "memory",
    title: "Memory Keeper",
    responsibility: "Persist key facts and lessons for future sessions.",
    systemPrompt: "You are the Memory Keeper. Distil the durable facts, decisions and lessons from this work into scoped memory for future sessions.",
    tools: READ_TOOLS,
    level: "safe",
  },
  // Phase 7 — civilization agent roles
  coordinator: {
    id: "coordinator",
    title: "Coordinator",
    responsibility: "Allocate work across roles and reconcile outputs.",
    systemPrompt: "You are the Coordinator. Allocate work across roles, sequence it, and reconcile their outputs into one coherent plan.",
    tools: READ_TOOLS,
    level: "safe",
  },
  architect: {
    id: "architect",
    title: "Architect",
    responsibility: "Design system structure, patterns and boundaries.",
    systemPrompt: "You are the Architect. Design the system structure, choose patterns, and define module boundaries and contracts.",
    tools: READ_TOOLS,
    level: "safe",
  },
  engineer: {
    id: "engineer",
    title: "Engineer",
    responsibility: "Build and integrate components.",
    systemPrompt: "You are the Engineer. Build and integrate the components specified by the architect, with tests.",
    tools: WRITE_TOOLS,
    level: "balanced",
  },
  optimizer: {
    id: "optimizer",
    title: "Optimizer",
    responsibility: "Profile and tune performance, cost and latency.",
    systemPrompt: "You are the Optimizer. Profile and tune performance. Reduce cost and latency without sacrificing correctness.",
    tools: SHELL_TOOLS,
    level: "full-auto",
  },
  evaluator: {
    id: "evaluator",
    title: "Evaluator",
    responsibility: "Score outcomes against goals; surface trade-offs.",
    systemPrompt: "You are the Evaluator. Score outcomes against the goals. Surface trade-offs and recommend the next action.",
    tools: READ_TOOLS,
    level: "safe",
  },
  deployment: {
    id: "deployment",
    title: "Deployment",
    responsibility: "Package, roll out, verify health and rollback.",
    systemPrompt: "You are Deployment. Package and roll out the change. Verify health and define a rollback path.",
    tools: SHELL_TOOLS,
    level: "full-auto",
  },
};

export function getAgentRole(id: string): AgentRole | undefined {
  return AGENT_ROLES[id.toLowerCase()];
}

export function listAgentRoles(): AgentRole[] {
  return Object.values(AGENT_ROLES);
}

/** Compose the full system prompt for a role (used by orchestration). */
export function roleSystemPrompt(role: AgentRole, context: string): string {
  return [
    role.systemPrompt,
    "",
    `CODER AGENT ROLE: ${role.id}`,
    "",
    "Repository context:",
    context,
  ].join("\n");
}
