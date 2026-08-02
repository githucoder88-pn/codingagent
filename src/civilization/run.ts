/**
 * CODER — civilization run loop (Phase 9).
 *
 * strategic planning → agent allocation → execution → evaluation →
 * reflection → knowledge update. Built on the orchestration pipeline +
 * cognitive core + knowledge graph so it is deterministic with the mock.
 */

import { type ProviderRegistry } from "../providers/registry.js";
import { type ChatMessage } from "../types/index.js";
import { WorkspaceManager } from "../workspace/workspace-manager.js";
import { getAgentRole, roleSystemPrompt } from "../orchestration/roles.js";
import { allocateDirectors, type Director } from "./directors.js";
import { cognitive } from "../cognitive/core.js";
import { KnowledgeGraph } from "../knowledge/graph.js";

export interface CivilizationStep {
  director: Director;
  output: string;
}

export interface CivilizationResult {
  goal: string;
  allocated: Director[];
  steps: CivilizationStep[];
  evaluation: { score: number; notes: string };
  summary: string;
  knowledgeRecorded: number;
}

export async function runCivilization(opts: {
  goal: string;
  workspace: WorkspaceManager;
  registry: ProviderRegistry;
  providerId: string;
  model: string;
  onStep?: (s: CivilizationStep) => void;
}): Promise<CivilizationResult> {
  const { goal, workspace, registry, providerId, model } = opts;
  const core = cognitive();
  core.updateWorldModel(workspace);

  const allocated = allocateDirectors(goal);
  const steps: CivilizationStep[] = [];
  const history: ChatMessage[] = [];

  for (const director of allocated) {
    const role = getAgentRole(director.roleId);
    if (!role) continue;
    const context = await safeContext(workspace);
    const messages: ChatMessage[] = [
      { role: "system", content: roleSystemPrompt(role, context) },
      ...history,
      { role: "user", content: `Civilization goal: ${goal}\nAs ${director.title} (${director.layer}), advance the goal.` },
    ];
    const res = await registry.chat(providerId, { model, messages, stream: false });
    const output = res.content.trim();
    const step: CivilizationStep = { director, output };
    steps.push(step);
    history.push({ role: "assistant", content: `${director.title}: ${output}` });
    opts.onStep?.(step);
  }

  const evaluation = await core.evaluate(registry, providerId, model, goal, steps.map((s) => s.output).join("\n"));
  const outcome = evaluation.score >= 0.5 ? "success" : "failure";
  core.reflect(outcome, `civilization: ${goal.slice(0, 80)}`, [`civilization handled: ${goal.slice(0, 40)}`]);

  // knowledge update: record the goal as a lesson.
  let knowledgeRecorded = 0;
  try {
    const idx = workspace.indexOrNull;
    if (idx) {
      const graph = new KnowledgeGraph();
      graph.record("goal", goal.slice(0, 80), idx.root);
      knowledgeRecorded = 1;
    }
  } catch {
    /* best effort */
  }

  const summary = `${allocated.length} directors collaborated on "${goal}". Outcome: ${outcome} (score ${evaluation.score.toFixed(2)}).`;
  return { goal, allocated, steps, evaluation, summary, knowledgeRecorded };
}

async function safeContext(workspace: WorkspaceManager): Promise<string> {
  try {
    const bundle = await workspace.context().build({ includeGit: true });
    return workspace.context().render(bundle).slice(0, 3000);
  } catch {
    return "(no workspace context)";
  }
}
