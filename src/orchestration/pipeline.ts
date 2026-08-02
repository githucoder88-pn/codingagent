/**
 * CODER — multi-agent orchestration pipeline (Phase 4).
 *
 * Runs a task through a sequence of named agent roles, each invoked through
 * the provider registry with a role-specific system prompt. With the offline
 * mock provider every step is deterministic (see mock.provider roleReply).
 *
 * Pipelines:
 *   - plan(task)         → just the planner
 *   - orchestrate(task)  → plan → research → implement → test → review →
 *                           document → report
 */

import { type ProviderRegistry } from "../providers/registry.js";
import { type ChatMessage } from "../types/index.js";
import { WorkspaceManager } from "../workspace/workspace-manager.js";
import { getAgentRole, roleSystemPrompt, type AgentRole } from "./roles.js";

export interface PipelineStep {
  role: AgentRole;
  output: string;
  durationMs: number;
}

export interface PipelineResult {
  task: string;
  steps: PipelineStep[];
  report: string;
  durationMs: number;
}

export type StepSink = (step: { role: string; title: string; text: string }) => void;

const ORCHESTRATE_SEQUENCE = ["planner", "researcher", "developer", "tester", "reviewer", "documenter", "memory"] as const;

async function runRole(
  registry: ProviderRegistry,
  role: AgentRole,
  task: string,
  context: string,
  providerId: string,
  model: string,
  history: ChatMessage[],
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: roleSystemPrompt(role, context) },
    ...history,
    { role: "user", content: task },
  ];
  const res = await registry.chat(providerId, { model, messages, stream: false });
  return res.content.trim();
}

/** Run only the planner and return its structured plan. */
export async function planTask(opts: {
  task: string;
  workspace: WorkspaceManager;
  registry: ProviderRegistry;
  providerId: string;
  model: string;
  onStep?: StepSink;
}): Promise<PipelineResult> {
  const role = getAgentRole("planner")!;
  const startedAt = Date.now();
  const context = await buildContext(opts.workspace);
  const t0 = Date.now();
  const output = await runRole(opts.registry, role, opts.task, context, opts.providerId, opts.model, []);
  const step: PipelineStep = { role, output, durationMs: Date.now() - t0 };
  opts.onStep?.({ role: role.id, title: role.title, text: output });
  return {
    task: opts.task,
    steps: [step],
    report: output,
    durationMs: Date.now() - startedAt,
  };
}

/** Run the full orchestration pipeline and assemble a report. */
export async function orchestrateTask(opts: {
  task: string;
  workspace: WorkspaceManager;
  registry: ProviderRegistry;
  providerId: string;
  model: string;
  onStep?: StepSink;
}): Promise<PipelineResult> {
  const startedAt = Date.now();
  const context = await buildContext(opts.workspace);
  const steps: PipelineStep[] = [];
  const history: ChatMessage[] = [];

  for (const roleId of ORCHESTRATE_SEQUENCE) {
    const role = getAgentRole(roleId)!;
    const t0 = Date.now();
    const output = await runRole(opts.registry, role, opts.task, context, opts.providerId, opts.model, history);
    const step: PipelineStep = { role, output, durationMs: Date.now() - t0 };
    steps.push(step);
    history.push({ role: "assistant", content: `${role.title}: ${output}` });
    opts.onStep?.({ role: role.id, title: role.title, text: output });
  }

  const report = renderReport(opts.task, steps);
  return { task: opts.task, steps, report, durationMs: Date.now() - startedAt };
}

async function buildContext(workspace: WorkspaceManager): Promise<string> {
  try {
    const bundle = await workspace.context().build({ includeGit: true });
    return workspace.context().render(bundle).slice(0, 4000);
  } catch {
    return "(no workspace context available)";
  }
}

function renderReport(task: string, steps: PipelineStep[]): string {
  const lines: string[] = [];
  lines.push(`# Orchestration report`);
  lines.push("");
  lines.push(`**Task:** ${task}`);
  lines.push("");
  for (const step of steps) {
    lines.push(`## ${step.role.title} (${step.role.id})`);
    lines.push(step.output);
    lines.push("");
  }
  lines.push(`---`);
  lines.push(`Ran ${steps.length} roles in ${steps.reduce((a, s) => a + s.durationMs, 0)}ms.`);
  return lines.join("\n");
}
